/**
 * Enemy classes — base class and 3 enemy types + boss.
 */

/**
 * Difficulty ramp.
 *
 * Enemy stats are authored at full strength and scaled DOWN early, so floor 10
 * and beyond plays exactly as the tuned values read in each constructor. Only
 * the first floors are eased.
 */
const DIFFICULTY_RAMP_FLOORS = 10;

/** Multipliers applied on floor 1, interpolated to 1.0 by DIFFICULTY_RAMP_FLOORS. */
const EARLY_GAME = {
    speed: 0.55,        // slower movement
    shootCooldown: 1.9, // longer gap between shots (higher = slower fire)
    bulletSpeed: 0.60   // slower, more readable bullets
};

/**
 * Ramp position for a floor: 0 on floor 1, 1 on floor 10 and after.
 * @param {number} floor - 1-based
 */
function difficultyForFloor(floor) {
    const t = (floor - 1) / (DIFFICULTY_RAMP_FLOORS - 1);
    return Math.max(0, Math.min(1, t));
}

/**
 * Floors completed beyond the end of the ramp. 0 up to floor 10, then 1, 2, …
 *
 * The ramp only eases the opening; past it every floor used to be identical,
 * so a run had no upper curve at all. This drives the growth that keeps going.
 */
function endgameFloors(floor) {
    return Math.max(0, floor - DIFFICULTY_RAMP_FLOORS);
}

/**
 * Endgame growth per stat, as multipliers.
 *
 * Health carries most of the curve because it is the safest lever: it lengthens
 * fights without making them less readable. Speed and fire rate are capped
 * hard — an enemy faster than the player, or firing continuously, stops being
 * a challenge and starts being unfair.
 */
const ENDGAME = {
    healthPerFloor:   0.16,   // uncapped: the main pressure
    damagePerFloor:   0.05,
    damageCap:        2.2,
    speedPerFloor:    0.020,
    speedCap:         1.30,
    cooldownPerFloor: 0.028,
    cooldownFloor:    0.60,   // never fire faster than this fraction of base
    countEvery:       4       // +1 enemy per room every N floors past the ramp
};


