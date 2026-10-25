/**
 * Main bootstrap — initializes canvas, game, UI, and wires up buttons.
 */
(function() {
    'use strict';

    // Get canvas elements
    const canvas = document.getElementById('game');
    const minimapCanvas = document.getElementById('minimap');

    /**
     * Size the backing store to the window divided by PIXEL_SIZE, then let CSS
     * stretch it back to full size with smoothing off. Everything therefore
     * lands on a visible pixel grid, and the upscale is what gives the chunky
     * look rather than any per-sprite trickery.
     */
    function resizeCanvas() {
        canvas.width = Math.ceil(window.innerWidth / PIXEL_SIZE);
        canvas.height = Math.ceil(window.innerHeight / PIXEL_SIZE);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        // Resizing the backing store resets context state, so re-disable
        // smoothing every time.
        canvas.getContext('2d').imageSmoothingEnabled = false;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Declared before the button handlers below, which capture it.
    let touch = null;

    // Initialize systems
    const audio = new AudioSystem();
    const ui = new UI(canvas, minimapCanvas);
    const game = new Game(canvas, ui, audio);
    window.abyssGame = game;

    // Music tracks are optional: drop files in audio/ and they play, otherwise
    // the game runs with effects only.
    audio.setTracks([
        'audio/savage-engine',        // floor 1 — leanest of the three
        'audio/engine-of-the-abyss',
        'audio/hydraulic-siege'
    ]);

    function startGame() {
        // Browsers start an AudioContext suspended; only a user gesture may
        // resume it, so this has to happen here rather than at load.
        audio.unlock();
        audio.playMusic(0);
        requestFullscreenIfTouch();
        if (touch) touch.releaseAll();
        game.start();
        game.startLoop();
        // Blur any focused element so keyboard events reach window listeners
        if (document.activeElement) document.activeElement.blur();
        // Also set focus to the canvas itself to ensure key events are captured
        canvas.focus();
    }

    // Wire up button handlers
    document.getElementById('start-btn').addEventListener('click', (e) => {
        e.preventDefault();
        startGame();
    });

    document.getElementById('restart-btn').addEventListener('click', (e) => {
        e.preventDefault();
        if (game.coopMode) window.coopClient.send({ type: 'restart' });
        else startGame();
    });

    document.getElementById('resume-btn').addEventListener('click', (e) => {
        e.preventDefault();
        // Go through togglePause() rather than setting state directly, so the
        // button and the Space key can never drift apart.
        game.togglePause();
        // The thumb that tapped Resume must not be left registered as held.
        if (touch) touch.releaseAll();
        if (document.activeElement) document.activeElement.blur();
    });

    document.getElementById('confirm-upgrade').addEventListener('click', (e) => {
        e.preventDefault();
        game.applyUpgrade();
    });

    // ===== Touch =====
    const touchLayer = document.getElementById('touch-layer');
    const touchPause = document.getElementById('touch-pause');

    if (TouchControls.isTouchDevice()) {
        document.body.classList.add('touch-device');
        touchLayer.classList.remove('hidden');
        touchPause.classList.remove('hidden');
        touch = new TouchControls(game.input, touchLayer);

        touchPause.addEventListener('click', (e) => {
            e.preventDefault();
            game.togglePause();
            if (touch) touch.releaseAll();
        });

        // A backgrounded tab never delivers pointerup, so the thumb would stay
        // "down" on return. Drop everything when visibility is lost.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && touch) touch.releaseAll();
        });

        // Orientation changes report the new size late on some devices, so
        // resize again on the next frame as well as immediately.
        window.addEventListener('orientationchange', () => {
            resizeCanvas();
            requestAnimationFrame(resizeCanvas);
            setTimeout(resizeCanvas, 250);
        });
    }

    /**
     * Ask for fullscreen on a touch device. Must be called from inside a user
     * gesture, and is best-effort: iOS Safari does not implement it for
     * arbitrary elements, so a rejection is normal and not worth surfacing.
     */
    function requestFullscreenIfTouch() {
        if (!touch || document.fullscreenElement) return;
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (fn) { try { fn.call(el); } catch (_) { /* ignore */ } }
    }

    // Sound toggle — works with mouse and touch alike
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        audio.unlock();
        ui.setMuted(audio.toggleMute());
        if (document.activeElement) document.activeElement.blur();
    });
    window.startOfflineGame = startGame;
    ui.setMuted(audio.muted);

    // Show start screen
    ui.showStart();
})();
