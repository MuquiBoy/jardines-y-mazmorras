/* Esbirro: clase independiente, cargada después de js/enemy.js. */
const ESBIRRO_MIEDOSO_WALK_PATH = '00-sprites/enemigos/2_esbirros/esbirro_miedoso/esbirro_miedoso_walk.aseprite';
const ESBIRRO_MIEDOSO_WALK_VERSION = 'esbirro-miedoso-walk-20261030-v3';
const ESBIRRO_MIEDOSO_PLAYBACK_SPEED = 0.5;

// ===== EsbirroMiedoso — perseguidor que busca cobertura a media vida =====
class EsbirroMiedoso extends Enemy {
    static animation = null;
    static animationPromise = null;
    static DRAW_SIZE = 36;

    constructor(x, y) {
        super(x, y, 'esbirro_miedoso');
        this.health = 35;
        this.maxHealth = 35;
        this.setMovementSpeedMultiplier(0.50);
        this.damage = 6;
        this.radius = 16;
        this.color = '#ff4444';
        this.xpValue = 10;
        this.shootCooldown = 120;
        // Keep the ficha's staggered opening window (108–216 frames), then
        // fire at the regular two-second cadence.
        this.shootTimer = 108 + Math.floor(Math.random() * 109);
        this.defensiveMode = false;
        this.coverPoint = null;
        this.coverRoom = null;
        this.coverSearchTimer = 0;
        this.coverValidationTimer = 0;
        this.coverTargetAtSearch = null;
        this.coverTargetId = null;
        this.combatRoom = null;
        this.peekPoint = null;
        this.peekSearchTimer = 0;
        this.animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        EsbirroMiedoso.loadAnimation();
    }

    static loadAnimation() {
        if (EsbirroMiedoso.animation) return EsbirroMiedoso.animation;
        if (EsbirroMiedoso.animationPromise) return EsbirroMiedoso.animationPromise;
        if (typeof decodeAsepriteAnimation !== 'function') return null;
        const url = ESBIRRO_MIEDOSO_WALK_PATH + '?v=' + ESBIRRO_MIEDOSO_WALK_VERSION;
        EsbirroMiedoso.animationPromise = decodeAsepriteAnimation(url)
            .then(animation => {
                if (animation) EsbirroMiedoso.animation = animation;
                return animation;
            })
            .catch(error => {
                EsbirroMiedoso.animationPromise = null;
                console.warn('No se pudo cargar la animación walk del Esbirro Miedoso.', error);
                return null;
            });
        return EsbirroMiedoso.animationPromise;
    }

    draw(ctx) {
        const animation = EsbirroMiedoso.animation;
        if (!animation || !animation.frames.length || animation.totalDuration <= 0) return;

        // The authored walk cycle is used continuously for idle, pursuit,
        // firing, and cover movement.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameTime = ((now - this.animationStartTime) * ESBIRRO_MIEDOSO_PLAYBACK_SPEED) % animation.totalDuration;
        let frameIndex = 0;
        while (frameIndex < animation.durations.length - 1 &&
               frameTime >= animation.durations[frameIndex]) {
            frameTime -= animation.durations[frameIndex++];
        }

        const frame = animation.frames[frameIndex];
        const width = frame.width || EsbirroMiedoso.DRAW_SIZE;
        const height = frame.height || EsbirroMiedoso.DRAW_SIZE;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        // Draw at the decoded 36 x 36 px canvas size without scaling arguments.
        ctx.drawImage(frame, snap(this.x - width / 2), snap(this.y - height / 2));
        ctx.restore();
        this.drawHealth(ctx, Math.max(width, height));
    }