// ===== Base Enemy Class =====
class Enemy {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.health = 30;
        this.maxHealth = 30;
        this.speed = 1.5;
        this.damage = 10;
        this.radius = 14;
        this.color = '#ff4444';
        this.xpValue = 10;
        this.shootCooldown = 90;
        this.shootTimer = 0;
        this.bulletSpeedScale = 1;
        this.alive = true;
        this.deathTimer = 0;
        this.angle = 0; // for rotation animations
        this.burnTimer = 0;
        this.burnTickTimer = 0;
        this.burnDamage = 0;
        this.burnInterval = 24;
        this.burnPulse = 0;
        // Navigation cache. Enemies share the map's A* grid by asking for a
        // route every few frames instead of every frame.
        this._navPath = null;
        this._navGoal = null;
        this._navIndex = 0;
        this._navTimer = 0;
        this._navMap = null;
        this._retreatGoal = null;
        this._retreatTimer = 0;
        this._dodgeSign = Math.random() < 0.5 ? -1 : 1;
    }

    update(player, enemies, map) {
        // Override in subclass
    }

    /**
     * Move by a delta, respecting walls when a map is supplied.
     *
     * Resolved per axis so an enemy pressed against a wall slides along it.
     * Returns whether the body actually moved, which lets the navigation code
     * detect a blocked step and sidestep instead of grinding in place.
     */
    moveBy(dx, dy, map) {
        if (!map) {
            this.x += dx;
            this.y += dy;
            return dx !== 0 || dy !== 0;
        }
        const startX = this.x, startY = this.y;
        if (map.canOccupy(this.x + dx, this.y, this.radius)) this.x += dx;
        if (map.canOccupy(this.x, this.y + dy, this.radius)) this.y += dy;
        return this.x !== startX || this.y !== startY;
    }

    /** One short step toward a point, clamped so it never overshoots. */
    _stepToward(targetX, targetY, map, speed) {
        const dx = targetX - this.x, dy = targetY - this.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.001) return false;
        const step = Math.min(speed, distance);
        return this.moveBy((dx / distance) * step, (dy / distance) * step, map);
    }

    /**
     * Walk toward a world point, routing around red walls when the straight
     * line is blocked.
     *
     * A* results are cached for a few frames and only recomputed when the
     * target drifts, the route runs out, or the map changes. While the target
     * stays in sight the enemy moves directly, so open-room pursuit is smooth
     * and does not pay for pathfinding at all.
     */
    steerTo(targetX, targetY, map, speed = this.speed) {
        if (!map) return this._stepToward(targetX, targetY, null, speed);

        const distance = Math.hypot(targetX - this.x, targetY - this.y);
        if (distance > 1400) {
            // Too far to matter (and too expensive to route to): idle cleanly
            // instead of pressing into a wall somewhere across the floor.
            this._navPath = null;
            return false;
        }

        if (this._navTimer > 0) this._navTimer--;
        const sameGoal = this._navGoal &&
            Math.hypot(targetX - this._navGoal.x, targetY - this._navGoal.y) <= 56;
        if (!sameGoal) {
            this._navGoal = { x: targetX, y: targetY };
            this._navTimer = 0;
        }

        const direct = distance <= 560 && map.hasLineOfSight(this.x, this.y, targetX, targetY, this.radius);
        if (direct) {
            this._navPath = null;
            this._navIndex = 0;
            this._navMap = map;
            if (this._stepToward(targetX, targetY, map, speed)) return true;
            // A straight line that samples clean can still be blocked when the
            // step is split per axis; sidestep once so it does not freeze.
            this._dodge(map, speed);
            return false;
        }

        const stale = !direct && (!this._navPath || this._navIndex >= this._navPath.length ||
            this._navMap !== map || this._navTimer <= 0);
        if (stale) this._planNav(targetX, targetY, map);

        let waypoint = this._navPath && this._navPath[this._navIndex];
        while (waypoint && Math.hypot(waypoint.x - this.x, waypoint.y - this.y) <= 12) {
            this._navIndex++;
            waypoint = this._navPath[this._navIndex];
        }
        if (!waypoint) return this._stepToward(targetX, targetY, map, speed);

        const moved = this._stepToward(waypoint.x, waypoint.y, map, speed);
        if (!moved) {
            this._navTimer = 0;
            this._dodge(map, speed);
        }
        return moved;
    }

    /** Recompute the cached A* route to a target. */
    _planNav(targetX, targetY, map) {
        this._navPath = map.findPath(this.x, this.y, targetX, targetY, this.radius, 6000);
        this._navIndex = 0;
        this._navMap = map;
        this._navTimer = 18 + Math.floor(Math.random() * 12);
    }

    /**
     * Sidestep perpendicular to the intended direction for a single frame.
     * This is the escape hatch for corners where both axes are blocked.
     */
    _dodge(map, speed) {
        const goalX = this._navGoal ? this._navGoal.x : this.x + Math.cos(this.angle);
        const goalY = this._navGoal ? this._navGoal.y : this.y + Math.sin(this.angle);
        const dx = goalX - this.x, dy = goalY - this.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.001) return false;
        const nx = -dy / distance, ny = dx / distance;
        if (this.moveBy(nx * this._dodgeSign * speed, ny * this._dodgeSign * speed, map)) return true;
        this._dodgeSign *= -1;
        return this.moveBy(-nx * this._dodgeSign * speed, -ny * this._dodgeSign * speed, map);
    }

    /**
     * Back away from a threat, preferring a visible free spot behind the
     * enemy. When the room is a dead end it follows an A* route to the best
     * reachable escape instead of walking into the wall.
     */
    retreatFrom(threatX, threatY, map, speed = this.speed) {
        if (!map) return this._stepToward(this.x * 2 - threatX, this.y * 2 - threatY, null, speed);

        const dx = this.x - threatX, dy = this.y - threatY;
        const threatDistance = Math.hypot(dx, dy) || 1;

        if (this._retreatTimer > 0) {
            this._retreatTimer--;
            if (this._retreatGoal &&
                map.hasLineOfSight(this.x, this.y, this._retreatGoal.x, this._retreatGoal.y, this.radius) &&
                Math.hypot(this._retreatGoal.x - threatX, this._retreatGoal.y - threatY) > threatDistance + 24) {
                return this.steerTo(this._retreatGoal.x, this._retreatGoal.y, map, speed);
            }
        }

        const base = Math.atan2(dy, dx);
        const offsets = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0];
        const reach = 190;
        let fallback = null;
        for (const offset of offsets) {
            const angle = base + offset;
            const goalX = this.x + Math.cos(angle) * reach;
            const goalY = this.y + Math.sin(angle) * reach;
            if (!map.canOccupy(goalX, goalY, this.radius)) continue;
            if (Math.hypot(goalX - threatX, goalY - threatY) <= threatDistance + 24) continue;
            if (map.hasLineOfSight(this.x, this.y, goalX, goalY, this.radius)) {
                this._retreatGoal = { x: goalX, y: goalY };
                this._retreatTimer = 30;
                return this.steerTo(goalX, goalY, map, speed);
            }
            if (!fallback) fallback = { x: goalX, y: goalY };
        }
        if (fallback) {
            this._retreatGoal = fallback;
            this._retreatTimer = 30;
            return this.steerTo(fallback.x, fallback.y, map, speed);
        }
        // Nowhere to go: hold ground and keep firing.
        return false;
    }

    shootTowardPlayer(angle, speed = 3) {
        const v = speed * this.bulletSpeedScale;
        return {
            x: this.x,
            y: this.y,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v,
            damage: this.damage,
            radius: 6,
            color: this.color,
            speed: v
        };
    }

    /**
     * Ease this enemy's stats for an early floor.
     *
     * Called once, right after construction, so it scales whatever the subclass
     * set rather than the base defaults. At t = 1 every multiplier is 1.0 and
     * the enemy is left exactly as authored.
     *
     * @param {number} t - ramp position from difficultyForFloor()
     */
    applyDifficulty(t, floor = 1) {
        const ease = (early) => early + (1 - early) * t;

        this.speed *= ease(EARLY_GAME.speed);
        this.bulletSpeedScale = ease(EARLY_GAME.bulletSpeed);
        this.shootCooldown = Math.round(this.shootCooldown * ease(EARLY_GAME.shootCooldown));

        // Endgame growth, applied on top once the ramp is finished.
        const e = endgameFloors(floor);
        if (e > 0) {
            const hp = 1 + ENDGAME.healthPerFloor * e;
            this.maxHealth = Math.round(this.maxHealth * hp);
            this.health = this.maxHealth;

            this.damage = Math.round(this.damage *
                Math.min(ENDGAME.damageCap, 1 + ENDGAME.damagePerFloor * e));
            this.speed *= Math.min(ENDGAME.speedCap, 1 + ENDGAME.speedPerFloor * e);
            this.shootCooldown = Math.max(
                Math.round(this.shootCooldown * ENDGAME.cooldownFloor),
                Math.round(this.shootCooldown * (1 - ENDGAME.cooldownPerFloor * e)));

            // Deeper enemies are worth more, so levelling keeps pace a little.
            this.xpValue = Math.round(this.xpValue * (1 + 0.10 * e));
        }

        // shootTimer starts at 0, which makes every enemy fire on its first
        // frame — the whole room volleys the instant the player walks in.
        // Start it partway through a randomised cooldown instead, so shots are
        // staggered and the player gets a moment to read the room.
        this.shootTimer = Math.round(this.shootCooldown * (0.6 + Math.random() * 0.6));
    }

    applyBurn(burn) {
        this.burnDamage = Math.max(this.burnDamage || 0, burn.damage);
        this.burnInterval = burn.interval;
        this.burnTimer = Math.max(this.burnTimer || 0, burn.duration);
        if (!this.burnTickTimer || this.burnTickTimer > this.burnInterval) this.burnTickTimer = this.burnInterval;
    }

    updateBurn() {
        if (!this.alive || this.burnTimer <= 0) return false;
        this.burnTimer--;
        this.burnTickTimer--;
        if (this.burnTickTimer > 0) return false;
        this.burnTickTimer = this.burnInterval;
        this.burnPulse = (this.burnPulse || 0) + 1;
        this.takeDamage(this.burnDamage);
        return true;
    }

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.alive = false;
            this.deathTimer = 15;
        }
    }

    /**
     * Shared pixel body. Subclasses pass their own colours and silhouette
     * width so every enemy is built the same way and reads as one family.
     */
    drawBody(ctx, dark, lit, size = this.radius * 2) {
        pixelRect(ctx, this.x, this.y, size + 4, size + 4, PALETTE.void);
        pixelRect(ctx, this.x, this.y, size, size, dark);
        pixelRect(ctx, this.x, this.y, size * 0.45, size * 0.45, lit);
        this.drawHealth(ctx, size);
        if (this.burnTimer > 0) {
            const pulse = Math.sin((this.burnPulse || 0) * 1.7 + this.x) * 3;
            pixelRect(ctx, this.x - size * 0.3, this.y - size * 0.55 - pulse, 5, 7, '#ff7428');
            pixelRect(ctx, this.x + size * 0.3, this.y - size * 0.45 + pulse, 4, 6, '#ffd34e');
        }
    }

    /** Health as discrete pips above the body — no smooth bars at this scale. */
    drawHealth(ctx, size) {
        if (this.health >= this.maxHealth) return;
        const pips = 5;
        const filled = Math.ceil((this.health / this.maxHealth) * pips);
        const pipW = 4, gap = 2;
        const totalW = pips * pipW + (pips - 1) * gap;
        const x0 = this.x - totalW / 2;
        const y = this.y - size / 2 - 10;
        for (let i = 0; i < pips; i++) {
            ctx.fillStyle = i < filled ? PALETTE.danger : PALETTE.blood;
            ctx.fillRect(snap(x0 + i * (pipW + gap)), snap(y), pipW, 3);
        }
    }

    draw(ctx) {
        this.drawBody(ctx, this.color, PALETTE.bone);
    }
}

