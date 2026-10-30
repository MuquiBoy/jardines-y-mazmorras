/* Configuración de combate: los números son una primera pasada ajustable.
 * El cuerpo visible mide 24 px por visualScale; con sprite, ese tamaño incluye
 * el contorno dibujado por el autor. `sprite` es el nombre de la carpeta y del
 * PNG en 00-sprites/jugador/<sprite>/<sprite>_sticker.png. */
const UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME = 2.5; // 1.00 movement = 2.5 px/frame (150 px/s) at 60 Hz.

/** Convert any authored movement multiplier through the one universal reference. */
function movementSpeedFromMultiplier(multiplier) {
    return UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME * multiplier;
}

class CharacterRole {
    constructor(config) {
        Object.assign(this, config);
    }

    apply(player) {
        player.character = this.id;
        // Role health is the permanent red-heart pool. Gray hearts are a
        // separate temporary buffer that sits in front of it.
        player.maxHealth = this.health;
        player.maxGrayHealth = Math.max(0, Math.floor(this.grayHearts || 0)) * 12;
        player.grayHealth = player.maxGrayHealth;
        player.health = player.maxHealth + player.grayHealth;
        player.speed = movementSpeedFromMultiplier(this.movementSpeed ?? 1.00);
        player.damage = this.damage;
        player.fireRate = this.fireRate;
        player.bulletSpeed = this.bulletSpeed;
        player.bulletCount = 1;
        player.bulletPierce = 0;
        player.radius = this.collisionRadius;
        player.visualScale = this.visualScale;
        player.color = this.color;
        player.weaponKind = this.weaponKind;
        player.sprite = this.sprite || null;
        player.ammoCapacity = this.magazine;
        player.ammo = this.magazine;
        player.reloadFrames = this.reloadFrames;
        player.reloadTimer = 0;
        player.pelletCount = this.pelletCount || 1;
        player.spread = this.spread;
        player.range = this.range;
        player.burn = this.burn || null;
        player.summon = this.summon || null;
        player.incomingDamageMultiplier = this.incomingDamageMultiplier ?? 1;
        player.enemyProjectileRicochetChance = this.enemyProjectileRicochetChance ?? 0;
        player.turretActive = false;
    }
}

const CHARACTER_ROLES = Object.freeze({
    // Player movement speed uses the universal multiplier scale:
    // 1.00 equals UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME (150 px/s) at 60 Hz.
    // The invisible 24x24 pistolero_hitbox.png mask has a 20x23px occupied
    // silhouette; approximate it with an 11px circle for the current physics.
    pistolero: new CharacterRole({ id: 'pistolero', name: 'Pistolero', color: '#55d64b', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 7, fireRate: 18, bulletSpeed: 4.5, magazine: 10, reloadFrames: 72, range: 320, spread: 0.035, collisionRadius: 11, visualScale: 1, weaponKind: 'gun', sprite: 'pistolero', damageMask: 'pistolero_take damage.aseprite', damageMaskLayer: 'mask' }),
    // The invisible 24x24 tirador_hitbox.png mask has the same 20x23px
    // occupied silhouette as Pistolero, so its circle-physics radius is 11px.
    tirador: new CharacterRole({ id: 'tirador', name: 'Tirador', color: '#48a9ff', health: 24, grayHearts: 0, movementSpeed: 1.00, damage: 28, fireRate: 72, bulletSpeed: 7.5, magazine: 3, reloadFrames: 198, range: 960, spread: 0.006, collisionRadius: 11, visualScale: 1, weaponKind: 'gun', sprite: 'tirador', damageMask: 'tirador_take damage.aseprite', damageMaskLayer: 'mask' }),
    perdigonero: new CharacterRole({ id: 'perdigonero', name: 'Perdigonero', color: '#f044b5', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 6, fireRate: 66, bulletSpeed: 3.5, magazine: 5, reloadFrames: 128, range: 270, spread: 0.58, pelletCount: 5, collisionRadius: 12, visualScale: 1, weaponKind: 'shotgun', sprite: 'perdigonero' }),
    invocador: new CharacterRole({ id: 'invocador', name: 'Invocador', color: '#ae64e8', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 2, fireRate: 32, bulletSpeed: 0, magazine: 6, reloadFrames: 272, range: 0, spread: 0, collisionRadius: 12, visualScale: 32 / 24, weaponKind: 'summoner', sprite: 'invocador', summon: { health: 28, speed: 1.9, damage: 2, attackRate: 32, lifetime: 900, radius: 9, maxActive: 6, color: '#ae64e8' } }),
    piromano: new CharacterRole({ id: 'piromano', name: 'Piromano', color: '#ff453a', health: 24, grayHearts: 0, movementSpeed: 1.00, damage: 6, fireRate: 72, bulletSpeed: 3.5, magazine: 7, reloadFrames: 142, range: 235, spread: 0.07, collisionRadius: 12, visualScale: 1, weaponKind: 'fire', sprite: 'piromano', burn: { damage: 2, interval: 24, duration: 144 } }),
    bastion: new CharacterRole({ id: 'bastion', name: 'Bastión', color: '#ff951f', health: 48, grayHearts: 0, movementSpeed: 1.00, damage: 2, fireRate: 7, bulletSpeed: 3.75, magazine: 100, reloadFrames: 420, range: 480, spread: 0.30, collisionRadius: 17, visualScale: 40 / 24, incomingDamageMultiplier: 0.75, enemyProjectileRicochetChance: 0.5, weaponKind: 'turret', sprite: 'bastion' })
});

class SummonedUnit {
    constructor(id, ownerId, x, y, config) {
        this.id = id;
        this.ownerId = ownerId;
        this.x = x;
        this.y = y;
        this.health = config.health;
        this.maxHealth = config.health;
        this.speed = config.speed;
        this.damage = config.damage;
        this.attackRate = config.attackRate;
        this.attackTimer = 10;
        this.lifetime = config.lifetime;
        this.radius = config.radius;
        // The Invocador attacks through its summons, so they carry the role
        // color exactly like other roles' projectiles do.
        this.color = config.color || CHARACTER_ROLES.invocador.color;
        this.alive = true;
    }

    takeDamage(amount) {
        if (!this.alive) return;
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) this.alive = false;
    }

    update(enemies, map) {
        if (!this.alive) return null;
        this.lifetime--;
        if (this.lifetime <= 0) { this.alive = false; return null; }
        if (this.attackTimer > 0) this.attackTimer--;
        let target = null, best = Infinity;
        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const d = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (d < best) { target = enemy; best = d; }
        }
        if (!target) return null;
        const reach = this.radius + target.radius + 7;
        if (best <= reach) {
            if (this.attackTimer <= 0) {
                this.attackTimer = this.attackRate;
                target.takeDamage(this.damage);
                return target;
            }
            return null;
        }
        const dx = (target.x - this.x) / best * this.speed;
        const dy = (target.y - this.y) / best * this.speed;
        if (!map || map.canOccupy(this.x + dx, this.y, this.radius)) this.x += dx;
        if (!map || map.canOccupy(this.x, this.y + dy, this.radius)) this.y += dy;
        return null;
    }
}

