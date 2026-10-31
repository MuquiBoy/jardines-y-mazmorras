/* Esbirro: clase independiente, cargada después de js/enemy.js. */
// ===== MoscaTirador — Sniper (keeps distance) =====
class MoscaTirador extends Enemy {
    static animation = null;
    static animationPromise = null;
    static DRAW_SIZE = 28;

    constructor(x, y) {
        super(x, y, 'mosca_tirador');
        this.name = 'Mosca Tirador';
        this.health = 28;
        this.maxHealth = 28;
        this.setMovementSpeedMultiplier(0.70);
        this.damage = 15;
        this.radius = 12;
        this.color = '#aa44ff';
        this.xpValue = 15;
        this.shootCooldown = 60;
        this.shootTimer = initialEnemyShotDelay(this.shootCooldown);
        this.coverPoint = null;
        this.coverSearchTimer = 0;
        this.tacticalGoal = null;
        this.tacticalReplanTimer = 0;
        this.tacticalStuckFrames = 0;
        this.tacticalGoalFrames = 0;
        this.trackedPlayer = null;
        this.animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        MoscaTirador.loadAnimation();
    }

    static loadAnimation() {
        if (MoscaTirador.animation) return MoscaTirador.animation;
        if (MoscaTirador.animationPromise) return MoscaTirador.animationPromise;
        if (typeof decodeAsepriteAnimation !== 'function') return null;
        const url = '00-sprites/enemigos/2_esbirros/mosca_tirador/mosca_tirador.aseprite?v=mosca-tirador-animation-folder-v1';
        MoscaTirador.animationPromise = decodeAsepriteAnimation(url)
            .then(animation => {
                if (animation) MoscaTirador.animation = animation;
                return animation;
            })
            .catch(error => {
                MoscaTirador.animationPromise = null;
                console.warn('No se pudo cargar la animación de la Mosca Tirador.', error);
                return null;
            });
        return MoscaTirador.animationPromise;
    }

    draw(ctx) {
        const animation = MoscaTirador.animation;
        if (!animation || !animation.frames.length || animation.totalDuration <= 0) return;

        // This one cycle is shared by idle and movement; it loops continuously.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameTime = (now - this.animationStartTime) % animation.totalDuration;
        let frameIndex = 0;
        while (frameIndex < animation.durations.length - 1 &&
               frameTime >= animation.durations[frameIndex]) {
            frameTime -= animation.durations[frameIndex++];
        }

        const frame = animation.frames[frameIndex];
        const width = frame.width || MoscaTirador.DRAW_SIZE;
        const height = frame.height || MoscaTirador.DRAW_SIZE;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(frame, snap(this.x - width / 2), snap(this.y - height / 2), width, height);
        this.drawHealth(ctx, Math.max(width, height));
    }

    /** Keep one living player as the target unless another is clearly nearer. */
    selectPlayer(player, allTargets, map, room) {
        const living = Array.isArray(allTargets) ? allTargets.filter(candidate =>
            candidate && !candidate.ownerId && candidate.health > 0 && candidate.alive !== false) : [];
        const inRoom = room && map?.pointInRoom
            ? living.filter(candidate => map.pointInRoom(candidate.x, candidate.y) === room) : [];
        const candidates = inRoom.length ? inRoom : living;
        if (!candidates.length && player && player.health > 0 && player.alive !== false) candidates.push(player);
        if (!candidates.length) return null;
        let nearest = candidates[0];
        for (const candidate of candidates) {
            if (Math.hypot(candidate.x - this.x, candidate.y - this.y) <
                Math.hypot(nearest.x - this.x, nearest.y - this.y)) nearest = candidate;
        }
        if (this.trackedPlayer && candidates.includes(this.trackedPlayer) &&
            Math.hypot(this.trackedPlayer.x - this.x, this.trackedPlayer.y - this.y) <=
            Math.hypot(nearest.x - this.x, nearest.y - this.y) + 70) return this.trackedPlayer;
        return nearest;
    }

