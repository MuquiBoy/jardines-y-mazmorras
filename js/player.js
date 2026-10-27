/** Player combat, movement, ammunition, and leveling. */
const PLAYER_SPRITE_ROOT = '00-sprites/jugador/';
const PLAYER_SPRITE_VERSION = 'player-role-sprites-v1';

class Player {
    static XP_GROWTH = 1.20;
    static sprites = null;

    /**
     * Load the authored role stickers once.
     *
     * Path convention: 00-sprites/jugador/<role>/<role>_sticker.png.
     * A role without a sticker (perdigonero for now) keeps the vector
     * placeholder, so a missing file never breaks the run.
     */
    static loadSprites() {
        if (Player.sprites || typeof Image === 'undefined') return Player.sprites;
        Player.sprites = {};
        for (const role of Object.values(CHARACTER_ROLES)) {
            if (!role.sprite) continue;
            const image = new Image();
            image.src = `${PLAYER_SPRITE_ROOT}${role.sprite}/${role.sprite}_sticker.png?v=${PLAYER_SPRITE_VERSION}`;
            Player.sprites[role.id] = image;
        }
        return Player.sprites;
    }

    static spriteFor(character) {
        const sprites = Player.sprites || Player.loadSprites();
        return sprites ? sprites[character] || null : null;
    }

    constructor(x, y) {
        Player.loadSprites();
        this.x = x; this.y = y; this.radius = 12; this.visualScale = 1;
        this.maxHealth = 100; this.health = 100; this.speed = 4.5; this.damage = 10;
        this.fireRate = 12; this.bulletSpeed = 7; this.bulletCount = 1;
        this.bulletPierce = 0; this.magnetRange = 100;
        this.ammoCapacity = 15; this.ammo = 15; this.reloadFrames = 54; this.reloadTimer = 0;
        this.pelletCount = 1; this.spread = 0.03; this.range = 500;
        this.weaponKind = 'gun'; this.color = '#55d64b'; this.burn = null; this.summon = null;
        this.incomingDamageMultiplier = 1; this.enemyProjectileRicochetChance = 0; this.turretActive = false;
        this.level = 1; this.xp = 0;
        this.xpTable = [50, 120, 220, 350, 520, 750, 1050, 1400, 1850, 2400];
        this.fireTimer = 0; this.invincibleTimer = 0;
        this.aimX = 0; this.aimY = -1; this.angle = 0; this.character = 'pistolero';
    }

    setCharacter(characterId) {
        const role = CHARACTER_ROLES[characterId] || CHARACTER_ROLES.pistolero;
        role.apply(this);
        return role;
    }

    xpToNext() {
        const i = this.level - 1;
        if (i < this.xpTable.length) return this.xpTable[i];
        return Math.round(this.xpTable[this.xpTable.length - 1] * Math.pow(Player.XP_GROWTH, i - this.xpTable.length + 1));
    }