// ===== Cochinilla Perforamuros — fixed-wall laser tester =====
class CochinillaPerforamuros extends Enemy {
    static sprites = null;
    static walkFrames = null;
    static walkFrameDurations = null;
    static walkPromise = null;
    static chargeFrames = null;
    static chargePromise = null;
    constructor(x, y, room, wall = 'left') {
        super(x, y, 'cochinilla-perforamuros');
        this.name = 'Cochinilla Perforamuros'; this.health = this.maxHealth = 36;
        this.radius = 7; this.speed = 1.1; this.color = '#d9c6a1'; this.xpValue = 0;
        this.room = room; this.wall = wall; this.phase = 'move';
        this.phaseTimer = 180 + Math.floor(Math.random() * 241);
        this.moveSign = Math.random() < 0.5 ? -1 : 1; this.lockedX = x; this.lockedY = y;
        this.warnFrames = 54; this.beamFrames = 180; this.recoverFrames = 120;
        this.beamWidth = 28;
        this.animationTick = 0; this.walkFrames = CochinillaPerforamuros.walkFrames;
        this.loadSprites();
        this.loadWalkFrames();
        this.loadChargeFrames();
    }
    loadSprites() {
        if (CochinillaPerforamuros.sprites || typeof Image === 'undefined') return;
        const root = '00-sprites/enemigos/cochinilla_perforamuros/';
        const load = file => { const image = new Image(); image.src = root + file; return image; };
        CochinillaPerforamuros.sprites = { charging: load('charging_cochinilla_perforamuros.png'), attack: load('attack_cochinilla_perforamuros.png') };
    }
    async loadWalkFrames() {
        if (CochinillaPerforamuros.walkFrames) { this.walkFrames = CochinillaPerforamuros.walkFrames; return; }
        if (typeof DecompressionStream === 'undefined') return;
        if (!CochinillaPerforamuros.walkPromise) CochinillaPerforamuros.walkPromise = (async () => {
            const response = await fetch('00-sprites/enemigos/cochinilla_perforamuros/walk_cochinilla_perforamuros.aseprite?v=walk-frames-0-25x');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = new DataView(await response.arrayBuffer());
            const frameCount = data.getUint16(6, true), frames = [], durations = [];
            let frameOffset = 128;
            for (let f = 0; f < frameCount; f++) {
                const frameBytes = data.getUint32(frameOffset, true), chunkCount = data.getUint16(frameOffset + 6, true);
                durations.push(data.getUint16(frameOffset + 8, true) || 100);
                const canvas = document.createElement('canvas'); canvas.width = data.getUint16(8, true); canvas.height = data.getUint16(10, true);
                const ctx = canvas.getContext('2d'); let chunkOffset = frameOffset + 16;
                for (let c = 0; c < chunkCount; c++) {
                    const size = data.getUint32(chunkOffset, true), type = data.getUint16(chunkOffset + 4, true), q = chunkOffset + 6;
                    if (type === 0x2005 && data.getUint16(q + 7, true) === 2) {
                        const x = data.getInt16(q + 2, true), y = data.getInt16(q + 4, true);
                        const w = data.getUint16(q + 16, true), h = data.getUint16(q + 18, true);
                        const start = q + 20, end = chunkOffset + size;
                        const stream = new Blob([new Uint8Array(data.buffer, start, end - start)]).stream().pipeThrough(new DecompressionStream('deflate'));
                        const rgba = new Uint8ClampedArray(await new Response(stream).arrayBuffer());
                        ctx.putImageData(new ImageData(rgba, w, h), x, y);
                    }
                    chunkOffset += size;
                }
                frames.push(canvas); frameOffset += frameBytes;
            }
            return { frames, durations };
        })();
        try {
            const animation = await CochinillaPerforamuros.walkPromise;
            this.walkFrames = CochinillaPerforamuros.walkFrames = animation.frames;
            CochinillaPerforamuros.walkFrameDurations = animation.durations;
        }
        catch (error) { CochinillaPerforamuros.walkPromise = null; console.warn('No se pudo cargar la caminata Aseprite de la Cochinilla.', error); }
    }
    async loadChargeFrames() {
        if (CochinillaPerforamuros.chargeFrames) { this.chargeFrames = CochinillaPerforamuros.chargeFrames; return; }
        if (typeof DecompressionStream === 'undefined') return;
        if (!CochinillaPerforamuros.chargePromise) CochinillaPerforamuros.chargePromise = (async () => {
            const response = await fetch('00-sprites/enemigos/cochinilla_perforamuros/charging_cochinilla_perforamuros.aseprite');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = new DataView(await response.arrayBuffer());
            const frameCount = data.getUint16(6, true), frames = [];
            let frameOffset = 128;
            for (let f = 0; f < frameCount; f++) {
                const frameBytes = data.getUint32(frameOffset, true), chunkCount = data.getUint16(frameOffset + 6, true);
                const canvas = document.createElement('canvas'); canvas.width = data.getUint16(8, true); canvas.height = data.getUint16(10, true);
                const ctx = canvas.getContext('2d'); let chunkOffset = frameOffset + 16;
                for (let c = 0; c < chunkCount; c++) {
                    const size = data.getUint32(chunkOffset, true), type = data.getUint16(chunkOffset + 4, true), q = chunkOffset + 6;
                    if (type === 0x2005 && data.getUint16(q + 7, true) === 2) {
                        const x = data.getInt16(q + 2, true), y = data.getInt16(q + 4, true);
                        const w = data.getUint16(q + 16, true), h = data.getUint16(q + 18, true);
                        const stream = new Blob([new Uint8Array(data.buffer, q + 20, chunkOffset + size - q - 20)]).stream().pipeThrough(new DecompressionStream('deflate'));
                        const rgba = new Uint8ClampedArray(await new Response(stream).arrayBuffer());
                        ctx.putImageData(new ImageData(rgba, w, h), x, y);
                    }
                    chunkOffset += size;
                }
                frames.push(canvas); frameOffset += frameBytes;
            }
            return frames;
        })();
        try { this.chargeFrames = CochinillaPerforamuros.chargeFrames = await CochinillaPerforamuros.chargePromise; }
        catch (error) { CochinillaPerforamuros.chargePromise = null; console.warn('No se pudo cargar la animación de carga de la Cochinilla.', error); }
    }
    update() {
        const r = this.room, inset = 13;
        const previousPhase = this.phase;
        if (this.phase === 'move') {
            this.animationTick++;
            if (this.wall === 'left' || this.wall === 'right') {
                this.y += this.speed * this.moveSign;
                if (this.y < r.y + inset || this.y > r.y + r.h - inset) { this.y = Math.max(r.y + inset, Math.min(r.y + r.h - inset, this.y)); this.moveSign *= -1; }
            } else {
                this.x += this.speed * this.moveSign;
                if (this.x < r.x + inset || this.x > r.x + r.w - inset) { this.x = Math.max(r.x + inset, Math.min(r.x + r.w - inset, this.x)); this.moveSign *= -1; }
            }
            if (--this.phaseTimer <= 0) { this.phase = 'warning'; this.phaseTimer = this.warnFrames; this.lockedX = this.x; this.lockedY = this.y; }
        } else {
            this.x = this.lockedX; this.y = this.lockedY;
            if (--this.phaseTimer <= 0) {
                if (this.phase === 'warning') { this.phase = 'beam'; this.phaseTimer = this.beamFrames; }
                else if (this.phase === 'beam') { this.phase = 'recover'; this.phaseTimer = this.recoverFrames; }
                else { this.phase = 'move'; this.phaseTimer = 180 + Math.floor(Math.random() * 241); }
            }
        }
        return this.phase !== previousPhase ? this.phase : null;
    }
    takeDamage(amount) {
        // The shell is vulnerable only while the laser is actively exposed.
        if (!this.alive || this.phase !== 'beam') return false;
        super.takeDamage(amount);
        return true;
    }
    touchesBeam(p) {
        if (this.phase !== 'beam') return false;
        const horizontal = this.wall === 'left' || this.wall === 'right';
        return horizontal ? Math.abs(p.y - this.y) <= this.beamWidth / 2 + p.radius && p.x + p.radius >= this.room.x && p.x - p.radius <= this.room.x + this.room.w
            : Math.abs(p.x - this.x) <= this.beamWidth / 2 + p.radius && p.y + p.radius >= this.room.y && p.y - p.radius <= this.room.y + this.room.h;
    }
    draw(ctx) {
        const horizontal = this.wall === 'left' || this.wall === 'right';
        const sx = this.wall === 'left' ? this.room.x : this.wall === 'right' ? this.room.x + this.room.w : this.x;
        const sy = this.wall === 'top' ? this.room.y : this.wall === 'bottom' ? this.room.y + this.room.h : this.y;
        if (this.phase === 'warning' || this.phase === 'beam') {
            ctx.save(); ctx.globalAlpha = this.phase === 'warning' ? 0.55 : 0.9;
            ctx.strokeStyle = this.phase === 'warning' ? '#fff5d6' : '#ff402c'; ctx.lineWidth = this.beamWidth;
            ctx.beginPath(); ctx.moveTo(horizontal ? sx : this.x, horizontal ? this.y : sy);
            ctx.lineTo(horizontal ? (this.wall === 'left' ? this.room.x + this.room.w : this.room.x) : this.x,
                horizontal ? this.y : (this.wall === 'top' ? this.room.y + this.room.h : this.room.y)); ctx.stroke(); ctx.restore();
        }
        const sprite = CochinillaPerforamuros.sprites;
        let walkImage = null;
        if (this.walkFrames?.length) {
            const durations = CochinillaPerforamuros.walkFrameDurations || this.walkFrames.map(() => 100);
            const cycleMs = durations.reduce((sum, duration) => sum + duration, 0);
            // Match the Aseprite preview playback speed shown for this revision.
            let frameMs = (this.animationTick * 1000 / 60 * 0.25) % cycleMs;
            let frameIndex = 0;
            while (frameIndex < durations.length - 1 && frameMs >= durations[frameIndex]) frameMs -= durations[frameIndex++];
            walkImage = this.walkFrames[frameIndex];
        }
        // Keep a solid shell sprite under the short charge overlay. The
        // charging art is mostly transparent and looked like the enemy blinked out.
        // During the attack, show the attack PNG alone for the full beam phase.
        const baseImage = this.phase === 'beam' ? sprite?.attack : (walkImage || sprite?.attack);
        const chargeFrame = this.chargeFrames?.length
            ? this.chargeFrames[Math.min(this.chargeFrames.length - 1, Math.floor((this.warnFrames - this.phaseTimer) * this.chargeFrames.length / this.warnFrames))]
            : sprite?.charging;
        const actionImage = this.phase === 'warning' ? chargeFrame : null;
        const wallRotation = { top: 0, right: Math.PI / 2, bottom: Math.PI, left: -Math.PI / 2 }[this.wall] || 0;
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(wallRotation);
        let drewSprite = false;
        if (baseImage?.complete !== false && baseImage && (baseImage.naturalWidth || baseImage.width)) {
            ctx.drawImage(baseImage, -12, -8, 24, 16); drewSprite = true;
        }
        if (actionImage?.complete !== false && actionImage && (actionImage.naturalWidth || actionImage.width)) {
            ctx.drawImage(actionImage, -12, -8, 24, 16); drewSprite = true;
        }
        if (!drewSprite) this.drawBody(ctx, '#705843', '#e1c49b', 24);
        ctx.restore();
        this.drawHealth(ctx, 24);
    }
}