    /** Use the actual 4 px projectile radius against the room's solid mask. */
    hasShotLane(target, map, x = this.x, y = this.y) {
        return !map?.hasLineOfSight || map.hasLineOfSight(
            x, y, target.x, target.y, EnemyProjectilePool.HITBOX_RADIUS);
    }

    reachable(point, map) {
        if (!point || !map?.canOccupy?.(point.x, point.y, this.radius)) return false;
        return !map.findPath || !!map.findPath(this.x, this.y, point.x, point.y, this.radius, 1600);
    }

    setTacticalGoal(point, kind, target) {
        this.tacticalGoal = { x: point.x, y: point.y, kind,
            targetX: target.x, targetY: target.y };
        this.tacticalGoalFrames = 0;
        this.tacticalStuckFrames = 0;
        this._navPath = null;
        this._navTimer = 0;
    }

    clearTacticalGoal() {
        this.tacticalGoal = null;
        this.tacticalGoalFrames = 0;
        this.tacticalStuckFrames = 0;
        this._navPath = null;
        this._navTimer = 0;
    }

    /** A nearby shooting lane is chosen only if it is safe and reachable. */
    findFiringPoint(target, map, room) {
        if (!room || !map?.canOccupy || !map?.hasLineOfSight) return null;
        const suggested = SmartCover.findAttackPoint(
            this, target, map, room, this.coverPoint || { x: this.x, y: this.y });
        const safe = point => point && Math.hypot(point.x - target.x, point.y - target.y) >= 170 &&
            this.hasShotLane(target, map, point.x, point.y) && this.reachable(point, map);
        if (safe(suggested)) return suggested;

        // The shared cover helper may prefer an exposed point. Search only the
        // local tiles for a safe flank instead of routing across the whole map.
        const tile = map.tileSize || 40;
        const cellX = Math.floor((this.x - room.x) / tile);
        const cellY = Math.floor((this.y - room.y) / tile);
        const options = [];
        for (let oy = -7; oy <= 7; oy++) for (let ox = -7; ox <= 7; ox++) {
            if (!ox && !oy) continue;
            const x = room.x + (cellX + ox + 0.5) * tile;
            const y = room.y + (cellY + oy + 0.5) * tile;
            const travel = Math.hypot(x - this.x, y - this.y);
            const range = Math.hypot(x - target.x, y - target.y);
            if (travel > 320 || range < 170 || range > 650 ||
                map.pointInRoom?.(x, y) !== room || !map.canOccupy(x, y, this.radius)) continue;
            options.push({ x, y, score: travel + Math.abs(range - 220) * 0.35 });
        }
        options.sort((a, b) => a.score - b.score);
        for (const point of options.slice(0, 80)) {
            if (this.hasShotLane(target, map, point.x, point.y) && this.reachable(point, map)) return point;
        }
        return null;
    }

    moveToTacticalGoal(map) {
        const goal = this.tacticalGoal;
        if (!goal) return;
        if (Math.hypot(goal.x - this.x, goal.y - this.y) <= 10) {
            this.clearTacticalGoal();
            return;
        }
        const oldX = this.x, oldY = this.y;
        this.steerTo(goal.x, goal.y, map);
        this.tacticalGoalFrames++;
        this.tacticalStuckFrames = Math.hypot(this.x - oldX, this.y - oldY) < 0.05
            ? this.tacticalStuckFrames + 1 : 0;
        if (this.tacticalStuckFrames >= 12 || this.tacticalGoalFrames >= 210) {
            if (goal.kind === 'cover') this.coverPoint = null;
            this.clearTacticalGoal();
            this.tacticalReplanTimer = 30;
        }
    }

