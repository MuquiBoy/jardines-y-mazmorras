/**
 * Enemy classes â€” base class and 3 enemy types + boss.
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
 * Floors completed beyond the end of the ramp. 0 up to floor 10, then 1, 2, â€¦
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
 * hard â€” an enemy faster than the player, or firing continuously, stops being
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
        this.speed = 0.75;
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
     * Find the first point of obstruction along a ray using the existing
     * collision grid. Used by the corner cochinilla to clamp both drawing and
     * damage to walls.
     */
    raycastObstacle(map, startX, startY, dirX, dirY, maxDist = 2000, step = 4) {
        if (!map || !Number.isFinite(dirX) || !Number.isFinite(dirY)) {
            return { x: startX + dirX * maxDist, y: startY + dirY * maxDist, hit: false, dist: maxDist };
        }
        const len = Math.hypot(dirX, dirY) || 1;
        const dx = dirX / len;
        const dy = dirY / len;
        const samples = Math.ceil(maxDist / step);
        for (let i = 1; i <= samples; i++) {
            const dist = i * step;
            if (dist > maxDist) break;
            const x = startX + dx * dist;
            const y = startY + dy * dist;
            if (!map.isWalkable(x, y)) {
                return { x: startX + dx * Math.max(0, dist - step), y: startY + dy * Math.max(0, dist - step), hit: true, dist: Math.max(0, dist - step) };
            }
        }
        return { x: startX + dx * maxDist, y: startY + dy * maxDist, hit: false, dist: maxDist };
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

    shootTowardPlayer(angle, speed = 1.5, projectilePool = null) {
        const v = speed * this.bulletSpeedScale;
        // Universal projectile rules:
        // - standard enemy projectile: 6 HP
        // - boss special projectile: 12 HP (marked via bullet.type === 'boss-special')
        const dmg = (this.type === 'boss') ? 12 : 6;
        if (projectilePool && typeof projectilePool.acquire === 'function') {
            return projectilePool.acquire(this, angle, speed);
        }
        return {
            x: this.x,
            y: this.y,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v,
            damage: dmg,
            radius: 6,
            color: this.color,
            speed: v,
            projectileType: (this.type === 'boss') ? 'boss-special' : 'standard',
            faction: 'enemy',
            ownerId: this.id ?? null,
            enemyId: this.id ?? null,
            active: true
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
        // frame â€” the whole room volleys the instant the player walks in.
        // Start it partway through a randomised cooldown instead, so shots are
        // staggered and the player gets a moment to read the room.
        this.shootTimer = Math.round(this.shootCooldown * (0.6 + Math.random() * 0.6));
    }

    applyBurn(burn) {
        this.burnDamage = Math.max(this.burnDamage || 0, burn.damage);
        this.burnInterval = burn.interval;
        this.burnTimer = Math.max(this.burnTimer || 0, burn.duration);
        this.burnOwnerId = burn.ownerId || this.burnOwnerId;
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

    /** Health as discrete pips above the body â€” no smooth bars at this scale. */
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

/** Enemy kill XP is disabled; other reward systems remain available. */
Enemy.ENEMY_XP_REWARDS_ENABLED = false;

// ===== Cochinilla Perforamuros â€” fixed-wall laser tester =====
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
        this.radius = 7; this.speed = 0.55; this.color = '#d9c6a1'; this.xpValue = 0;
        this.room = room; this.wall = wall; this.phase = 'move';
        this.phaseTimer = 180 + Math.floor(Math.random() * 241);
        this.moveSign = Math.random() < 0.5 ? -1 : 1; this.lockedX = x; this.lockedY = y;
        this.warnFrames = 54; this.beamFrames = 180; this.recoverFrames = 120;
        this.beamWidth = 28;
        this.laserDamagePerTick = 6;
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
                const canvas = document.createElement('canvas'); canvas.width = data.getUint16(8, true); canvas.height = data.getUint16(10, true)=yë]­¢G§²ÚîÆ­yÜÊ
HÛÜÙ\ÈHÛÜœÃBˆËÈÛ˜ÙHH^Y\ˆ\ÈÛX\ˆÙˆH™\ÚÛ[™Û›H[ƒBˆËÈÜ]ÛœÈH[™[ZY\ËÛÈ›Ø›ÙHšYÚÈ›ÝYÚHÛÜØ^KƒBˆËÈH›ÜÜÈ[ÙX[È^XÝHZÙHHÛÛX˜]›ÛÛNÈ]ÃBˆËÈÛÜœÈ™[Ü[ˆÚ[ˆH›ÜÜÈY\È
Û›ÜÜÑY™X]Y
KƒBˆ™]Ô›ÛÛK›ØÚÔ[™[™ÈHYNÃBˆH[ÙHÃBˆ\ËœÜ]Û”›ÛÛQ[™[ZY\Ê™]Ô›ÛÛJNÃBˆ™]Ô›ÛÛKœÜ]Û™YHYNÃBˆCBˆCBˆ\Ë˜Ý\œ™[›ÛÛHH™]Ô›ÛÛNÃBˆCBƒBˆËÈÚXÚÈYˆ^Y\ˆ\È]^]BˆYˆ
\Ë›X\™^]
HÃBˆÛÛœÝ^]H\Ë›X\™^]ÃBˆÛÛœÝH\Ëœ^Y\‹žH^]žÃBˆÛÛœÝHH\Ëœ^Y\‹žHH^]žNÃBˆÛÛœÝ\ÝHX]œÜ\