    /**
     * Pick a reachable floor point just behind a blue obstacle. The body sits
     * one radius plus a 10 px gap beyond that obstacle's rear face, and every
     * candidate is checked against the authored room collision mask.
     */
    findCoverPoint(threat, map, room = null) {
        if (!threat || !map?.pointInRoom || !map?.canOccupy || !map?.hasLineOfSight) return null;
        room = room || map.pointInRoom(this.x, this.y);
        const template = room?.template;
        if (!room || !template?.mask || !room.tw || !room.th) return null;

        const tileSize = map.tileSize || 40;
        const crossesBlueObstacle = (x1, y1, x2, y2) => {
            const distance = Math.hypot(x2 - x1, y2 - y1);
            const steps = Math.max(1, Math.ceil(distance / (tileSize * 0.2)));
            for (let step = 1; step < steps; step++) {
                const t = step / steps;
                const cellX = Math.floor((x1 + (x2 - x1) * t - room.x) / tileSize);
                const cellY = Math.floor((y1 + (y2 - y1) * t - room.y) / tileSize);
                if (cellX < 0 || cellY < 0 || cellX >= room.tw || cellY >= room.th) continue;
                if (template.mask[cellY * room.tw + cellX] === 3) return true;
            }
            return false;
        };
        // Do not walk away from a useful shelter: if a blue obstacle already
        // blocks the player's line to this position, it is the best cover.
        if (!map.hasLineOfSight(threat.x, threat.y, this.x, this.y, this.radius) &&
            crossesBlueObstacle(threat.x, threat.y, this.x, this.y)) {
            return { x: this.x, y: this.y, room, score: 0 };
        }
        const offset = tileSize / 2 + this.radius + 10;
        const maxCoverTravel = tileSize * 4;
        const directions = [
            { x: 1, y: 0 }, { x: -1, y: 0 },
            { x: 0, y: 1 }, { x: 0, y: -1 }
        ];
        const candidates = [];
        const seen = new Set();

        for (let cellY = 0; cellY < room.th; cellY++) {
            for (let cellX = 0; cellX < room.tw; cellX++) {
                if (template.mask[cellY * room.tw + cellX] !== 3) continue;

                const obstacleX = room.x + (cellX + 0.5) * tileSize;
                const obstacleY = room.y + (cellY + 0.5) * tileSize;
                const awayX = obstacleX - threat.x;
                const awayY = obstacleY - threat.y;
                const awayLength = Math.hypot(awayX, awayY) || 1;

                for (const direction of directions) {
                    const alignment = (direction.x * awayX + direction.y * awayY) / awayLength;
                    // The obstacle must lie between the threat and the cover
                    // point, rather than merely being somewhere nearby.
                    if (alignment < 0.45) continue;

                    const point = {
                        x: obstacleX + direction.x * offset,
                        y: obstacleY + direction.y * offset
                    };
                    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (map.pointInRoom(point.x, point.y) !== room ||
                        !map.canOccupy(point.x, point.y, this.radius)) continue;

                    const distance = Math.hypot(point.x - this.x, point.y - this.y);
                    if (distance > maxCoverTravel ||
                        map.hasLineOfSight(threat.x, threat.y, point.x, point.y, this.radius) ||
                        !crossesBlueObstacle(threat.x, threat.y, point.x, point.y)) continue;
                    candidates.push({
                        ...point,
                        room,
                        score: distance + (1 - alignment) * tileSize * 0.5
                    });
                }
            }
        }

        candidates.sort((a, b) => a.score - b.score);
        // Bound line-of-sight work in rooms with many authored obstacles.
        for (const candidate of candidates.slice(0, 12)) {
            return candidate;
        }
        return null;
    }

    /**
     * Choose a short, reachable firing lane close to shelter. The enemy only
     * exposes itself long enough to take its scheduled shot, then returns to
     * cover; if no lane exists it keeps its position and cadence.
     */
    findAttackPoint(threat, map, room, coverPoint) {
        const cells = room?.template?.walkableCells;
        if (!threat || !map?.canOccupy || !map?.hasLineOfSight || !cells?.length || !coverPoint) return null;
        const tileSize = map.tileSize || 40;
        const maxPeekDistance = Math.hypot(room.w, room.h);
        const candidates = [];
        for (const cell of cells) {
            const point = {
                x: room.x + (cell.x + 0.5) * tileSize,
                y: room.y + (cell.y + 0.5) * tileSize
            };
            const coverDistance = Math.hypot(point.x - coverPoint.x, point.y - coverPoint.y);
            if (coverDistance < tileSize * 0.75 || coverDistance > maxPeekDistance) continue;
            if (map.pointInRoom(point.x, point.y) !== room || !map.canOccupy(point.x, point.y, this.radius)) continue;
            candidates.push({
                ...point,
                score: coverDistance + Math.abs(Math.hypot(point.x - threat.x, point.y - threat.y) - 240) * 0.08
            });
        }
        candidates.sort((a, b) => a.score - b.score);
        for (const candidate of candidates.slice(0, 256)) {
            if (map.hasLineOfSight(threat.x, threat.y, candidate.x, candidate.y, this.radius)) return candidate;
        }
        return null;
    }