// ===== BasicEnemy — Chaser =====
class BasicEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'basic');
        this.health = 30;
        this.maxHealth = 30;
        this.speed = 2.2;
        this.damage = 10;
        this.radius = 14;
        this.color = '#ff4444';
        this.xpValue = 10;
        this.shootCooldown = 90;
    }

    draw(ctx) {
        this.drawBody(ctx, PALETTE.chaser, PALETTE.chaserLit);
    }

    update(player, enemies, map) {
        // Route around walls instead of pushing straight into them.
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            this.steerTo(player.x, player.y, map);
        }

        // Shoot toward player
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            const angle = Math.atan2(dy, dx);
            return [this.shootTowardPlayer(angle, 3)];
        }
        return [];
    }
}

// ===== ShooterEnemy — Sniper (keeps distance) =====
class ShooterEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'shooter');
        this.health = 20;
        this.maxHealth = 20;
        this.speed = 1.5;
        this.damage = 15;
        this.radius = 12;
        this.color = '#aa44ff';
        this.xpValue = 15;
        this.shootCooldown = 60;
    }

    draw(ctx) {
        // Narrower silhouette so the sniper reads as distinct at a glance
        this.drawBody(ctx, PALETTE.shooter, PALETTE.shooterLit, this.radius * 1.7);
    }

    update(player, enemies, map) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Keep distance: back off inside 180px, close in beyond 250px
        if (dist < 180) {
            this.retreatFrom(player.x, player.y, map);
        } else if (dist > 250) {
            this.steerTo(player.x, player.y, map);
        } else {
            // In the firing band: drop any stale route so it does not resume
            // a chase when the player moves again.
            this._navPath = null;
            this._navTimer = 0;
        }

        // Shoot
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            return [this.shootTowardPlayer(Math.atan2(dy, dx), 5)];
        }
        return [];
    }
}

