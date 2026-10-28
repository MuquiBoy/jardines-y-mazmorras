/* Esbirro: clase independiente, cargada después de js/enemy.js. */
// ===== BasicEnemy — Chaser =====
class BasicEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'basic');
        this.health = 30;
        this.maxHealth = 30;
        this.speed = 1.1;
        this.damage = 10;
        this.radius = 14;
        this.color = '#ff4444';
        this.xpValue = 10;
        this.shootCooldown = 90;
    }

    draw(ctx) {
        this.drawBody(ctx, PALETTE.chaser, PALETTE.chaserLit);
    }

    update(player, enemies, map, allTargets = null, projectilePool = null) {
        // Route around walls instead of pushing straight into them.
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            this.steerTo(player.x, player.y, map);
        }

        // Shoot toward player
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            const angle = Math.atan2(dy, dx);
            return [this.shootTowardPlayer(angle, 1.5, projectilePool)];
        }
        return [];
    }
}
