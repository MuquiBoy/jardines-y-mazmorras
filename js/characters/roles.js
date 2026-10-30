/* Configuración de combate: los números son una primera pasada ajustable.
 * El cuerpo visible mide 24 px por visualScale; con sprite, ese tamaño incluye
 * el contorno dibujado por el autor. `sprite` es el nombre de la carpeta y del
 * PNG en 00-sprites/jugador/<sprite>/<sprite>_sticker.png. */
const UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME = 2.5; // 1.00 movement = 2.5 px/frame (150 px/s) at 60 Hz.

/** Convert any authored movement multiplier through the one universal reference. */
function movementSpeedFromMultiplier(multiplier) {
    return UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME * multiplier;
}

/** Decode horizontal opaque-pixel runs from a 40x40 authored hitbox PNG. */
function createPixelHitboxMask(encodedRows) {
    const spans = [];
    let minX = 40, minY = 40, maxX = 0, maxY = 0;
    for (const encodedRow of encodedRows.split(';')) {
        const [rowText, rangesText] = encodedRow.split(':');
        const y = Number(rowText);
        for (const rangeText of rangesText.split(',')) {
            const [startText, endText] = rangeText.split('-');
            const start = Number(startText);
            const end = Number(endText) + 1;
            spans.push([y, start, end]);
            minX = Math.min(minX, start);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, end);
            maxY = Math.max(maxY, y + 1);
        }
    }
    const originX = 20, originY = 20;
    return Object.freeze({
        width: 40, height: 40, originX, originY,
        spans: Object.freeze(spans.map(span => Object.freeze(span))),
        bounds: Object.freeze({
            left: originX - minX, right: maxX - originX,
            top: originY - minY, bottom: maxY - originY
        })
    });
}

// Pixel runs extracted from each transparent PNG, preserving the different
// silhouettes and transparent gaps between the armored and depleted forms.
const BASTION_HITBOX_MASKS = Object.freeze({
    armored: createPixelHitboxMask('3:19-20;4:18-21;5:18-21;6:17-22;7:14-25;8:13-26;9:11-28;10:10-29;11:9-30;12:8-31;13:8-31;14:7-32;15:6-33;16:6-33;17:6-33;18:2-3,5-34,36-37;19:1-38;20:0-39;21:0-39;22:0-39;23:1-38;24:2-37;25:4-35;26:4-35;27:4-35;28:5-34;29:6-33;30:7-32;31:8-31;32:9-30;33:10-29;34:9-30;35:9-30;36:10-18,21-29;37:11-17,22-28;38:12-16,23-27'),
    depleted: createPixelHitboxMask('3:19-20;4:18-21;5:18-21;6:16-23;7:15-24;8:14-25;9:13-26;10:12-27;11:12-27;12:11-28;13:11-28;14:11-28;15:11-28;16:11-28;17:10-29;18:2-7,9-30,32-37;19:1-38;20:0-39;21:0-39;22:1-38;23:2-37;24:4-35;25:7-32;26:7-32;27:7-32;28:8-31;29:8-31;30:9-30;31:10-29;32:11-28;33:12-27;34:11-28;35:11-28;36:11-17,22-28;37:12-16,23-27;38:13-15,24-26')
});

/** Circle contact against all occupied one-pixel rectangles in a role mask. */
function circleIntersectsPixelHitbox(cx, cy, radius, playerX, playerY, mask) {
    if (!mask || radius < 0) return false;
    const left = playerX - mask.originX;
    const top = playerY - mask.originY;
    const radiusSq = radius * radius;
    for (const [row, start, end] of mask.spans) {
        const rectTop = top + row;
        if (cy + radius < rectTop || cy - radius > rectTop + 1) continue;
        const rectLeft = left + start;
        const rectRight = left + end;
        const nearestX = Math.max(rectLeft, Math.min(cx, rectRight));
        const nearestY = Math.max(rectTop, Math.min(cy, rectTop + 1));
        const dx = cx - nearestX, dy = cy - nearestY;
        if (dx * dx + dy * dy < radiusSq) return true;
    }
    return false;
}

function pointSegmentDistanceSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq)) : 0;
    const ox = px - (x1 + dx * t), oy = py - (y1 + dy * t);
    return ox * ox + oy * oy;
}

function segmentIntersectsRect(x1, y1, x2, y2, left, top, right, bottom) {
    const dx = x2 - x1, dy = y2 - y1;
    let tMin = 0, tMax = 1;
    const clips = [
        [-dx, x1 - left], [dx, right - x1],
        [-dy, y1 - top], [dy, bottom - y1]
    ];
    for (const [p, q] of clips) {
        if (p === 0) { if (q < 0) return false; continue; }
        const t = q / p;
        if (p < 0) tMin = Math.max(tMin, t);
        else tMax = Math.min(tMax, t);
        if (tMin > tMax) return false;
    }
    return true;
}

