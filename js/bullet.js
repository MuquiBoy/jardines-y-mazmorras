/**
 * Bullet utilities — collision detection and cleanup.
 */

/**
 * Circle-circle collision check.
 * @param {number} x1
 * @param {number} y1
 * @param {number} r1
 * @param {number} x2
 * @param {number} y2
 * @param {number} r2
 * @returns {boolean}
 */
function circleCollision(x1, y1, r1, x2, y2, r2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return (dx * dx + dy * dy) < (r1 + r2) * (r1 + r2);
}

/**
 * Check if an enemy bullet hits the player.
 * @param {Object} bullet - enemy bullet
 * @param {Object} player - player object
 * @returns {boolean}
 */
function bulletHitsPlayer(bullet, player) {
    if (player.hitboxWidth > 0 && player.hitboxHeight > 0) {
        const halfWidth = player.hitboxWidth / 2;
        const halfHeight = player.hitboxHeight / 2;
        const closestX = Math.max(player.x - halfWidth, Math.min(bullet.x, player.x + halfWidth));
        const closestY = Math.max(player.y - halfHeight, Math.min(bullet.y, player.y + halfHeight));
        const dx = bullet.x - closestX;
        const dy = bullet.y - closestY;
        return dx * dx + dy * dy < bullet.radius * bullet.radius;
    }
    return circleCollision(bullet.x, bullet.y, bullet.radius, player.x, player.y, player.radius);
}

/**
 * True when a projectile has entered a solid cell of the authored room mask.
 *
 * Red walls (mask 0) and blue obstacles (mask 3) are both non-walkable, so the
 * same authoritative check stops player and enemy shots in solo and co-op.
 * Projectiles move at half speed since the 200% camera patch, well below one
 * 40 px tile per step, so sampling the centre cannot tunnel through a wall.
 *
 * @param {Object|null} map - DungeonMap (or a compatible test double)
 * @param {Object} bullet - projectile with x and y
 * @returns {boolean}
 */
function bulletBlockedByMap(map, bullet) {
    return !!map && typeof map.isWalkable === 'function' && !map.isWalkable(bullet.x, bullet.y);
}

/**
 * Remove bullets that are out of bounds.
 * @param {Array} bullets
 * @param {number} margin - extra margin beyond bounds
 * @param {number} mapWidth - width of the map area
 * @param {number} mapHeight - height of the map area
 * @returns {Array} filtered bullets
 */
function removeDead(bullets, margin = 100, mapWidth = 2000, mapHeight = 2000) {
    return bullets.filter(b => {
        return b.x > -margin && b.x < mapWidth + margin &&
               b.y > -margin && b.y < mapHeight + margin;
    });
}
