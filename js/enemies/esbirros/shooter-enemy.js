/* Esbirro: clase independiente, cargada después de js/enemy.js. */
// ===== ShooterEnemy — Sniper (keeps distance) =====
class ShooterEnemy extends Enemy {
    static walkAnimation = null;
    static walkAnimationPromise = null;
    static DRAW_SIZE = 30;

    constructor(x, y) {
        super(x, y, 'shooter');
        this.health = 20;
        this.maxHealth = 20;
        this.speed = 0.75;
        this.damage = 15;
        this.radius = 12;
        this.color = '#aa44ff';
        this.xpValue = 15;
        this.shootCooldown = 60;
        this.animationStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.loadWalkAnimation();
    }

    loadWalkAnimation() {
        if (ShooterEnemy.walkAnimation) return;
        if (ShooterEnemy.walkAnimationPromise || typeof decodeAsepriteWalk !== 'function') return;
        const url = '00-sprites/enemigos/mosca_tirador/mosca_tirador.aseprite?v=shooter-fly-walk-v1';
        ShooterEnemy.walkAnimationPromise = decodeAsepriteWalk(url)
            .then(animation => {
                if (animation) ShooterEnemy.walkAnimation = animation;
                return animation;
            })
            .catch(error => {
                ShooterEnemy.walkAnimationPromise = null;
                console.warn('No se pudo cargar la animación de la Mosca Tirador.', error);
                return null;
            });
    }

    draw(ctx) {
        const animation = ShooterEnemy.walkAnimation;
        if (!animation || animation.totalDuration <= 0) {
            // Keep a readable placeholder until the authored frames have loaded.
            this.drawBody(ctx, PALETTE.shooter, PALETTE.shooterLit, ShooterEnemy.DRAW_SIZE);
            return;
        }

        // The same timed loop runs while the enemy moves, aims, or stands still.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameTime = (now - this.animationStartTime) % animation.totalDuration;
        let frameIndex = 0;
        while (frameIndex < animation.durations.length - 1 &&
               frameTime >= animation.durations[frameIndex]) {
            frameTime -= animation.durations[frameIndex++];
        }

        const frame = animation.frames[frameIndex];
        const width = frame.width || ShooterEnemy.DRAW_SIZE;
        const height = frame.height || ShooterEnemy.DRAW_SIZE;
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