    update(player, enemies, map, allTargets = null, projectilePool = null) {
        const room = map?.pointInRoom?.(this.x, this.y) || null;
        const target = this.selectPlayer(player, allTargets, map, room);
        if (!target) return [];
        if (target !== this.trackedPlayer) {
            this.trackedPlayer = target;
            this.coverPoint = null;
            this.coverSearchTimer = 0;
            this.tacticalReplanTimer = 0;
            this.clearTacticalGoal();
        }
        this.shootTimer = Math.max(0, this.shootTimer - 1);
        this.coverSearchTimer = Math.max(0, this.coverSearchTimer - 1);
        this.tacticalReplanTimer = Math.max(0, this.tacticalReplanTimer - 1);

        const distance = Math.hypot(target.x - this.x, target.y - this.y);
        const clear = this.hasShotLane(target, map);
        if (this.coverPoint && map?.hasLineOfSight?.(
            target.x, target.y, this.coverPoint.x, this.coverPoint.y, this.radius)) {
            this.coverPoint = null;
            if (this.tacticalGoal?.kind === 'cover') this.clearTacticalGoal();
        }
        if (this.tacticalGoal && this.tacticalReplanTimer === 0 &&
            Math.hypot(target.x - this.tacticalGoal.targetX,
                       target.y - this.tacticalGoal.targetY) >= 120) this.clearTacticalGoal();
        if (this.tacticalGoal?.kind === 'fire' && clear && distance >= 180 && distance <= 250) {
            this.clearTacticalGoal();
        }
        if (this.tacticalGoal?.kind === 'fire' &&
            Math.hypot(target.x - this.tacticalGoal.x, target.y - this.tacticalGoal.y) < 170) {
            this.clearTacticalGoal();
        }

        const atCover = this.coverPoint &&
            Math.hypot(this.x - this.coverPoint.x, this.y - this.coverPoint.y) <= 12;
        if (!this.tacticalGoal && !clear && atCover && this.shootTimer <= 24 &&
            this.tacticalReplanTimer === 0) {
            const firing = this.findFiringPoint(target, map, room);
            if (firing) this.setTacticalGoal(firing, 'fire', target);
            else {
                // No viable peek: leave this shelter and seek another angle.
                this.coverPoint = null;
                this.coverSearchTimer = 90;
            }
            this.tacticalReplanTimer = 45;
        }
        if (!this.tacticalGoal && distance < 180 && !atCover && this.coverSearchTimer === 0 && room) {
            // Use the shared blue-obstacle cover search.
            const cover = SmartCover.findCoverPoint(this, target, map, room);
            this.coverPoint = this.reachable(cover, map) ? cover : null;
            this.coverSearchTimer = 90;
            if (this.coverPoint) this.setTacticalGoal(this.coverPoint, 'cover', target);
        }
        if (!this.tacticalGoal && !clear && !atCover && distance >= 180 &&
            this.tacticalReplanTimer === 0) {
            const firing = this.findFiringPoint(target, map, room);
            if (firing) this.setTacticalGoal(firing, 'fire', target);
            this.tacticalReplanTimer = 45;
        }

        if (this.tacticalGoal) this.moveToTacticalGoal(map);
        else if (atCover && !clear) { /* Wait for the next peek; never camp forever. */ }
        else if (distance < 180) this.retreatFrom(target.x, target.y, map);
        else if (!clear || distance > 250) this.steerTo(target.x, target.y, map);
        else {
            this._navPath = null;
            this._navTimer = 0;
        }

        // A blocked shot stays ready; the normal 60-frame cadence resumes only
        // after a real projectile leaves a clear lane.
        if (this.shootTimer > 0 || !this.hasShotLane(target, map)) return [];
        const angle = Math.atan2(target.y - this.y, target.x - this.x);
        this.shootTimer = this.shootCooldown;
        if (this.coverPoint && distance < 300 && !this.tacticalGoal && !atCover &&
            this.reachable(this.coverPoint, map)) {
            this.setTacticalGoal(this.coverPoint, 'cover', target);
        }
        return [this.shootTowardPlayer(angle, 2.5, projectilePool)];
    }
}
