/**
 * Reusable storage for physical enemy projectiles.
 * Player shots, beams, warning graphics, particles and other effects do not
 * belong to this pool. One instance is created per authoritative simulation.
 */
class EnemyProjectilePool {
    static INITIAL_CAPACITY = 512;
    static GROWTH_SIZE = 128;
    static HITBOX_RADIUS = 4;
    static SPRITE_DEFS = {
        'enemy-standard': {
            file: '10x10_proyectil enemigo.aseprite',
            size: 10
        }
    };
    static spriteAnimations = Object.create(null);
    static spriteAnimationPromises = Object.create(null);
    static frameCacheTimestamp = -1;
    static frameCache = Object.create(null);

    /** Register an exceptional projectile visual from its owning enemy code. */
    static registerSprite(visualType, file, size) {
        if (!visualType || !file || !Number.isFinite(size) || size <= 0) {
            throw new TypeError('Projectile sprite requires a key, file and positive size.');
        }
        this.SPRITE_DEFS[visualType] = { file, size };
        return this.loadSpriteAnimation(visualType);
    }

    /** Load a sprite loop asynchronously; gameplay keeps a visible fallback. */
    static loadSpriteAnimation(visualType = 'enemy-standard') {
        const definition = this.SPRITE_DEFS[visualType];
        if (!definition || this.spriteAnimations[visualType]) {
            return Promise.resolve(this.spriteAnimations[visualType] || null);
        }
        if (this.spriteAnimationPromises[visualType]) return this.spriteAnimationPromises[visualType];
        if (typeof document === 'undefined' || typeof decodeAsepriteAnimation !== 'function') {
            return Promise.resolve(null);
        }

        const url = '00-sprites/proyectiles/' + encodeURIComponent(definition.file) + '?v=enemy-projectile-10px-v1';
        this.spriteAnimationPromises[visualType] = decodeAsepriteAnimation(url)
            .then(animation => {
                if (animation) this.spriteAnimations[visualType] = animation;
                return animation;
            })
            .catch(error => {
                delete this.spriteAnimationPromises[visualType];
                console.warn('No se pudo cargar el sprite de proyectil ' + visualType + '.', error);
                return null;
            });
        return this.spriteAnimationPromises[visualType];
    }

