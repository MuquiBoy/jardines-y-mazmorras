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
    return circleCollision(bullet.x, bullet.y, bullet.radius, player.x, player.y, player.radius);
}

/**
 * Remove bullets that are out of bounds.
 * @param {Array} bullets
 * @param {number} margin - extra margin beyond bounds
 * @param {number} mapWidth - width of the map area
 * @param {number} mapHeight - height of the map area
 * @returns {Array} filtered bullets
 */
/**
 * Deflect an enemy projectile away from Bastion. In a party, aim it toward a
 * random living teammate so it remains hostile and can cause friendly fire.
 * In solo play, reflect it from Bastion's radial surface.
 */
function ricochetEnemyBulletTowardParty(bullet, bastion, party) {
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
    const teammates = party.filter(player => player !== bastion && player.health > 0);
    let vx, vy;

    if (teammates.length) {
        const target = teammates[Math.floor(Math.random() * teammates.length)];
        const spread = (Math.random() - 0.5) * 0.24;
        const angle = Math.atan2(target.y - bullet.y, target.x - bullet.x) + spread;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
    } else {
        let nx = bullet.x - bastion.x;
        let ny = bullet.y - bastion.y;
        const normalLength = Math.hypot(nx, ny);
        if (normalLength > 0) { nx /= normalLength; ny /= normalLength; }
        else { nx = -bullet.vx / speed; ny = -bullet.vy / speed; }
        const projection = bullet.vx * nx + bullet.vy * ny;
        vx = bullet.vx - 2 * projection * nx;
        vy = bullet.vy - 2 * projection * ny;
    }

    const directionLength = Math.hypot(vx, vy) || 1;
    const ux = vx / directionLength, uy = vy / directionLength;
    bullet.vx = ux * speed;
    bullet.vy = uy * speed;
    const clearance = bastion.radius + bullet.radius + 2;
    bullet.x = bastion.x + ux * clearance;
    bullet.y = bastion.y + uy * clearance;
    bullet.ignorePlayerId = bastion.id ?? 'local';
    bullet.ignoreFrames = 8;
    return bullet;
}
function removeDead(bullets, margin = 100, mapWidth = 2000, mapHeight = 2000) {
    return bullets.filter(b => {
        return b.x > -margin && b.x < mapWidth + margin &&
               b.y > -margin && b.y < mapHeight + margin;
    });
}