// ===== SpiralEnemy — Pattern Shooter =====
class SpiralEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'spiral');
        this.health = 50;
        this.maxHealth = 50;
        this.speed = 1.2;
        this.damage = 8;
        this.radius = 16;
        this.color = '#ff8800';
        this.xpValue = 20;
        this.shootCooldown = 45;
        this.spiralAngle = 0;
    }

    draw(ctx) {
        this.drawBody(ctx, PALETTE.spiral, PALETTE.spiralLit);
        // Four orbiting pips telegraph the ring attack
        for (let i = 0; i < 4; i++) {
            const a = this.spiralAngle + (Math.PI / 2) * i;
            pixelRect(ctx, this.x + Math.cos(a) * (this.radius + 8),
                           this.y + Math.sin(a) * (this.radius + 8),
                           4, 4, PALETTE.spiralLit);
        }
    }

    update(player, enemies, map) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Move slowly toward player, stop at ~150px
        if (dist > 140) {
            this.steerTo(player.x, player.y, map);
        }

        // Spiral bullet pattern
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            const bullets = [];
            const count = 5;
            for (let i = 0; i < count; i++) {
                const angle = this.spiralAngle + (Math.PI * 2 / count) * i;
                bullets.push(this.shootTowardPlayer(angle, 2.5));
            }
            this.spiralAngle += 0.4; // rotate pattern each shot
            return bullets;
        }
        return [];
    }
}