/** Capsule contact against the occupied pixel rectangles of a role mask. */
function segmentIntersectsPixelHitbox(x1, y1, x2, y2, radius, playerX, playerY, mask) {
    if (!mask) return false;
    const left = playerX - mask.originX;
    const top = playerY - mask.originY;
    const radiusSq = radius * radius;
    const minBeamX = Math.min(x1, x2) - radius;
    const maxBeamX = Math.max(x1, x2) + radius;
    const minBeamY = Math.min(y1, y2) - radius;
    const maxBeamY = Math.max(y1, y2) + radius;
    for (const [row, start, end] of mask.spans) {
        const rectLeft = left + start, rectRight = left + end;
        const rectTop = top + row, rectBottom = rectTop + 1;
        if (rectRight < minBeamX || rectLeft > maxBeamX || rectBottom < minBeamY || rectTop > maxBeamY) continue;
        if (segmentIntersectsRect(x1, y1, x2, y2, rectLeft, rectTop, rectRight, rectBottom)) return true;
        const edges = [
            [rectLeft, rectTop, rectRight, rectTop],
            [rectRight, rectTop, rectRight, rectBottom],
            [rectRight, rectBottom, rectLeft, rectBottom],
            [rectLeft, rectBottom, rectLeft, rectTop]
        ];
        for (const [ax, ay, bx, by] of edges) {
            const distanceSq = Math.min(
                pointSegmentDistanceSq(ax, ay, x1, y1, x2, y2),
                pointSegmentDistanceSq(bx, by, x1, y1, x2, y2),
                pointSegmentDistanceSq(x1, y1, ax, ay, bx, by),
                pointSegmentDistanceSq(x2, y2, ax, ay, bx, by)
            );
            if (distanceSq <= radiusSq) return true;
        }
    }
    return false;
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
        player.hitboxMask = this.hitboxMask || null;
        player.depletedHitboxMask = this.depletedHitboxMask || null;
        player.hitboxWidth = this.hitboxWidth || 0;
        player.hitboxHeight = this.hitboxHeight || 0;
        player.spriteWidth = this.spriteWidth || 24;
        player.spriteHeight = this.spriteHeight || 24;
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
        player.turretActive = false;
        player.turretMovementSpeed = this.turretMovementSpeed ?? null;
        player.bastionForm = this.id === 'bastion' ? 'armored' : null;
        if (this.id === 'bastion') player.updateBastionForm();
    }
}

const CHARACTER_ROLES = Object.freeze({
    // Player movement speed uses the universal multiplier scale:
    // 1.00 equals UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME (150 px/s) at 60 Hz.
    // Pistolero uses a 24x24 px sprite and the 20x23 px occupied silhouette
    // from pistolero_hitbox.png as its independent collision rectangle.
    pistolero: new CharacterRole({ id: 'pistolero', name: 'Pistolero', color: '#55d64b', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 7, fireRate: 18, bulletSpeed: 4.5, magazine: 10, reloadFrames: 72, range: 320, spread: 0.035, collisionRadius: 11, hitboxWidth: 20, hitboxHeight: 23, spriteWidth: 24, spriteHeight: 24, visualScale: 1, weaponKind: 'gun', sprite: 'pistolero', damageMask: 'pistolero_take damage.aseprite', damageMaskLayer: 'mask' }),
    // The invisible 24x24 tirador_hitbox.png mask has the same 20x23px
    // occupied silhouette as Pistolero, so its circle-physics radius is 11px.
    tirador: new CharacterRole({ id: 'tirador', name: 'Tirador', color: '#48a9ff', health: 24, grayHearts: 0, movementSpeed: 1.00, damage: 28, fireRate: 72, bulletSpeed: 7.5, magazine: 3, reloadFrames: 198, range: 960, spread: 0.006, collisionRadius: 11, visualScale: 1, weaponKind: 'gun', sprite: 'tirador', damageMask: 'tirador_take damage.aseprite', damageMaskLayer: 'mask' }),
    perdigonero: new CharacterRole({ id: 'perdigonero', name: 'Perdigonero', color: '#f044b5', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 6, fireRate: 66, bulletSpeed: 3.5, magazine: 5, reloadFrames: 128, range: 270, spread: 0.58, pelletCount: 5, collisionRadius: 12, visualScale: 1, weaponKind: 'shotgun', sprite: 'perdigonero' }),
    invocador: new CharacterRole({ id: 'invocador', name: 'Invocador', color: '#ae64e8', health: 36, grayHearts: 0, movementSpeed: 1.00, damage: 2, fireRate: 32, bulletSpeed: 0, magazine: 6, reloadFrames: 272, range: 0, spread: 0, collisionRadius: 12, visualScale: 32 / 24, weaponKind: 'summoner', sprite: 'invocador', summon: { health: 28, speed: 1.9, damage: 2, attackRate: 32, lifetime: 900, radius: 9, maxActive: 6, color: '#ae64e8' } }),
    piromano: new CharacterRole({ id: 'piromano', name: 'Piromano', color: '#ff453a', health: 24, grayHearts: 0, movementSpeed: 1.00, damage: 6, fireRate: 72, bulletSpeed: 3.5, magazine: 7, reloadFrames: 142, range: 235, spread: 0.07, collisionRadius: 12, visualScale: 1, weaponKind: 'fire', sprite: 'piromano', burn: { damage: 2, interval: 24, duration: 144 } }),
    bastion: new CharacterRole({ id: 'bastion', name: 'Bastión', color: '#ff951f', health: 36, grayHearts: 1, movementSpeed: 0.85, depletedMovementSpeed: 1.00, turretMovementSpeed: 0.60, depletedSprite: 'bastion-debil', hitboxMask: BASTION_HITBOX_MASKS.armored, depletedHitboxMask: BASTION_HITBOX_MASKS.depleted, damage: 2, fireRate: 9, bulletSpeed: 3.75, magazine: 35, reloadFrames: 300, range: 480, spread: 0.30, collisionRadius: 17, visualScale: 40 / 24, weaponKind: 'turret', sprite: 'bastion' })
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
