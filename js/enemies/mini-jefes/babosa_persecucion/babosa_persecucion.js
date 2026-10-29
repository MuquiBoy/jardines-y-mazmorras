/**
 * Babosa Persecución — 80px visual miniboss with a 32px collision radius.
 * It pursues living players and deals one contact hit on each new overlap.
 * Movement and health use the shared Enemy and map collision systems.
 */
const BABOSA_PERSECUCION_SIZE = 80;
const BABOSA_PERSECUCION_SPEED_RATIO = 0.70;
const BABOSA_PERSECUCION_CONTACT_DAMAGE = 12;
const BABOSA_PERSECUCION_KNOCKBACK = 80;
const BABOSA_PERSECUCION_WALK_PATH = '00-sprites/enemigos/1_mini-jefes/babosa_persecucion/babosa_persecucion_walk.aseprite';
const BABOSA_PERSECUCION_WALK_VERSION = 'babosa-walk-20261029-v1';

class BabosaPersecucion extends Enemy {
    static COLLISION_RADIUS = 32;
    static animation = null;
    static animationPromise = null;

    constructor(x, y, room = null) {
        super(x, y, 'babosa_persecucion');
        this.name = 'Babosa Persecución';
        this.health = this.maxHealth = 500;
        this.setMovementSpeedMultiplier(BABOSA_PERSECUCION_SPEED_RATIO);
        this.damage = BABOSA_PERSECUCION_CONTACT_DAMAGE;
        this.radius = BabosaPersecucion.COLLISION_RADIUS;
        this.color = '#a864bd';
        this.xpValue = 0;
        this.room = room;
        this.targetId = null;
        this._contactingPlayerIds = new Set();
        this.animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.loadAnimation();
    }

    loadAnimation() {
        if (BabosaPersecucion.animation || BabosaPersecucion.animationPromise ||
            typeof decodeAsepriteAnimation !== 'function') return;
        const url = BABOSA_PERSECUCION_WALK_PATH + '?v=' + BABOSA_PERSECUCION_WALK_VERSION;
        BabosaPersecucion.animationPromise = decodeAsepriteAnimation(url)
            .then(animation => {
                if (animation) BabosaPersecucion.animation = animation;
                return animation;
            })
            .catch(error => {
                BabosaPersecucion.animationPromise = null;
                console.warn('No se pudo cargar la animación walk de la Babosa Persecución.', error);
                return null;
            });
    }

    moveBy(dx, dy, map) {
        if (!map) return super.moveBy(dx, dy, map);
        const room = this.room;
        const canStep = (x, y) => map.canOccupy(x, y, this.radius) && (!room ||
            (x - this.radius >= room.x && x + this.radius <= room.x + room.w &&
             y - this.radius >= room.y && y + this.radius <= room.y + room.h));
        const startX = this.x, startY = this.y;
        if (canStep(this.x + dx, this.y)) this.x += dx;
        if (canStep(this.x, this.y + dy)) this.y += dy;
        return this.x !== startX || this.y !== startY;
    }

    _livingPlayers(target, allTargets, map) {
        const candidates = Array.isArray(allTargets) ? allTargets : (target ? [target] : []);
        const room = this.room || (map && map.pointInRoom(this.x, this.y));
        if (!this.room && room) this.room = room;
        return candidates.filter(player => player && Number.isFinite(player.invincibleTimer) &&
            player.health > 0 && player.alive !== false &&
            (!room || !map || map.pointInRoom(player.x, player.y) === room));
    }

    update(target, enemies, map, allTargets = null) {
        if (!this.alive) return null;
        const players = this._livingPlayers(target, allTargets, map);
        if (!players.length) {
            this._contactingPlayerIds.clear();
            return null;
        }

        // Refresh the existing route target continuously; Enemy.steerTo uses
        // map A* and collision-aware stepping to route around columns/walls.
        let nearest = players[0];
        let nearestDistance = Infinity;
        for (const player of players) {
            const distance = Math.hypot(player.x - this.x, player.y - this.y);
            if (distance < nearestDistance) {
                nearest = player;
                nearestDistance = distance;
            }
        }
        this.targetId = nearest.id ?? null;
        this.angle = Math.atan2(nearest.y - this.y, nearest.x - this.x);
        const moved = this.steerTo(nearest.x, nearest.y, map, this.speed);
        if (!moved && map) this._dodge(map, this.speed);
        return null;
    }

