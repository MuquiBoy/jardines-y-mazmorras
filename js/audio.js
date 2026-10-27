/**
 * Audio — synthesized sound effects plus an optional music layer.
 *
 * Effects are generated with Web Audio rather than shipped as files: a bullet
 * hell fires constantly, so per-shot samples would mean either a large
 * download or audible repetition. Synthesis also keeps the project
 * dependency-free and lets pitch vary per shot, which is most of what stops
 * rapid fire turning into a machine-gun of identical clicks.
 *
 * Music is separate and file-based, loaded from audio/ if present. Missing
 * tracks are not an error — the game simply runs silent.
 */
class AudioSystem {
    /**
     * Hard cap on effect voices playing at once.
     *
     * Every enemy bullet and every hit wants a sound; unbounded, a busy room
     * sums dozens of oscillators into clipping mush. Beyond the cap new
     * effects are dropped rather than queued, since a late sound is worse
     * than a missing one.
     */
    static MAX_VOICES = 14;

    /**
     * A do-nothing instance. Lets Game hold an audio system unconditionally,
     * so no call site needs a null check and tests can run without Web Audio.
     */
    static silent() {
        const noop = () => {};
        return {
            unlock: noop, setMuted: noop, toggleMute: () => false, muted: false,
            shoot: noop, sniperShot: noop, flameShot: noop, burnTick: noop, summonAttack: noop, enemyShoot: noop, enemyHit: noop, enemyDeath: noop,
            cochinillaCharge: noop, setCochinillaBeam: noop,
            playerHurt: noop, pickup: noop, levelUp: noop, descend: noop,
            gameOver: noop, setTracks: noop, playMusic: noop, ensureMusic: noop, nextTrack: noop,
            stopMusic: noop
        };
    }

    constructor() {
        this.ctx = null;
        this.master = null;
        this.sfxGain = null;
        this.musicGain = null;
        this.voices = 0;
        this.cochinillaBeamVoice = null;

        this.musicEl = null;   // fallback path only
        this.musicSrc = null;  // Web Audio path
        this.musicToken = 0;   // discards loads superseded by a newer one
        this.musicLoading = false;
        this.musicInfo = null;
        this.tracks = [];
        this.trackIndex = 0;

        this.muted = this.loadMuted();
        this.unlocked = false;
    }

    loadMuted() {
        try { return localStorage.getItem('bh-muted') === '1'; } catch (_) { return false; }
    }

    saveMuted() {
        try { localStorage.setItem('bh-muted', this.muted ? '1' : '0'); } catch (_) { /* private mode */ }
    }