    update(player, enemies, map, allTargets = null, projectilePool = null) {
        // Defend against the nearest living player. Summons can still attract
        // the ordinary attack target passed as `player`, but do not define
        // which side of cover protects the enemy from player bullets.
        const threats = Array.isArray(allTargets)
            ? allTargets.filter(target => target && !target.ownerId && target.health > 0 && target.alive !== false)
            : [];
        let threat = threats[0] || player;
        for (const candidate of threats) {
            if (Math.hypot(candidate.x - this.x, candidate.y - this.y) <
                Math.hypot(threat.x - this.x, threat.y - this.y)) threat = candidate;
        }

        if (!this.defensiveMode && this.health <= Math.floor(this.maxHealth * 0.5)) {
            this.defensiveMode = true;
            this.coverPoint = null;
            this.coverSearchTimer = 0;
            this.peekPoint = null;
            this._navPath = null;
            this._navGoal = null;
            this._navTimer = 0;
        }

        this.shootTimer = Math.max(0, this.shootTimer - 1);

        if (this.defensiveMode && threat && map) {
            if (!this.combatRoom) this.combatRoom = map.pointInRoom?.(this.x, this.y) || null;
            const room = this.combatRoom || map.pointInRoom?.(this.x, this.y) || null;
            const targetMoved = !this.coverTargetAtSearch ||
                this.coverTargetId !== threat.id ||
                Math.hypot(threat.x - this.coverTargetAtSearch.x,
                           threat.y - this.coverTargetAtSearch.y) >= 120;
            this.coverSearchTimer = Math.max(0, this.coverSearchTimer - 1);
            this.coverValidationTimer = Math.max(0, this.coverValidationTimer - 1);
            this.peekSearchTimer = Math.max(0, this.peekSearchTimer - 1);

            const coverStillBlocksThreat = this.coverPoint && this.coverRoom === room &&
                !map.hasLineOfSight(threat.x, threat.y, this.coverPoint.x, this.coverPoint.y, this.radius);
            let needsSearch = !this.coverPoint || this.coverRoom !== room;
            // Keep useful shelter when the player moves; only abandon it once
            // the player can see the cover point or it no longer fits this room.
            if (this.coverSearchTimer === 0 && targetMoved && !coverStillBlocksThreat) needsSearch = true;
            if (this.coverPoint && room === this.coverRoom && this.coverValidationTimer === 0 &&
                map.hasLineOfSight?.(threat.x, threat.y, this.coverPoint.x, this.coverPoint.y, this.radius)) {
                needsSearch = true;
            }
            if (this.peekPoint && !map.hasLineOfSight(threat.x, threat.y,
                this.peekPoint.x, this.peekPoint.y, this.radius)) {
                this.peekPoint = null;
                this.peekSearchTimer = 0;
                this._navPath = null;
                this._navGoal = null;
                this._navTimer = 0;
            }

            if (needsSearch) {
                this.coverPoint = this.findCoverPoint(threat, map, room);
                this.coverRoom = this.coverPoint?.room || null;
                this.peekPoint = null;
                this.coverTargetAtSearch = { x: threat.x, y: threat.y };
                this.coverTargetId = threat.id || null;
                this.coverSearchTimer = this.coverPoint ? 60 : 30;
                this.coverValidationTimer = 15;
            }

            if (this.coverPoint && this.coverRoom === room) {
                const atCover = Math.hypot(this.coverPoint.x - this.x, this.coverPoint.y - this.y) <= 12;
                if (this.peekPoint) {
                    const atPeek = Math.hypot(this.peekPoint.x - this.x, this.peekPoint.y - this.y) <= 12;
                    if (!atPeek) {
                        this.steerTo(this.peekPoint.x, this.peekPoint.y, map);
                    } else if (this.shootTimer <= 0 &&
                               map.hasLineOfSight(threat.x, threat.y, this.x, this.y, this.radius)) {
                        const angle = Math.atan2(threat.y - this.y, threat.x - this.x);
                        this.shootTimer = this.shootCooldown;
                        this.peekPoint = null;
                        this.peekSearchTimer = 30;
                        this.steerTo(this.coverPoint.x, this.coverPoint.y, map);
                        return [this.shootTowardPlayer(angle, 2.0, projectilePool)];
                    }
                } else if (!atCover) {
                    // Existing A* navigation routes to cover without crossing
                    // walls or blue obstacles.
                    this.steerTo(this.coverPoint.x, this.coverPoint.y, map);
                } else {
                    this._navPath = null;
                    this._navGoal = null;
                    this._navTimer = 0;
                    if (this.shootTimer <= 72 && this.peekSearchTimer === 0) {
                        this.peekPoint = this.findAttackPoint(threat, map, room, this.coverPoint);
                        this.peekSearchTimer = this.peekPoint ? this.shootCooldown : 30;
                        if (this.peekPoint) {
                            this.steerTo(this.peekPoint.x, this.peekPoint.y, map);
                        }
                    }
                }
            } else {
                this.coverPoint = null;
                this.coverRoom = null;
                this.peekPoint = null;
                // If this room has no reachable blue cover, evade instead of
                // walking into the player while exposed.
                this.retreatFrom(threat.x, threat.y, map);
            }
        } else {
            // Above half health, keep the original direct pursuit and shared
            // A* routing around walls.
            this.steerTo(player.x, player.y, map);
        }

        // Fire from an open lane. If no lane can be found, retain the normal
        // cadence from cover; the projectile still obeys wall collisions.
        const attackTarget = this.defensiveMode && threat ? threat : player;
        const hasShotLane = !map || !attackTarget || map.hasLineOfSight(
            attackTarget.x, attackTarget.y, this.x, this.y, this.radius
        );
        if (this.shootTimer <= 0 && hasShotLane && !this.peekPoint) {
            this.shootTimer = this.shootCooldown;
            const dx = attackTarget.x - this.x;
            const dy = attackTarget.y - this.y;
            return [this.shootTowardPlayer(Math.atan2(dy, dx), 2.0, projectilePool)];
        }
        return [];
    }
}