    gainXP(amount) {
        this.xp += amount;
        const needed = this.xpToNext();
        if (needed > 0 && this.xp >= needed) { this.xp -= needed; this.level++; return true; }
        return false;
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0) return;
        this.health = Math.max(0, this.health - amount);
        this.invincibleTimer = 30;
    }

    heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }

    startReload() {
        if (this.reloadTimer > 0 || this.ammo >= this.ammoCapacity) return false;
        this.reloadTimer = this.reloadFrames;
        return true;
    }

    updateReload(input) {
        if (input.reload || (input.keys && input.keys['KeyR'])) this.startReload();
        if (this.ammo <= 0 && this.reloadTimer <= 0) this.startReload();
        if (this.reloadTimer > 0) {
            this.reloadTimer--;
            if (this.reloadTimer <= 0) {
                this.reloadTimer = 0;
                this.ammo = this.ammoCapacity;
            }
        }
    }

    update(input, camera, map, blockers = []) {
        this.updateReload(input);
        let dx = 0, dy = 0;
        if (input.moveX || input.moveY) {
            dx = input.moveX; dy = input.moveY;
            const mag = Math.hypot(dx, dy);
            if (mag > 1) { dx /= mag; dy /= mag; }
        } else {
            if (input.keys['KeyW'] || input.keys['ArrowUp']) dy--;
            if (input.keys['KeyS'] || input.keys['ArrowDown']) dy++;
            if (input.keys['KeyA'] || input.keys['ArrowLeft']) dx--;
            if (input.keys['KeyD'] || input.keys['ArrowRight']) dx++;
            if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
        }
        this.turretActive = this.weaponKind === 'turret' && !!input.mouseDown;
        const moveSpeed = this.turretActive ? 0 : this.speed;
        const canMoveTo = (x, y) => {
            if (map && !map.canOccupy(x, y, this.radius)) return false;
            for (const blocker of blockers) {
                if (!blocker || blocker.alive === false) continue;
                const minDistance = this.radius + blocker.radius;
                const currentX = this.x - blocker.x, currentY = this.y - blocker.y;
                const nextX = x - blocker.x, nextY = y - blocker.y;
                const currentDistanceSq = currentX * currentX + currentY * currentY;
                const nextDistanceSq = nextX * nextX + nextY * nextY;
                if (nextDistanceSq < minDistance * minDistance &&
                    !(currentDistanceSq < minDistance * minDistance && nextDistanceSq > currentDistanceSq)) return false;
            }
            return true;
        };
        const nx = this.x + dx * moveSpeed;
        if (canMoveTo(nx, this.y)) this.x = nx;
        const ny = this.y + dy * moveSpeed;
        if (canMoveTo(this.x, ny)) this.y = ny;
        if (map) {
            this.x = Math.max(this.radius, Math.min(this.x, map.width - this.radius));
            this.y = Math.max(this.radius, Math.min(this.y, map.height - this.radius));
        }

        if (input.aimActive) { this.aimX = input.aimX; this.aimY = input.aimY; }
        else if (input.mouseX !== undefined) {
            const ax = (camera ? camera.x : 0) + input.mouseX - this.x;
            const ay = (camera ? camera.y : 0) + input.mouseY - this.y;
            const dist = Math.hypot(ax, ay);
            if (dist > 0) { this.aimX = ax / dist; this.aimY = ay / dist; }
        }
        if (this.fireTimer > 0) this.fireTimer--;
        if (this.invincibleTimer > 0) this.invincibleTimer--;

        if (input.mouseDown && this.fireTimer <= 0 && this.reloadTimer <= 0 && this.ammo > 0) {
            this.fireTimer = this.fireRate;
            this.ammo--;
            if (this.ammo <= 0) this.startReload();
            return true;
        }
        return false;
    }

    shoot() {
        if (this.weaponKind === 'summoner') return [];
        const bullets = [];
        const count = this.weaponKind === 'shotgun'
            ? this.pelletCount + Math.max(0, this.bulletCount - 1)
            : this.bulletCount;
        const baseAngle = Math.atan2(this.aimY, this.aimX);
        for (let i = 0; i < count; i++) {
            let angle = baseAngle;
            if (this.weaponKind === 'shotgun') {
                angle += (i - (count - 1) / 2) * (this.spread / Math.max(1, count - 1));
            } else if (this.weaponKind === 'turret') {
                angle += (Math.random() - 0.5) * this.spread;
            } else if (count > 1) {
                angle += (i - (count - 1) / 2) * this.spread;
            }
            bullets.push({
                x: this.x + this.aimX * (this.radius + 5), y: this.y + this.aimY * (this.radius + 5),
                vx: Math.cos(angle) * this.bulletSpeed, vy: Math.sin(angle) * this.bulletSpeed,
                damage: this.damage, pierce: this.bulletPierce, hits: 0,
                radius: this.weaponKind === 'turret' || this.character === 'tirador' ? 3 : 4,
                color: this.color, range: this.range, travelled: 0,
                burn: this.burn ? { ...this.burn } : null
            });
        }
        return bullets;
    }

    draw(ctx) {
        if (this.invincibleTimer > 0 && Math.floor(this.invincibleTimer / 3) % 2 === 0) return;
        const size = 24 * (this.visualScale || 1);
        const px = this.renderX ?? this.x, py = this.renderY ?? this.y;
        const sprite = Player.spriteFor(this.character);
        const spriteReady = sprite && sprite.complete && sprite.naturalWidth > 0;
        if (spriteReady) {
            // Stickers are authored at the role's final size (24, 32 or 40 px)
            // and already include their outline. Draw them 1:1 on the pixel
            // grid so the art stays crisp and keeps the established footprint.
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(sprite, snap(px - size / 2), snap(py - size / 2), Math.round(size), Math.round(size));
        } else {
            pixelRect(ctx, px, py, size + 4, size + 4, PALETTE.void);
            pixelRect(ctx, px, py, size, size, this.color || PALETTE.player);
            pixelRect(ctx, px, py, size * 0.52, size * 0.52, PALETTE.bone);
        }
        pixelRect(ctx, px + this.aimX * (size / 2 + 5), py + this.aimY * (size / 2 + 5), Math.max(5, size * 0.22), Math.max(5, size * 0.22), this.color || PALETTE.playerCore);
        if (this.turretActive) pixelRect(ctx, px, py - size * 0.65, size * 0.75, 3, this.color);
        if (this.reloadTimer > 0) {
            const badgeY = py - size * 0.72 - 10;
            ctx.save();
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = '#10100d';
            ctx.fillRect(px - 7, badgeY - 7, 14, 14);
            ctx.strokeStyle = '#d8cf9b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, badgeY, 4.5, -Math.PI * 0.78, Math.PI * 0.9);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px + 3, badgeY - 4);
            ctx.lineTo(px + 5, badgeY - 4);
            ctx.lineTo(px + 5, badgeY - 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    getStatsString() {
        return `${this.character.toUpperCase()} | DMG: ${this.damage} | SPD: ${this.speed.toFixed(1)}`;
    }
}

// Start fetching the role stickers during page load instead of on first draw.
Player.loadSprites();