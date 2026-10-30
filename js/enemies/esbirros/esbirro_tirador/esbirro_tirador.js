/* Esbirro: clon de Mosca Tirador para ajustar su identidad y balance por separado. */
// ===== EsbirroTirador — Sniper (keeps distance) =====
class EsbirroTirador extends Enemy {
    static DRAW_SIZE = 28;

    constructor(x, y) {
        super(x, y, 'esbirro_tirador');
        this.name = 'Esbirro Tirador';
        this.health = 28;
        this.maxHealth = 28;
        this.setMovementSpeedMultiplier(0.70);
        this.damage = 15;
        this.radius = 12;
        this.color = '#aa44ff';
        this.xpValue = 15;
        this.shootCooldown = 60;
        this.shootTimer = initialEnemyShotDelay(this.shootCooldown);
        this.animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // Both enemies currently use the same authored art; decode it only once.
        MoscaTirador.loadAnimation();
    }

    draw(ctx) {
        const animation = MoscaTirador.animation;
        if (!animation || !animation.frames.length || animation.totalDuration <= 0) return;

        // This one cycle is shared by idle and movement; it loops continuously.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameTime = (now - this.animationStartTime) % animation.totalDuration;
        let frameIndex = 0;
        while (frameIndex < animation.durations.length - 1 &&
               frameTime >= animation.durations[frameIndex]) {
            frameTime -= animation.durations[frameIndex++];
        }

        const frame = animation.frames[frameIndex];
        const width = frame.width || EsbirroTirador.DRAW_SIZE;
        const height = frame.height || EsbirroTirador.DRAW_SIZE;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(frame, snap(this.x - width / 2), snap(this.y - height / 2), width, height);
        this.drawHealth(ctx, Math.max(width, height));
    }

    update(player, enemies, map, allTargets = null, projectilePool = null) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Keep distance: back off inside 180px, close in beyond 250px
        if (dist < 180) {
            this.retreatFrom(player.x, player.y, map);
        } else if (dist > 250) {
            this.steerTo(player.x, player.y, map);
        } else {
            // In the firing band: drop any stale route so it does not resume
            // a chase when the player moves again.
            this._navPath = null;
            this._navTimer = 0;
        }

        // Shoot
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            this.shootTimer = this.shootCooldown;
            return [this.shootTowardPlayer(Math.atan2(dy, dx), 2.5, projectilePool)];
        }
        return [];
    }
}