    /**
     * Create the audio graph. Must run inside a user gesture: browsers start
     * the context suspended and only a gesture may resume it.
     */
    unlock() {
        if (this.unlocked) {
            // A context can be suspended again when a tab is backgrounded.
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
            // The offline and online flows both call unlock() from their start
            // handlers, so any gesture that gets here may also start the music.
            this.ensureMusic(this.trackIndex || 0);
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return; // no Web Audio: run silent rather than throw

        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.5;
        this.sfxGain.connect(this.master);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.45;
        this.musicGain.connect(this.master);

        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.unlocked = true;
        this.ensureMusic(this.trackIndex || 0);
    }

    /**
     * Start the current track if nothing is playing yet.
     *
     * Browsers only allow audio after a gesture, and the online flow enters
     * through a WebSocket message rather than startGame(), so both paths call
     * this rather than relying on playMusic() alone.
     */
    ensureMusic(index = 0) {
        if (!this.tracks.length || !this.unlocked || !this.ctx) return;
        if (this.musicLoading || this.musicSrc || this.musicEl) return;
        this.playMusic(index);
    }

    setMuted(muted) {
        this.muted = muted;
        this.saveMuted();
        if (this.master) this.master.gain.value = muted ? 0 : 1;
        if (this.musicEl) this.musicEl.muted = muted;
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    /** Can a new effect start right now? */
    canPlay() {
        return this.unlocked && !this.muted && this.ctx &&
               this.voices < AudioSystem.MAX_VOICES;
    }

    /** Track a voice for its lifetime so MAX_VOICES means something. */
    hold(node, seconds) {
        this.voices++;
        node.onended = () => { this.voices--; };
        // onended does not fire if a node is never started or is GC'd early,
        // so release on a timer as well. Guarded so it cannot double-decrement.
        let released = false;
        const release = () => { if (!released) { released = true; this.voices--; } };
        node.onended = release;
        setTimeout(release, (seconds + 0.2) * 1000);
    }

    /**
     * One-shot tone with an exponential pitch sweep and a percussive envelope.
     * The building block for most of the effects below.
     */
    tone({ type = 'square', from, to, dur, gain = 0.3, delay = 0 }) {
        if (!this.canPlay()) return;
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(from, t0);
        if (to !== undefined && to !== from) {
            // exponentialRamp cannot reach or pass through zero
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
        }

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(env);
        env.connect(this.sfxGain);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
        this.hold(osc, dur + delay);
    }

    /** Filtered white noise — the grit behind impacts and explosions. */
    noise({ dur, gain = 0.3, from = 2200, to = 300, delay = 0, q = 1 }) {
        if (!this.canPlay()) return;
        const t0 = this.ctx.currentTime + delay;
        const frames = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, Math.max(1, frames), this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

        const src = this.ctx.createBufferSource();
        src.buffer = buf;

        const filt = this.ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.Q.value = q;
        filt.frequency.setValueAtTime(from, t0);
        filt.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);

        const env = this.ctx.createGain();
        env.gain.setValueAtTime(gain, t0);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        src.connect(filt); filt.connect(env); env.connect(this.sfxGain);
        src.start(t0);
        this.hold(src, dur + delay);
    }

    // ===== Effects =====

    /** Player shot. Pitch jitters per shot so sustained fire is not a drone. */
    shoot() {
        const j = 0.92 + Math.random() * 0.16;
        this.tone({ type: 'square', from: 720 * j, to: 210 * j, dur: 0.09, gain: 0.14 });
        this.noise({ dur: 0.05, gain: 0.06, from: 3200, to: 700 });
    }

    /** Sharper two-part chiptune crack for the sniper rifle. */
    sniperShot() {
        this.tone({ type: 'triangle', from: 1180, to: 190, dur: 0.16, gain: 0.22 });
        this.noise({ dur: 0.07, gain: 0.11, from: 5200, to: 650, q: 0.8 });
        this.tone({ type: 'square', from: 1480, to: 1180, dur: 0.045, gain: 0.06, delay: 0.035 });
    }

    /** Short retro flame burst with a noisy, descending edge. */
    flameShot() {
        this.noise({ dur: 0.13, gain: 0.12, from: 1800, to: 420, q: 0.65 });
        this.tone({ type: 'sawtooth', from: 460, to: 105, dur: 0.16, gain: 0.11 });
    }

    /** Three soft, rounded retro pulses during the cochinilla's warning. */
    cochinillaCharge() {
        for (let i = 0; i < 3; i++) {
            this.tone({ type: 'triangle', from: 260 + i * 55, to: 190 + i * 35, dur: 0.11, gain: 0.09, delay: i * 0.2 });
        }
    }

    /** Sustain one synthesized retro beam while the cochinilla is attacking. */
    setCochinillaBeam(active) {
        if (!active) {
            const voice = this.cochinillaBeamVoice;
            if (!voice) return;
            this.cochinillaBeamVoice = null;
            const now = this.ctx.currentTime;
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setTargetAtTime(0.0001, now, 0.035);
            for (const node of voice.nodes) {
                try { node.stop(now + 0.16); } catch (_) { /* already stopped */ }
            }
            setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, 220);
            return;
        }
        if (this.cochinillaBeamVoice || !this.canPlay()) return;

        const now = this.ctx.currentTime;
        const gain = this.ctx.createGain();
        const low = this.ctx.createOscillator();
        const edge = this.ctx.createOscillator();
        const grit = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const noiseBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.25), this.ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

