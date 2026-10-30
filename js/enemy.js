/**
 * Enemy classes — base class and 3 enemy types + boss.
 */

/** Random opening delay so a room does not volley on the same first frame. */
function initialEnemyShotDelay(cooldownFrames) {
    return Math.round(cooldownFrames * (0.6 + Math.random() * 0.6));
}


// ===== Base Enemy Class =====
class Enemy {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        // Override in a specific enemy class only when it needs another sprite.
        this.projectileVisualType = 'enemy-standard';
        this.health = 30;
        this.maxHealth = 30;
        this.movementSpeedMultiplier = 0.30;
        this.speed = movementSpeedFromMultiplier(this.movementSpeedMultiplier);
        this.damage = 10;
        this.radius = 14;
        this.color = '#ff4444';
        this.xpValue = 10;
        this.shootCooldown = 90;
        this.shootTimer = 0;
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

    /** Set authored movement relative to the universal player speed of 1.00. */
    setMovementSpeedMultiplier(multiplier) {
        if (!Number.isFinite(multiplier) || multiplier < 0) {
            throw new RangeError('Enemy movement speed multiplier must be a non-negative number.');
        }
        this.movementSpeedMultiplier = multiplier;
        this.speed = movementSpeedFromMultiplier(multiplier);
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
        const v = speed;
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
            radius: EnemyProjectilePool.HITBOX_RADIUS,
            color: this.color,
            speed: v,
            projectileType: (this.type === 'boss') ? 'boss-special' : 'standard',
            visualType: this.projectileVisualType || 'enemy-standard',
            faction: 'enemy',
            ownerId: this.id ?? null,
            enemyId: this.id ?? null,
            active: true
        };
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

/** Enemy kill XP is disabled; other reward systems remain available. */
Enemy.ENEMY_XP_REWARDS_ENABLED = false;

// ===== BossEnemy — Boss =====
class BossEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'boss');
        this.health = 500;
        this.maxHealth = 500;
        this.setMovementSpeedMultiplier(0.16);
        this.damage = 20;
        this.radius = 40;
        this.color = '#8b0000';
        this.xpValue = 200;
        this.shootCooldown = 30;
        this.shootTimer = initialEnemyShotDelay(this.shootCooldown);
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

    update(player, enemies, map, allTargets = null, projectilePool = null) {
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
                            1.25,
                            projectilePool
                        ));
                    }
                    break;
                case 1: // Aimed burst — 3 fast bullets
                    for (let i = -1; i <= 1; i++) {
                        bullets.push(this.shootTowardPlayer(angleToPlayer + i * 0.2, 2.5, projectilePool));
                    }
                    break;
                case 2: // Circle burst — 12 slow bullets
                    for (let i = 0; i < 12; i++) {
                        bullets.push(this.shootTowardPlayer(
                            (Math.PI * 2 / 12) * i,
                            1,
                            projectilePool
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