// ===== BossEnemy — Boss =====
class BossEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'boss');
        this.health = 500;
        this.maxHealth = 500;
        this.speed = 0.8;
        this.damage = 20;
        this.radius = 40;
        this.color = '#8b0000';
        this.xpValue = 200;
        this.shootCooldown = 30;
        this.phase = 0;
        this.phaseTimer = 0;
        this.phaseDuration = 100; // frames per phase
        this.centerX = x;
        this.centerY = y;
        this.driftAngle = 0;
        this.orbitRadiusX = 80;
        this.orbitRadiusY = 60;
        this.room = null;
        this._driftStall = 0;
    }

    /**
     * Drift target that still fits the boss body. The orbit circle is shrunk
     * until the 40px footprint is on walkable floor, and (when the room is
     * known) inside the boss hall. This keeps the desired path away from red
     * wall lines and blue obstacles instead of only stopping after impact.
     */
    _orbitTarget(map) {
        if (!map) return {
            x: this.centerX + Math.cos(this.driftAngle) * this.orbitRadiusX,
            y: this.centerY + Math.sin(this.driftAngle) * this.orbitRadiusY
        };
        const room = this.room || map.bossRoom || null;
        const cos = Math.cos(this.driftAngle), sin = Math.sin(this.driftAngle);
        for (let scale = 1; scale >= 0.2; scale -= 0.1) {
            const x = this.centerX + cos * this.orbitRadiusX * scale;
            const y = this.centerY + sin * this.orbitRadiusY * scale;
            if (!map.canOccupy(x, y, this.radius)) continue;
            if (room && map.pointInRoom(x, y) !== room) continue;
            return { x, y };
        }
        return { x: this.x, y: this.y };
    }

    /** Map-aware orbit movement; never assigns a position without collision. */
    _drift(map) {
        const target = this._orbitTarget(map);
        if (!map) { this.x = target.x; this.y = target.y; return; }
        if (this.steerTo(target.x, target.y, map, this.speed)) {
            this._driftStall = 0;
            return;
        }
        // Blocked by a wall or obstacle: turn the orbit and try again instead
        // of pressing into the same corner forever.
        if (++this._driftStall > 12) {
            this._driftStall = 0;
            this.driftAngle += Math.PI / 2;
        }
    }

    update(player, enemies, map) {
        // Drift in a slow circle around center, but move through the same
        // collision grid as every other enemy: the boss is far too large to
        // be teleported across authored red walls or blue obstacles.
        this.driftAngle += 0.01;
        this._drift(map);

        // Phase changes
        this.phaseTimer++;
        if (this.phaseTimer >= this.phaseDuration) {
            this.phaseTimer = 0;
            this.phase = (this.phase + 1) % 3;
        }

        // Attack based on phase
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            const bullets = [];
            const angleToPlayer = Math.atan2(player.y - this.y, player.x - this.x);

            switch (this.phase) {
                case 0: // Spiral — 8 bullets
                    for (let i = 0; i < 8; i++) {
                        bullets.push(this.shootTowardPlayer(
                            (Math.PI * 2 / 8) * i + this.phaseTimer * 0.05,
                            2.5
                        ));
                    }
                    break;
                case 1: // Aimed burst — 3 fast bullets
                    for (let i = -1; i <= 1; i++) {
                        bullets.push(this.shootTowardPlayer(angleToPlayer + i * 0.2, 5));
                    }
                    break;
                case 2: // Circle burst — 12 slow bullets
                    for (let i = 0; i < 12; i++) {
                        bullets.push(this.shootTowardPlayer(
                            (Math.PI * 2 / 12) * i,
                            2
                        ));
                    }
                    break;
            }
            return bullets;
        }
        return [];
    }

    draw(ctx) {
        const r = this.radius;

        // Slab body with a pulsing core keyed to the current phase
        pixelRect(ctx, this.x, this.y, r * 2 + 8, r * 2 + 8, PALETTE.void);
        pixelRect(ctx, this.x, this.y, r * 2, r * 2, PALETTE.boss);
        pixelRect(ctx, this.x, this.y, r, r, PALETTE.bossLit);

        const pulse = 6 + Math.sin(this.driftAngle * 6) * 3;
        pixelRect(ctx, this.x, this.y, pulse, pulse, PALETTE.hud);

        // Corner studs
        for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
            pixelRect(ctx, this.x + sx * r, this.y + sy * r, 8, 8, PALETTE.bossLit);
        }

        // Phase pips
        for (let i = 0; i < 3; i++) {
            pixelRect(ctx, this.x - 14 + i * 14, this.y - r - 20, 8, 8,
                      i <= this.phase ? PALETTE.hud : PALETTE.blood);
        }

        // Wide health bar, drawn as discrete blocks
        const blocks = 12;
        const filled = Math.ceil((this.health / this.maxHealth) * blocks);
        const bw = 7, gap = 2;
        const total = blocks * bw + (blocks - 1) * gap;
        const x0 = this.x - total / 2, y = this.y - r - 10;
        for (let i = 0; i < blocks; i++) {
            ctx.fillStyle = i < filled ? PALETTE.danger : PALETTE.blood;
            ctx.fillRect(snap(x0 + i * (bw + gap)), snap(y), bw, 4);
        }
    }
}

/**
 * Create an enemy instance from a type string.
 */
function createEnemy(type, x, y) {
    switch (type) {
        case 'basic':    return new BasicEnemy(x, y);
        case 'shooter':  return new ShooterEnemy(x, y);
        case 'spiral':   return new SpiralEnemy(x, y);
        case 'boss':     return new BossEnemy(x, y);
        default:         return new BasicEnemy(x, y);
    }
}

/**
 * Pick a random non-boss enemy type, weighted.
 */
function randomEnemyType() {
    const types = ['basic', 'basic', 'basic', 'shooter', 'shooter', 'spiral'];
    return types[Math.floor(Math.random() * types.length)];
}

/**
 * Pick a mixed enemy type for hard rooms.
 */
function hardEnemyType() {
    const types = ['basic', 'shooter', 'spiral', 'shooter', 'spiral'];
    return types[Math.floor(Math.random() * types.length)];
}
