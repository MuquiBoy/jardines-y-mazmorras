/* Esbirro: clase independiente, cargada después de js/enemy.js. */
// ===== SpiralEnemy — Pattern Shooter =====
class SpiralEnemy extends Enemy {
    constructor(x, y) {
        super(x, y, 'spiral');
        this.health = 50;
        this.maxHealth = 50;
        this.speed = 0.6;
        this.damage = 8;
        this.radius = 16;
        this.color = '#ff8800';
        this.xpValue = 20;
        this.shootCooldown = 45;
        this.spiralAngle = 0;
    }

    draw(ctx) {
        this.drawBody(ctx, PALETTE.spiral, PALETTE.spiralLit);
        // Four orbiting pips telegraph the ring attack
        for (let i = 0; i < 4; i++) {
            const a = this.spiralAngle + (Math.PI / 2) * i;
            pixelRect(ctx, this.x + Math.cos(a) * (this.radius + 8),
                           this.y + Math.sin(a) * (this.radius + 8),
                           4, 4, PALETTE.spiralLit);
        }
    }

    update(player, enemies, map) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Move slowly toward player, stop at ~150px
        if (dist > 140) {
            this.steerTo(player.x, player.y, map);
        }

        // Spiral bullet pattern
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            const bullets = [];
            const count = 5;
            for (let i = 0; i < count; i++) {
                const angle = this.spiralAngle + (Math.PI * 2 / count) * i;
                bullets.push(this.shootTowardPlayer(angle, 1.25));
            }
            this.spiralAngle += 0.4; // rotate pattern each shot
            return bullets;
        }
        return [];
    }
}