    /** Return the authored animation frame at a shared render timestamp. */
    static frameFor(visualType = 'enemy-standard', now =
        (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
        const key = this.spriteAnimations[visualType] ? visualType : 'enemy-standard';
        if (this.frameCacheTimestamp !== now) {
            this.frameCacheTimestamp = now;
            this.frameCache = Object.create(null);
        }
        if (Object.prototype.hasOwnProperty.call(this.frameCache, key)) return this.frameCache[key];
        const animation = this.spriteAnimations[key];
        if (!animation) return null;
        let time = now % animation.totalDuration;
        for (let i = 0; i < animation.frames.length; i++) {
            if (time < animation.durations[i]) {
                this.frameCache[key] = animation.frames[i];
                return animation.frames[i];
            }
            time -= animation.durations[i];
        }
        this.frameCache[key] = animation.frames[0];
        return animation.frames[0];
    }

    /** Draw the projectile's configured animation without changing its hitbox. */
    static draw(ctx, projectile, now) {
        const visualType = projectile.visualType || 'enemy-standard';
        const definition = this.SPRITE_DEFS[visualType] || this.SPRITE_DEFS['enemy-standard'];
        const frame = this.frameFor(visualType, now);
        const size = definition.size;
        if (frame) {
            const snapPixel = typeof snap === 'function' ? snap : Math.round;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(frame, snapPixel(projectile.x - size / 2), snapPixel(projectile.y - size / 2), size, size);
            ctx.restore();
        } else {
            pixelRect(ctx, projectile.x, projectile.y, size, size, projectile.color || '#ff453a');
        }
    }

    constructor(initialCapacity = EnemyProjectilePool.INITIAL_CAPACITY,
                growthSize = EnemyProjectilePool.GROWTH_SIZE) {
        this.initialCapacity = Math.max(0, Math.floor(initialCapacity));
        this.growthSize = Math.max(1, Math.floor(growthSize));
        this.free = [];
        this.capacity = 0;
        this.activeCount = 0;
        this.peakActive = 0;
        this.emergencyExpansions = 0;
        this.requestsWithoutFree = 0;
        this.shotsIssued = 0;
        this.released = 0;
        this._anonymousEnemyId = 0;
        this._grow(this.initialCapacity, false);
    }

    _createProjectile() {
        return {
            _poolOwner: this,
            _poolActive: false,
            active: false,
            x: 0, y: 0, vx: 0, vy: 0,
            damage: 0, radius: 0, color: null, speed: 0,
            projectileType: null, faction: null, ownerId: null,
            enemyId: null, range: 0, travelled: 0,
            pierce: 0, hits: 0, burn: null,
            visualType: null,
            ignorePlayerId: null, ignoreFrames: 0
        };
    }

    _grow(count, emergency) {
        for (let i = 0; i < count; i++) this.free.push(this._createProjectile());
        this.capacity += count;
        if (emergency && count > 0) this.emergencyExpansions++;
    }

    /** Guarantee at least the requested capacity without recording emergency growth. */
    ensureCapacity(minimum = this.initialCapacity) {
        const target = Math.max(0, Math.floor(minimum));
        while (this.capacity < target) {
            this._grow(Math.min(this.growthSize, target - this.capacity), false);
        }
        return this.capacity;
    }

    /** Activate a projectile using the firing enemy's current attack values. */
    acquire(enemy, angle, baseSpeed = 1.5) {
        if (!this.free.length) {
            this.requestsWithoutFree++;
            this._grow(this.growthSize, true);
        }

        const projectile = this.free.pop();
        const speed = baseSpeed;
        if (enemy.id == null && enemy._poolProjectileOwnerId == null) {
            enemy._poolProjectileOwnerId = `enemy-${++this._anonymousEnemyId}`;
        }
        const ownerId = enemy.id ?? enemy._poolProjectileOwnerId;

        // Fully overwrite all mutable state so reuse cannot retain a previous
        // hit, ricochet target, owner, status effect or visual property.
        projectile._poolActive = true;
        projectile.active = true;
        projectile.x = enemy.x;
        projectile.y = enemy.y;
        projectile.vx = Math.cos(angle) * speed;
        projectile.vy = Math.sin(angle) * speed;
        projectile.damage = enemy.type === 'boss' ? 12 : 6;
        projectile.radius = EnemyProjectilePool.HITBOX_RADIUS;
        projectile.color = enemy.color;
        projectile.speed = speed;
        projectile.projectileType = enemy.type === 'boss' ? 'boss-special' : 'standard';
        projectile.visualType = enemy.projectileVisualType || 'enemy-standard';
        projectile.faction = 'enemy';
        projectile.ownerId = ownerId;
        projectile.enemyId = ownerId;
        projectile.range = 0;
        projectile.travelled = 0;
        projectile.pierce = 0;
        projectile.hits = 0;
        projectile.burn = null;
        projectile.ignorePlayerId = null;
        projectile.ignoreFrames = 0;

        this.activeCount++;
        this.shotsIssued++;
        if (this.activeCount > this.peakActive) this.peakActive = this.activeCount;
        return projectile;
    }

    /** Return a projectile once; repeated release attempts are harmless. */
    release(projectile) {
        if (!projectile || projectile._poolOwner !== this || !projectile._poolActive) return false;
        projectile._poolActive = false;
        projectile.active = false;
        projectile.x = 0;
        projectile.y = 0;
        projectile.vx = 0;
        projectile.vy = 0;
        projectile.damage = 0;
        projectile.radius = 0;
        projectile.color = null;
        projectile.speed = 0;
        projectile.projectileType = null;
        projectile.visualType = null;
        projectile.faction = null;
        projectile.ownerId = null;
        projectile.enemyId = null;
        projectile.range = 0;
        projectile.travelled = 0;
        projectile.pierce = 0;
        projectile.hits = 0;
        projectile.burn = null;
        projectile.ignorePlayerId = null;
        projectile.ignoreFrames = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.released++;
        this.free.push(projectile);
        return true;
    }

    /** Release every pooled bullet and empty the simulation's live list. */
    releaseAll(projectiles) {
        if (!Array.isArray(projectiles)) return;
        for (const projectile of projectiles) this.release(projectile);
        projectiles.length = 0;
    }

    /** Compact an enemy-projectile array in place, returning expired objects. */
    compact(projectiles, shouldKeep = null) {
        let write = 0;
        for (let read = 0; read < projectiles.length; read++) {
            const projectile = projectiles[read];
            const keep = projectile &&
                (projectile._poolOwner !== this || projectile._poolActive) &&
                (!shouldKeep || shouldKeep(projectile));
            if (keep) {
                projectiles[write++] = projectile;
            } else {
                this.release(projectile);
            }
        }
        projectiles.length = write;
        return write;
    }

    /** Reset per-run measurements while retaining allocated storage. */
    resetRunStats() {
        this.peakActive = this.activeCount;
        this.emergencyExpansions = 0;
        this.requestsWithoutFree = 0;
        this.shotsIssued = 0;
        this.released = 0;
    }

    /** Snapshot suitable for developer diagnostics; not sent to game clients. */
    getStats() {
        return {
            initialCapacity: this.initialCapacity,
            capacity: this.capacity,
            active: this.activeCount,
            available: this.free.length,
            peakActive: this.peakActive,
            emergencyExpansions: this.emergencyExpansions,
            requestsWithoutFree: this.requestsWithoutFree,
            shotsIssued: this.shotsIssued,
            released: this.released
        };
    }
}

// Start loading the standard projectile animation without blocking the lobby.
if (typeof document !== 'undefined') EnemyProjectilePool.loadSpriteAnimation();