ˆ
ÈH
ˆJNÃBƒBˆYˆ
\ÝL
HÃBˆËÈH^]Û›H^\ÝÈÛ˜ÙHH›ÜÜÈ\ÈXYÛÈ™XXÚ[™È]\ÃBˆËÈ›ÛÙˆ[›ÝYÚ8 %›È›ÛÛK]\HÚXÚÈ™YYY
[™H›ÛÛH]BˆËÈÜ[œÈ[ˆ\ÈÚ]]™\ˆ›ÛÛHH^Y\ˆØ\ÈÝ[™[™È[ŠKƒBˆÃBˆËÈÝX\™ˆÚÚ\™]È˜[œÚ][ÛœÈÚ[HÛ™H\È[™XYH[ˆ›ÙÜ™\ÜÃBˆYˆ
\Ë˜[œÚ][Ûš[™ÊH™]\›ŽÃBƒBˆ\Ë˜[œÚ][Ûš[™ÈHYNÃBˆ\Ë˜[œÚ][Û[HHÃBˆ\ËœÝ]HH	ÕS”ÒUSÓ’S‘ÉÎÃBƒBˆËÈ[š[X]H˜YCBˆÛÛœÝ˜YR[\˜[HÙ][\˜[


HOˆÃBˆ\Ë˜[œÚ][Û[H
ÏHŒNÃBˆYˆ
\Ë˜[œÚ][Û[HHJHÃBˆÛX\’[\˜[
˜YR[\˜[
NÃBˆ\Ë™›ÛÜŠÊÎÃBˆ\Ë˜]Y[Ë™\ØÙ[™

NÃBˆ\Ë˜]Y[Ë›™^˜XÚÊ
NÃBˆ\Ë™Ù[™\˜]SX\

NÃBˆ\ËZK™˜]Ó›ÝYšXØ][ÛŠ\Ë˜Ý“ÓÔˆ	Ý\Ë™›ÛÜŸX
NÃBˆ\Ë˜[œÚ][Û[HHNÃBƒBˆÛÛœÝ˜YP˜XÚÈHÙ][\˜[


HOˆÃBˆ\Ë˜[œÚ][Û[HOHŒNÃBˆYˆ
\Ë˜[œÚ][Û[HH
HÃBˆ\Ë˜[œÚ][Ûš[™ÈH˜[ÙNÃBˆ\Ë˜[œÚ][Û[HHÃBˆ\ËœÝ]HH	ÔVRS‘ÉÎÃBˆÛX\’[\˜[
˜YP˜XÚÊNÃBˆËÈ™\Ý\HØ[YHÛÜÛÈ^Y\ˆØ[ˆÛÛ[YH^Z[™ÃBˆ\ËœÝ\ÛÜ

NÃBˆCBˆKMŠNÃBˆCBˆKMŠNÃBˆCBˆCBˆCBˆËÈ˜XÚÈÛX\™Y›ÛÛ\ÃBˆ›Üˆ
ÛÛœÝ›ÛÛHÙˆ\Ë›X\œ›ÛÛ\ÊHÃBˆËÈH›ÛÛHH^Y\ˆ\È™]™\ˆ[\™Y\Û‰Ý˜ÛX\™Yˆ8 %]	ÜÈ[š\Ú]YƒBˆYˆ
›ÛÛKœÜ]Û™Y	‰ˆ\›ÛÛK˜ÛX\™Y	‰ˆ\Ëš\Ô›ÛÛPÛX\™Y
›ÛÛJJHÃBˆ\Ë›X\˜ÛX\”›ÛÛJ›ÛÛJNÃBˆ\Ëœ›ÛÛ\ÐÛX\™Y
ÊÎÃBˆCBˆCBˆ\Ë\]T›ÛÛSØÚÜÊ
NÃBˆCBƒBˆÊŠˆÛÜÙHÛÛX˜]\›ÛÛHÛÜœÈÛ˜ÙHH^Y\ˆ\ÈØY™[H[œÚYKˆ
‹ÃBˆ\]T›ÛÛSØÚÜÊ
HÃBˆÛÛœÝ›ØÚÙ\œÈH\Ë™[™[ZY\Ë™š[\Š[™[^HOˆ[™[^K˜[]™JNÃBˆ›Üˆ
ÛÛœÝ›ÛÛHÙˆ\Ë›X\œ›ÛÛ\ÊHÃBˆYˆ
\›ÛÛK›ØÚÔ[™[™È›ÛÛK›ØÚÙY›ÛÛK˜ÛX\™Y
HÛÛ[YNÃBˆYˆ
]\Ë›X\˜Ø[“ØÚÔ›ÛÛJ›ÛÛKÝ\Ëœ^Y\—K›ØÚÙ\œÊJHÛÛ[YNÃBˆ\Ë›X\›ØÚÔ›ÛÛJ›ÛÛJNÃBˆËÈH›ÛÛH\ÈÙX[Yš\œÝÈH[˜ÛÝ[\ˆÝ\È™Z[™ÛÜÙYBˆËÈÛÜœËˆÜ]Û™Y[ÛÈÙY\ÈH[\H›ÛÛHœ›ÛH™Z[™ÈÛÝ[YBˆËÈ\ÈÛX\™Y\š[™ÈHœ˜[Y\È™Y›Ü™HHØÚÈ[™ËƒBˆYˆ
\›ÛÛKœÜ]Û™Y
HÃBˆ\ËœÜ]Û”›ÛÛQ[™[ZY\Ê›ÛÛJNÃBˆ›ÛÛKœÜ]Û™YHYNÃBˆCBˆCBˆCBƒBˆÊŠˆÚXÚÈYˆ[[™[ZY\È[ˆH›ÛÛH\™HXYˆ
‹ÃBˆ\Ô›ÛÛPÛX\™Y
›ÛÛJHÃBˆÛÛœÝ›ÛÛR[™^H\Ë›X\œ›ÛÛ\Ëš[™^ÙŠ›ÛÛJNÃBˆ›Üˆ
ÛÛœÝ[™[^HÙˆ\Ë™[™[ZY\ÊHÃBˆYˆ
Y[™[^K˜[]™JHÛÛ[YNÃBˆYˆ
[™[^Kœ›ÛÛR[™^OOH[™Yš[™Y
HÃBˆYˆ
[™[^Kœ›ÛÛR[™^OOH›ÛÛR[™^
H™]\›ˆ˜[ÙNÃBˆÛÛ[YNÃBˆCBˆYˆ
[™[^KžH›ÛÛKž	‰ˆ[™[^Kž›ÛÛKž
È›ÛÛKÈ	‰ƒBˆ[™[^KžHH›ÛÛKžH	‰ˆ[™[^KžH›ÛÛKžH
È›ÛÛKš
HÃBˆ™]\›ˆ˜[ÙNÃBˆCBˆCBˆ™]\›ˆYNÃBˆCBƒBˆÊŠˆY[™]Y]YH]™\žH]™[Ü›ÜÜÙY›ÝÛ›HHš\œÝˆ
‹ÃBˆ]Ø\™
[[Ý[
HÃBˆYˆ
J[[Ý[ˆ
JH™]\›ˆÃBˆÛÛœÝ]™[ÈH\Ëœ^Y\‹™ØZ[–
[[Ý[
NÃBˆ\Ëœ[™[™Ó]™[\È
ÏH]™[ÎÃBˆ™]\›ˆ]™[ÎÃBˆCBƒBˆÊŠˆ[™H]™[\8 %ÚÝÈ\Ü˜YHÙ[XÝ[Û‹ˆ
‹ÃBˆ[™S]™[\

HÃBˆ\ËœÝ]HH	ÓU‘SÕT	ÎÃBˆ\Ë˜]Y[Ë›]™[\

NÃBƒBˆËÈXÚÈÈ˜[™ÛH\Ü˜Y\ÃBˆÛÛœÝÚY™›YHË‹‹\Ë\Ü˜Y\×KœÛÜ


HOˆX]œ˜[™ÛJ
HHJNÃBˆÛÛœÝÚÚXÙ\ÈHÚY™›YœÛXÙJÊNÃBƒBˆ\ËœÙ[XÝY\Ü˜YHH[ÃBƒBˆ\ËZKœÚÝÓ]™[\
ÚÚXÙ\Ë
\Ü˜YJHOˆÃBˆ\ËœÙ[XÝY\Ü˜YHH\Ü˜YNÃBˆJNÃBˆCBƒBˆÊŠˆ\HHÙ[XÝY\Ü˜YKˆ
‹ÃBˆ\U\Ü˜YJ
HÃBˆYˆ
]\ËœÙ[XÝY\Ü˜YJHÃBˆËÈÚÝÈHœšYYˆ›ÝYšXØ][Ûˆ]›È\Ü˜YHØ\ÈÙ[XÝYBˆ\ËZK™˜]Ó›ÝYšXØ][ÛŠ\Ë˜Ý	Ó›È\Ü˜YHÙ[XÝYIÊNÃBˆ™]\›ŽÃBˆCBƒBˆYˆ
\Ë˜ÛÛÜ[ÙJHÃBˆËÈHÙ\™\ˆÝÛœÈH^Y\‰ÜÈÝ]È[ˆÛË[ÜˆÙ[™HÚÜÙ[ˆYBˆËÈ[™]H]]Üš]]]™H[ˆ\H]ÈH™^Û˜\ÚÝÚÝÜÃBˆËÈH™]È[X™\œÈ[™ÛX\œÈH™^]Y]YY]™[ƒBˆÚ[™ÝË˜ÛÛÜØ[YOË››ÝU\Ü˜YTÙ[

NÃBˆÚ[™ÝË˜ÛÛÜÛY[ËœÙ[™
È\Nˆ	Ý\Ü˜YIË\Ü˜YRYˆ\ËœÙ[XÝY\Ü˜YKšYJNÃBˆ\ËœÙ[XÝY\Ü˜YHH[ÃBˆ\ËZKšYS]™[\

NÃBˆ\ËœÝ]HH	ÔVRS‘ÉÎÃBˆ™]\›ŽÃBˆCBƒBˆ\ËœÙ[XÝY\Ü˜YK˜\J\Ëœ^Y\ŠNÃBˆ\ËZKšYS]™[\

NÃBˆËÈØ[YH\È[œ]\ÙNˆHU‘SÕTœ˜[˜ÚÙˆÛÜ

H™]™\ˆÝÜYHQƒBˆËÈÚZ[‹ÛÈÛÜ[›š[™È]\ÝÝ^HYKƒBˆ\ËœÝ]HH	ÔVRS‘ÉÎÃBˆCBƒBˆÊŠˆ[™HØ[YHÝ™\‹ˆ
‹ÃBˆØ[YSÝ™\Š
HÃBˆ\ËœÝ]HH	ÑÐSQWÓÕ‘T‰ÎÃBˆ\Ë˜]Y[Ë™Ø[YSÝ™\Š
NÃBˆ\ËZKšYS]™[\

NÃBˆ\ËZKœÚÝÒQ
˜[ÙJNÃBˆ\ËZKœÚÝÑØ[YSÝ™\Š\Ëœ^Y\‹›]™[\Ëœ›ÛÛ\ÐÛX\™Y\Ë™[™[ZY\ÒÚ[Y\Ë™›ÛÜŠNÃBˆ\Ë›ÛÜ[›š[™ÈH˜[ÙNÃBˆCBƒBˆÊŠˆ™[™\ˆHØ[YKˆ
‹ÃBˆ™[™\Š
HÃBˆÛÛœÝÝH\Ë˜ÝÃBˆÛÛœÝÕÈH\Ë˜Ø[˜\ËÚYÈËÈØ[˜\È
Ø[YK\^[
HÜXÙCBˆÛÛœÝÒH\Ë˜Ø[˜\ËšZYÚÃBƒBˆÝœÙ]˜[œÙ›Ü›JKK
NÃBˆÝš[XYÙTÛ[ÛÝ[™Ñ[˜X›YH˜[ÙNÃBƒBˆËÈÛX\ˆÈH›ÚYÛÛÝ\ƒBˆÝ™š[Ý[HHSUK›ÚYÃBˆÝ™š[™XÝ
ÕËÒ
NÃBƒBˆËÈØÜ™Y[ˆÚZÙK[ˆÛÜ›[š]Ë]X[\ÙYÈHÜšYÛÈHÚÛCBˆËÈ[XYÙH[\ÈžHÚÛH^[È˜]\ˆ[ˆÛYX\š[™ËƒBˆ]ÞHÞHHÃBˆYˆ
\ËœÚZÙHˆ
HÃBˆÛÛœÝXYÈH\ËœÚZÙNÃBˆÞHX]œ›Ý[™

X]œ˜[™ÛJ
HHJH
ˆXYÈ
ˆŠNÃBˆÞHHX]œ›Ý[™

X]œ˜[™ÛJ
HHJH
ˆXYÈ
ˆŠNÃBˆCBƒBˆËÈ[\ˆÛÜ›ÜXÙNˆH[š]HHÛÜ›^[˜]ÛˆÛÈHÛX[BˆËÈ˜XÚÚ[™ÈÝÜ™H]HØ[Y\˜H›ÛÛKÛÈ]™\ž][™È\È][\YYžCBˆËÈÐSQTWÖ“ÓÓHÈVSÔÒV‘KˆH[YÙ\ˆ˜XÝÜˆÙY\ÈH\Üš\ÜƒBˆÝœØ]™J
NÃBˆÝœØØ[JÐSQTWÖ“ÓÓHÈVSÔÒV‘KÐSQTWÖ“ÓÓHÈVSÔÒV‘JNÃBˆÝ˜[œÛ]JSX]œ›Ý[™
\Ë˜Ø[Y\˜Kž
H
ÈÞSX]œ›Ý[™
\Ë˜Ø[Y\˜KžJH
ÈÞJNÃBƒBˆYˆ
\Ë›X\
H\Ë›X\™˜]ÊÝ\Ë˜Ø[Y\˜K\ËšY]ÕÚY\ËšY]ÒZYÚ
NÃBƒBˆËÈÜ˜œÈ8 %Ü]X\™\ÈÚ]H[H[ÃBˆ›Üˆ
ÛÛœÝÜ˜ˆÙˆ\ËžÜ˜œÊHÃBˆ^[™XÝ
ÝÜ˜‹žÜ˜‹žKÜ˜‹œ˜Y]\È
ˆËÜ˜‹œ˜Y]\È
ˆËSUKžÛÝÊNÃBˆ^[™XÝ
ÝÜ˜‹žÜ˜‹žKÜ˜‹œ˜Y]\È
ˆK‹Ü˜‹œ˜Y]\È
ˆK‹SUKž
NÃBˆCBƒBˆËÈ\XÛ\È8 %Ú[šÞH[X™\œÈ]Úš[šÈ\È^HYCBˆ›Üˆ
ÛÛœÝÙˆ\Ëœ\XÛ\ÊHÃBˆÝ™ÛØ˜[[HHX]›X^
X]›Z[ŠK›Y™HÈ›X^Y™JJNÃBˆ^[™XÝ
ÝžžKœ˜Y]\È
ˆ‹œ˜Y]\È
ˆ‹˜ÛÛÜŠNÃBˆCBˆÝ™ÛØ˜[[HHNÃBƒBˆ›Üˆ
ÛÛœÝ[™[^HÙˆ\Ë™[™[ZY\ÊHÃBˆYˆ
[™[^K˜[]™JH[™[^K™˜]ÊÝ
NÃBˆCBƒBˆËÈÝ[[[ÛœÈÚÝÈZ\ˆÝÛˆX[[™™[XZ[ˆ[™\[™[œ›ÛHH[›ØØYÜ‹ƒBˆ›Üˆ
ÛÛœÝÝ[[[ÛˆÙˆ\ËœÝ[[[ÛœÈ×JHÃBˆYˆ
\Ý[[[Û‹˜[]™JHÛÛ[YNÃBˆ^[™XÝ
ÝÝ[[[Û‹žÝ[[[Û‹žKŽŽ	ÈÌÎLM	ÊNÃBˆ^[™XÝ
ÝÝ[[[Û‹žÝ[[[Û‹žKÝ[[[Û‹œ˜Y]\È
ˆKŽÝ[[[Û‹œ˜Y]\È
ˆKŽÝ[[[Û‹˜ÛÛÜŠNÃBˆ^[™XÝ
ÝÝ[[[Û‹žÝ[[[Û‹žK‹‹	ÈÙŒ™‰ÊNÃBˆÝ™š[Ý[HH	ÈÌXLŒ	ÎÃBˆÝ™š[™XÝ
Û˜\
Ý[[[Û‹žHLŠKÛ˜\
Ý[[[Û‹žHHÝ[[[Û‹œ˜Y]\ÈH
KÊNÃBˆÝ™š[Ý[HHÝ[[[Û‹˜ÛÛÜˆ	ÈØYMN	ÎÃBˆÝ™š[™XÝ
Û˜\
Ý[[[Û‹žHLŠKÛ˜\
Ý[[[Û‹žHHÝ[[[Û‹œ˜Y]\ÈH
K
ˆX]›X^
Ý[[[Û‹šX[ÈÝ[[[Û‹›X^X[
KÊNÃBˆCBƒBˆËÈ^Y\ˆ[]ÃBˆ›Üˆ
ÛÛœÝˆÙˆ\Ë˜[]ÊHÃBˆ^[™XÝ
Ý‹ž‹žK‹œ˜Y]\È
ˆ‹‹œ˜Y]\È
ˆ‹‹˜ÛÛÜˆSUKœ^Y\”ÚÝ
NÃBˆ^[™XÝ
Ý‹ž‹žK‹œ˜Y]\Ë‹œ˜Y]\ËSUK˜›Û™JNÃBˆCBƒBˆËÈ[™[^H[]È8 %Ý\‹Ú]HœšYÚÛÜ™HÛÈ^H™XYYØZ[œÝ›ÛÜƒBˆ›Üˆ
ÛÛœÝˆÙˆ\Ë™[™[^P[]ÊHÃBˆ^[™XÝ
Ý‹ž‹žK‹œ˜Y]\È
ˆ‹‹œ˜Y]\È
ˆ‹SUK˜›ÛÙ
NÃBˆ^[™XÝ
Ý‹ž‹žK‹œ˜Y]\È
ˆKK‹œ˜Y]\È
ˆKKSUK™[™[^TÚÝ
NÃBˆ^[™XÝ
Ý‹ž‹žK‹œ˜Y]\È
ˆË‹œ˜Y]\È
ˆËSUKšY
NÃBˆCBƒBˆYˆ
\Ëœ^Y\ˆ	‰ˆ\Ëœ^Y\‹šX[ˆ
H\Ëœ^Y\‹™˜]ÊÝ
NÃBˆ›Üˆ
ÛÛœÝ^Y\ˆÙˆ\Ëœ™[[ÝT^Y\œÈ×JHÃBˆYˆ
^Y\‹šX[ˆ
H^Y\‹™˜]ÊÝ
NÃBˆCBƒBˆËÈØš™XÝ]™HÚ]œ›Û‹ˆÚ]Ý][ˆ^]ÈXY›Ü‹H^Y\ˆÛÝ[™CBˆËÈ[[™ÈH›ÜÜÈ›ÛÛH›[™XÜ›ÜÜÈHÌX\ÛÈHX\šÙ\ˆÚ[ÃBˆËÈ]H›ÜÜÈš\œÝ[™H^]Û›HÛ˜ÙH]\ÈÜ[™YƒBˆYˆ
\Ë›X\	‰ˆ\Ëœ^Y\ŠHÃBˆÛÛœÝ\™Ù]H\Ë›X\™^]Bˆ
\Ë›X\˜›ÜÜÔ›ÛÛHÈÈˆ\Ë›X\˜›ÜÜÔ›ÛÛK˜ÞNˆ\Ë›X\˜›ÜÜÔ›ÛÛK˜ÞHHˆ[
NÃBˆYˆ
\™Ù]
HÃBˆÛÛœÝH\™Ù]žH\Ëœ^Y\‹žÃBˆÛÛœÝHH\™Ù]žHH\Ëœ^Y\‹žNÃBˆYˆ
X]š\Ý
JHˆM
HÃBˆÛÛœÝHHX]˜][ŒŠK
NÃBˆÛÛœÝH\Ëœ^Y\‹ž
ÈX]˜ÛÜÊJH
ˆŽÃBˆÛÛœÝHH\Ëœ^Y\‹žH
ÈX]œÚ[ŠJH
ˆŽÃBˆÛÛœÝÛÛH\Ë›X\™^]ÈSUK™^]ˆSUK™[™Ù\ŽÃBˆ^[™XÝ
ÝKKKÛÛ
NÃBˆ^[™XÝ
ÝKSUK›ÚY
NÃBˆCBˆCBˆCBƒBˆÝœ™\ÝÜ™J
NÃBƒBˆËÈKKKHØÜ™Y[‹\ÜXÙH\ÜÙ\Ë[ˆØ[˜\È^[ÈKKKCBƒBˆ\Ë™˜]ÕšYÛ™]JÝÕËÒ
NÃBƒBˆËÈ[XYÙH›\ÚˆH™YØ\Ú]˜Y\ÈÝ™\ˆ]È™[XZ[š[™Èœ˜[Y\ÃBˆYˆ
\Ë™[XYÙQ›\Úˆ
HÃBˆÝ™ÛØ˜[[HHX]›Z[ŠK\Ë™[XYÙQ›\ÚÈLŠNÃBˆÝ™š[Ý[HHSUK™[™Ù\ŽÃBˆÝ™š[™XÝ
ÕËÒ
NÃBˆÝ™ÛØ˜[[HHNÃBˆCBƒBˆËÈÝËZX[[ÙCBˆYˆ
\Ëœ^Y\ˆ	‰ˆ\Ëœ^Y\‹šX[ˆ	‰ƒBˆ\Ëœ^Y\‹šX[È\Ëœ^Y\‹›X^X[ŒÊHÃBˆÛÛœÝ[ÙHHŒLˆ
ÈŒ
ˆX]œÚ[Š\Ë™œ˜[YPÛÝ[
ˆŒMJNÃBˆÝ™ÛØ˜[[HH[ÙNÃBˆÝ™š[Ý[HHSUK˜›ÛÙÃBˆÝ™š[™XÝ
ÕËÒ
NÃBˆÝ™ÛØ˜[[HHNÃBˆCBƒBˆËÈ›ÛÛH˜[œÚ][Ûˆ˜YCBˆYˆ
\Ë˜[œÚ][Ûš[™ÊHÃBˆÝ™ÛØ˜[[HHX]›X^
X]›Z[ŠK\Ë˜[œÚ][Û[JJNÃBˆÝ™š[Ý[HHSUK›ÚYÃBˆÝ™š[™XÝ
ÕËÒ
NÃBˆÝ™ÛØ˜[[HHNÃBˆCBƒBˆ\ËZKœ™[™\“›ÝYšXØ][ÛŠÝ
NÃBƒBˆYˆ
\Ë›X\	‰ˆ\Ëœ^Y\ŠHÃBˆ\ËZK™[™[ZY\ÈH\Ë™[™[ZY\ÎÃBˆ\ËZK™˜]ÓZ[š[X\
\Ë›X\\Ë˜Ø[Y\˜K\Ëœ^Y\ŠNÃBˆCBˆCBƒBˆÊŠƒBˆ
ˆ\šÙ[ˆHYÙ\ÈÙˆHœ˜[YKƒBˆ
ƒBˆ
ˆØXÚY™XØ]\ÙHZ[[™ÈHÜ˜YY[]™\žHœ˜[YH\ÈØ\ÝY[[™™XZ[Bˆ
ˆÛ›HÚ[ˆHØ[˜\È[Y[œÚ[ÛœÈÚ[™ÙKƒBˆ
‹ÃBˆ˜]ÕšYÛ™]JÝË
HÃBˆYˆ
]\Ë—ÝšYÛ™]H\Ë—ÝšYÛ™]UÈOOHÈ\Ë—ÝšYÛ™]ROOH
HÃBˆÛÛœÝÈHÝ˜Ü™X]T˜YX[Ü˜YY[
BˆÈÈ‹È‹X]›Z[ŠË
H
ˆ‹BˆÈÈ‹È‹X]›X^
Ë
H
ˆÌƒBˆ
NÃBˆË˜YÛÛÜ”ÝÜ
	Ü™Ø˜J
IÊNÃBˆË˜YÛÛÜ”ÝÜ
K	Ü™Ø˜JJIÊNÃBˆ\Ë—ÝšYÛ™]HHÎÃBˆ\Ë—ÝšYÛ™]UÈHÎÃBˆ\Ë—ÝšYÛ™]RHÃBˆCBˆÝ™š[Ý[HH\Ë—ÝšYÛ™]NÃBˆÝ™š[™XÝ
Ë
NÃBˆCBŸCB