    /** Resolve contact once when overlap begins; sustained overlap cannot tick damage. */
    resolvePlayerContacts(players, map) {
        if (!this.alive) {
            this._contactingPlayerIds.clear();
            return [];
        }
        const currentContacts = new Set();
        const impacts = [];
        for (const player of players || []) {
            if (!player || player.health <= 0 || player.alive === false) continue;
            if (this.room && map && map.pointInRoom(player.x, player.y) !== this.room) continue;
            const playerId = player.id ?? player;
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const distance = Math.hypot(dx, dy);
            if (distance > this.radius + (player.radius || 12)) continue;
            currentContacts.add(playerId);
            if (this._contactingPlayerIds.has(playerId)) continue;

            const nx = distance > 0.001 ? dx / distance : Math.cos(this.angle || 0);
            const ny = distance > 0.001 ? dy / distance : Math.sin(this.angle || 0);
            const damage = BABOSA_PERSECUCION_CONTACT_DAMAGE;
            if (typeof player.takeDamage === 'function') player.takeDamage(damage);
            else if (player.invincibleTimer <= 0) {
                player.health = Math.max(0, player.health - damage);
                player.invincibleTimer = PLAYER_DAMAGE_INVULNERABILITY_FRAMES;
            }

            // Queue momentum on the player so their movement input cannot
            // cancel the hit. The player resolves map collision and redirects
            // around a blocking wall during subsequent simulation frames.
            if (player.health > 0 && typeof player.applyKnockbackImpulse === 'function') {
                player.applyKnockbackImpulse(nx, ny, this.x, this.y, BABOSA_PERSECUCION_KNOCKBACK);
            } else if (player.health > 0) {
                // Compatibility path for non-Player objects: preserve collision
                // safety and take short steps toward the 80px separation gain.
                const step = 2;
                const initialDistance = Math.hypot(player.x - this.x, player.y - this.y);
                const targetDistance = initialDistance + BABOSA_PERSECUCION_KNOCKBACK;
                for (let i = 0; i < BABOSA_PERSECUCION_KNOCKBACK / step; i++) {
                    const nextX = player.x + nx * step;
                    const nextY = player.y + ny * step;
                    if (map && !map.canOccupy(nextX, nextY, player.radius || 12)) break;
                    player.x = nextX;
                    player.y = nextY;
                    if (Math.hypot(player.x - this.x, player.y - this.y) >= targetDistance) break;
                }
            }
            impacts.push({ player, damage });
        }
        this._contactingPlayerIds = currentContacts;
        return impacts;
    }

    draw(ctx) {
        const s = BABOSA_PERSECUCION_SIZE;
        const animation = BabosaPersecucion.animation;
        if (animation && animation.frames.length && animation.totalDuration > 0) {
            // The authored walk cycle loops continuously while moving or idle.
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            let frameTime = (now - this.animationStartTime) % animation.totalDuration;
            let frameIndex = 0;
            while (frameIndex < animation.durations.length - 1 &&
                   frameTime >= animation.durations[frameIndex]) {
                frameTime -= animation.durations[frameIndex++];
            }
            const frame = animation.frames[frameIndex];
            const width = frame.width || s;
            const height = frame.height || s;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(frame, snap(this.x - width / 2), snap(this.y - height / 2), width, height);
            ctx.restore();
            this.drawHealth(ctx, Math.max(width, height));
            return;
        }

        // Keep the existing fallback visible until the animation has loaded.
        pixelRect(ctx, this.x, this.y, s + 6, s + 6, PALETTE.void);
        pixelRect(ctx, this.x, this.y, s, s, '#54375f');
        pixelRect(ctx, this.x, this.y - 3, 68, 62, '#8d4eaa');
        pixelRect(ctx, this.x - 16, this.y + 14, 14, 28, '#b66bca');
        pixelRect(ctx, this.x + 16, this.y + 14, 14, 28, '#b66bca');
        pixelRect(ctx, this.x - 13, this.y - 8, 7, 7, '#f7e8ff');
        pixelRect(ctx, this.x + 13, this.y - 8, 7, 7, '#f7e8ff');
        pixelRect(ctx, this.x - 13, this.y - 8, 3, 4, '#24142a');
        pixelRect(ctx, this.x + 13, this.y - 8, 3, 4, '#24142a');
        this.drawHealth(ctx, s);
    }
}

