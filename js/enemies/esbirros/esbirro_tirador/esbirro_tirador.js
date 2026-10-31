/* Common shooter: shared Mosca navigation and SmartCover geometry, distinct attack cycle. */
class EsbirroTirador extends MoscaTirador {
    static ATTACK_RANGE = 160;
    static BURST_SIZE = 5;
    static BURST_INTERVAL_FRAMES = 36;
    static RELOAD_FRAMES = 198;
    static SPREAD_RADIANS = Math.PI / 15; // Random +/-12 degrees per projectile.

    constructor(x, y) {
        super(x, y);
        this.type = 'esbirro_tirador';
        this.name = 'Esbirro Tirador';
        this.setMovementSpeedMultiplier(0.50);
        this.shootCooldown = EsbirroTirador.BURST_INTERVAL_FRAMES;
        this.attackState = 'SEEK_ATTACK_POSITION';
        this.burstShotsFired = 0;
        this.burstTimer = 0;
        this.reloadTimer = 0;
    }

    canAttack(target, map) {
        return Math.hypot(target.x - this.x, target.y - this.y) <= EsbirroTirador.ATTACK_RANGE &&
            this.hasShotLane(target, map);
    }

    beginReload() {
        this.attackState = 'RELOAD_COVER';
        this.reloadTimer = EsbirroTirador.RELOAD_FRAMES;
        this.burstTimer = 0;
        this.coverPoint = null;
        this.coverSearchTimer = 0;
        this.clearTacticalGoal();
    }

    fireBurstShot(target, projectilePool) {
        const angle = Math.atan2(target.y - this.y, target.x - this.x) +
            (Math.random() * 2 - 1) * EsbirroTirador.SPREAD_RADIANS;
        const bullet = this.shootTowardPlayer(angle, 2.5, projectilePool);
        this.burstShotsFired++;
        if (this.burstShotsFired === EsbirroTirador.BURST_SIZE) this.beginReload();
        else this.burstTimer = EsbirroTirador.BURST_INTERVAL_FRAMES;
        return bullet ? [bullet] : [];
    }

    seekAttackPosition(target, map, room, projectilePool) {
        const distance = Math.hypot(target.x - this.x, target.y - this.y);
        if (this.canAttack(target, map)) {
            this.clearTacticalGoal();
            if (this.shootTimer > 0) return [];
            this.attackState = 'BURST_ATTACK';
            this.burstShotsFired = 0;
            return this.fireBurstShot(target, projectilePool);
        }

        if (this.tacticalGoal?.kind === 'fire' &&
            (this.tacticalGoal.targetX - target.x) ** 2 +
            (this.tacticalGoal.targetY - target.y) ** 2 > 80 ** 2) this.clearTacticalGoal();
        if (!this.tacticalGoal && this.tacticalReplanTimer === 0 && room) {
            const point = SmartCover.findAttackPoint(this, target, map, room,
                this.coverPoint || { x: this.x, y: this.y }, {
                    preferredRange: 120,
                    maxRange: EsbirroTirador.ATTACK_RANGE,
                    maxTravel: 320,
                    isReachable: candidate => this.reachable(candidate, map)
                });
            if (point && this.hasShotLane(target, map, point.x, point.y)) {
                this.setTacticalGoal(point, 'fire', target);
            }
            this.tacticalReplanTimer = 45;
        }
        if (this.tacticalGoal) this.moveToTacticalGoal(map);
        else if (distance > EsbirroTirador.ATTACK_RANGE || !this.hasShotLane(target, map)) {
            this.steerTo(target.x, target.y, map);
        }
        return [];
    }

    moveDuringReload(target, map, room) {
        if (this.coverPoint && map?.hasLineOfSight?.(
            target.x, target.y, this.coverPoint.x, this.coverPoint.y, this.radius)) {
            this.coverPoint = null;
            this.coverSearchTimer = 0;
            this.clearTacticalGoal();
        }
        if (!this.coverPoint && this.coverSearchTimer === 0 && room) {
            const point = SmartCover.findCoverPoint(this, target, map, room);
            this.coverPoint = this.reachable(point, map) ? point : null;
            this.coverSearchTimer = 60;
            if (this.coverPoint) this.setTacticalGoal(this.coverPoint, 'cover', target);
        }
        if (this.tacticalGoal) this.moveToTacticalGoal(map);
        else if (!this.coverPoint) this.retreatFrom(target.x, target.y, map);
    }

    update(player, enemies, map, allTargets = null, projectilePool = null) {
        const room = map?.pointInRoom?.(this.x, this.y) || null;
        const target = this.selectPlayer(player, allTargets, map, room);
        if (!target) return [];
        if (target !== this.trackedPlayer) {
            if (this.attackState === 'BURST_ATTACK') this.beginReload();
            this.trackedPlayer = target;
            this.coverPoint = null;
            this.coverSearchTimer = 0;
            this.tacticalReplanTimer = 0;
            this.clearTacticalGoal();
        }
        this.coverSearchTimer = Math.max(0, this.coverSearchTimer - 1);
        this.tacticalReplanTimer = Math.max(0, this.tacticalReplanTimer - 1);

        if (this.attackState === 'RELOAD_COVER') {
            this.reloadTimer = Math.max(0, this.reloadTimer - 1);
            if (this.reloadTimer > 0) {
                this.moveDuringReload(target, map, room);
                return [];
            }
            this.attackState = 'SEEK_ATTACK_POSITION';
            this.coverPoint = null;
            this.clearTacticalGoal();
        }
        if (this.attackState === 'BURST_ATTACK') {
            if (!this.canAttack(target, map)) {
                this.beginReload();
                this.moveDuringReload(target, map, room);
                return [];
            }
            if (this.burstTimer > 0 && --this.burstTimer > 0) return [];
            return this.fireBurstShot(target, projectilePool);
        }
        this.shootTimer = Math.max(0, this.shootTimer - 1);
        return this.seekAttackPosition(target, map, room, projectilePool);
    }
}
