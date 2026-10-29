/* Esbirro: clase independiente, cargada después de js/enemy.js. */
// ===== MoscaTirador — Sniper (keeps distance) =====
class MoscaTirador extends Enemy {
    static animation = null;
    static animationPromise = null;
    static DRAW_SIZE = 28;

    constructor(x, y) {
        super(x, y, 'mosca_tirador');
        this.name = 'Mosca Tirador';
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
        this.loadAnimation();
    }

    loadAnimation() {
        if (MoscaTirador.animation) return;
        if (MoscaTirador.animationPromise || typeof decodeAsepriteAnimation !== 'function') return;
        const url = '00-sprites/enemigos/2_esbirros/mosca_tirador/mosca_tirador.aseprite?v=mosca-tirador-animation-folder-v1';
        MoscaTirador.animationPromise = decodeAsepriteAnimation(url)
            .then(animation => {
                if (animation) MoscaTirador.animation = animation;
                return animation;
            })
            .catch(error => {
                MoscaTirador.animationPromise = null;
                console.warn('No se pudo cargar la animación de la Mosca Tirador.', error);
                return null;
            });
    }

    draw(ctx) {
        const animation = MoscaTirador.animation;
        if (!animation || animation.totalDuration <= 0) {
            // Keep a readable placeholder until the authored frames have loaded.
            this.drawBody(ctx, PALETTE.moscaTirador, PALETTE.moscaTiradorLit, MoscaTirador.DRAW_SIZE);
            return;
        }

        // This one cycle is shared by idle and movement; it loops continuously.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameTime = (now - this.animationStartTime) % animation.totalDuration;
        let frameIndex = 0;
        while (frameIndex < animation.durations.length - 1 &&
               frameTime >= animation.durations[frameIndex]) {
            frameTime -= animation.durations[frameIndex++];
        }

        const frame = animation.frames[frameIndex];
        const width = frame.width || MoscaTirador.DRAW_SIZE;
        const height = frame.height || MoscaTirador.DRAW_SIZE;
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