        low.type = 'sawtooth'; low.frequency.setValueAtTime(118, now);
        edge.type = 'square'; edge.frequency.setValueAtTime(236, now);
        grit.buffer = noiseBuffer; grit.loop = true;
        filter.type = 'bandpass'; filter.frequency.setValueAtTime(1450, now); filter.Q.value = 0.8;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.06);
        low.connect(gain); edge.connect(gain); grit.connect(filter); filter.connect(gain);
        gain.connect(this.sfxGain);
        low.start(now); edge.start(now); grit.start(now);
        this.cochinillaBeamVoice = { gain, nodes: [low, edge, grit] };
        this.voices++;
    }

    /** Quiet crackle used for fire damage ticks. */
    burnTick() {
        this.noise({ dur: 0.045, gain: 0.035, from: 2600, to: 900, q: 0.7 });
        this.tone({ type: 'square', from: 150, to: 90, dur: 0.04, gain: 0.025 });
    }

    summonAttack() {
        this.tone({ type: 'triangle', from: 420, to: 760, dur: 0.08, gain: 0.06 });
    }

    enemyShoot() {
        const j = 0.9 + Math.random() * 0.2;
        this.tone({ type: 'sawtooth', from: 300 * j, to: 130 * j, dur: 0.12, gain: 0.08 });
    }

    /** Bullet connecting with an enemy — short, dry, high. */
    enemyHit() {
        this.noise({ dur: 0.06, gain: 0.14, from: 4200, to: 1200 });
        this.tone({ type: 'square', from: 420, to: 260, dur: 0.05, gain: 0.07 });
    }

    /** Enemy death — a collapsing growl. */
    enemyDeath() {
        this.tone({ type: 'sawtooth', from: 260, to: 48, dur: 0.34, gain: 0.2 });
        this.noise({ dur: 0.3, gain: 0.2, from: 1800, to: 120 });
    }

    /** Player damaged — low, ugly, unmistakable. */
    playerHurt() {
        this.tone({ type: 'square', from: 190, to: 70, dur: 0.3, gain: 0.3 });
        this.noise({ dur: 0.24, gain: 0.22, from: 900, to: 90 });
    }

    /** XP pickup — a small bright blip, kept quiet since it fires constantly. */
    pickup() {
        this.tone({ type: 'square', from: 880, to: 1320, dur: 0.06, gain: 0.05 });
    }

    /** Level up — rising fanfare. */
    levelUp() {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) =>
            this.tone({ type: 'square', from: f, to: f, dur: 0.14, gain: 0.16, delay: i * 0.085 }));
    }

    /** Descending to the next floor — a heavy door and a drop. */
    descend() {
        this.tone({ type: 'sawtooth', from: 150, to: 40, dur: 0.7, gain: 0.24 });
        this.noise({ dur: 0.6, gain: 0.18, from: 700, to: 60 });
    }

    /** Death — the long fall. */
    gameOver() {
        this.tone({ type: 'sawtooth', from: 320, to: 30, dur: 1.3, gain: 0.3 });
        this.noise({ dur: 1.1, gain: 0.2, from: 1200, to: 50 });
    }

    // ===== Music =====

    /**
     * Register tracks by path; files with no extension default to MP3.
     *
     * Nothing here fails loudly: if the files are absent the game runs with
     * effects only, so the repo stays playable without any audio committed.
     */
    setTracks(paths) {
        this.tracks = paths;
    }

    /**
     * Find the musical body of a track, excluding lead-in silence and any
     * fade-out, and return sample-accurate loop points.
     *
     * Generated tracks almost always fade to silence at the end, which is fine
     * for listening and useless for looping — a plain `loop` drops several
     * seconds of dead air into the middle of a fight every time round. Looping
     * the body instead avoids re-encoding the files at all.
     *
     * Both edges are nudged to the nearest zero crossing so the seam does not
     * click.
     */
    static findLoopPoints(buffer) {
        const d = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const win = Math.floor(sr * 0.25);

        // RMS profile over quarter-second windows
        const profile = [];
        for (let i = 0; i + win <= d.length; i += win) {
            let sum = 0;
            for (let k = i; k < i + win; k++) sum += d[k] * d[k];
            profile.push(Math.sqrt(sum / win));
        }
        if (!profile.length) return { start: 0, end: buffer.duration };

        const sorted = [...profile].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        // Walk in from each end to the first window at 60% of the median level.
        const FLOOR = median * 0.6;
        let first = 0;
        while (first < profile.length && profile[first] < FLOOR) first++;
        let last = profile.length - 1;
        while (last > first && profile[last] < FLOOR) last--;

        let startS = first * win;
        let endS = Math.min(d.length, (last + 1) * win);

        // Nudge to zero crossings to avoid a click at the seam.
        const toZero = (idx, dir) => {
            const limit = Math.min(Math.floor(sr * 0.05), 2000);
            for (let n = 0; n < limit; n++) {
                const i = idx + n * dir;
                if (i <= 0 || i >= d.length - 1) break;
                if ((d[i] <= 0 && d[i + 1] > 0) || (d[i] >= 0 && d[i + 1] < 0)) return i;
            }
            return idx;
        };
        startS = toZero(startS, 1);
        endS = toZero(endS, -1);

        return { start: startS / sr, end: endS / sr };
    }

    /**
     * Play a track, looping its musical body.
     *
     * Uses Web Audio so music runs through musicGain like everything else — an
     * HTMLAudioElement would bypass the graph, leaving the music mix and the
     * master mute on separate paths. Falls back to an element when fetch or
     * decode is unavailable, which is the case on file:// where fetch is
     * blocked by CORS.
     */
    async playMusic(index = 0) {
        if (!this.tracks.length || !this.unlocked || !this.ctx) return;
        this.trackIndex = ((index % this.tracks.length) + this.tracks.length) % this.tracks.length;
        const base = this.tracks[this.trackIndex];
        const source = /\.(?:mp3|ogg|wav)(?:\?.*)?$/i.test(base) ? base : base + '.mp3';

        this.stopMusic();
        const token = ++this.musicToken; // guards against a slow load landing late
        this.musicLoading = true;

        try {
            const res = await fetch(source);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const bytes = await res.arrayBuffer();
            const buffer = await this.ctx.decodeAudioData(bytes);
            if (token !== this.musicToken) return; // superseded while loading
            this.musicLoading = false;

            const { start, end } = AudioSystem.findLoopPoints(buffer);
            const src = this.ctx.createBufferSource();
            src.buffer = buffer;
            src.loop = true;
            src.loopStart = start;
            src.loopEnd = end;
            src.connect(this.musicGain);
            src.start(0, start);
            this.musicSrc = src;
            this.musicInfo = { base, source, start: +start.toFixed(2), end: +end.toFixed(2) };
        } catch (_) {
            if (token !== this.musicToken) return;
            this.musicLoading = false;
            // No fetch/decode available (file://) or the file is missing.
            // Fall back to a plain element; the fade gap returns, but the game
            // still has music rather than none.
            this.playMusicFallback(source, token);
        }
    }

    playMusicFallback(source, token) {
        try {
            const el = new Audio(source);
            el.loop = true;
            el.volume = 0.45;
            el.muted = this.muted;
            el.addEventListener('error', () => { /* run silent */ });
            const pr = el.play();
            if (pr && pr.catch) pr.catch(() => { /* blocked until a gesture */ });
            if (token !== this.musicToken) { el.pause(); return; }
            this.musicEl = el;
        } catch (_) { /* run silent */ }
    }

    /** Advance to the next track — called on each new floor. */
    nextTrack() {
        if (!this.tracks.length) return;
        this.playMusic(this.trackIndex + 1);
    }

    stopMusic() {
        this.musicToken = (this.musicToken || 0) + 1;
        this.musicLoading = false;
        if (this.musicSrc) {
            try { this.musicSrc.stop(); } catch (_) { /* already stopped */ }
            this.musicSrc.disconnect();
            this.musicSrc = null;
        }
        if (this.musicEl) {
            this.musicEl.pause();
            this.musicEl = null;
        }
    }
}
