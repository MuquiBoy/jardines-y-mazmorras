/**
 * Player class — handles movement, shooting, stats, and leveling.
 */
class Player {
    /**
     * Per-level growth of the XP requirement once the authored table runs out.
     * Softer than the table's own late ratio (≈1.30), which compounds too hard
     * for an endless run — the requirement has to stay reachable against XP
     * income that only grows about 10% per floor.
     */
    static XP_GROWTH = 1.20;

    constructor(x, y) {
        // Position
        this.x = x;
        this.y = y;
        this.radius = 12;

        // Stats
        this.maxHealth = 100;
        this.health = 100;
        this.speed = 4.5;
        this.damage = 10;
        this.fireRate = 12;          // frames between shots
        this.bulletSpeed = 7;
        this.bulletCount = 1;        // multi-shot count
        this.bulletPierce = 0;
        this.magnetRange = 100;

        // Level / XP
        this.level = 1;
        this.xp = 0;
        this.xpTable = [50, 120, 220, 350, 520, 750, 1050, 1400, 1850, 2400];

        // Cooldowns
        this.fireTimer = 0;
        this.invincibleTimer = 0;

        // Aim direction (unit vector)
        this.aimX = 0;
        this.aimY = -1;

        // Angle for spiral enemies (not used by player, but kept for reference)
        this.angle = 0;
        this.character = 'aji';
    }

    setCharacter(characterId) {
        const role = CHARACTER_ROLES[characterId] || CHARACTER_ROLES.aji;
        role.apply(this);
        return role;
    }

    /**
     * XP needed to reach the next level.
     *
     * The hand-authored table covers the early curve; past it the requirement
     * keeps growing geometrically at roughly the table's own rate, so there is
     * no level cap. That matters because enemy scaling never stops either —
     * capping the player while the floors keep getting harder guarantees every
     * long run ends in a wall the player cannot build against.
     *
     * The old guard also read `level >= xpTable.length`, which capped at 10 and
     * meant the final table entry was never used.
     */
    xpToNext() {
        const i = this.level - 1;
        if (i < this.xpTable.length) return this.xpTable[i];

        const last = this.xpTable[this.xpTable.length - 1];
        const beyond = i - this.xpTable.length + 1;
        return Math.round(last * Math.pow(Player.XP_GROWTH, beyond));
    }

    /** Gain XP and return true if leveled up. */
    gainXP(amount) {
        this.xp += amount;
        const needed = this.xpToNext();
        if (needed > 0 && this.xp >= needed) {
            this.xp -= needed;
            this.level++;
            return true;
        }
        return false;
    }

    /** Take damage with invincibility frames. */
    takeDamage(amount) {
        if (this.invincibleTimer > 0) return;
        this.health = Math.max(0, this.health - amount);
        this.invincibleTimer = 30; // 0.5 seconds at 60fps
    }

    /** Heal to full. */
    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    /** Update player position and shooting. */
    update(input, camera, map) {
        // Movement — an analogue stick wins if it is deflected, otherwise keys.
        let dx = 0, dy = 0;
        if (input.moveX || input.moveY) {
            dx = input.moveX;
            dy = input.moveY;
            // A stick is already a vector; clamp rather than normalise so
            // partial deflection stays a partial walk.
            const mag = Math.hypot(dx, dy);
            if (mag > 1) { dx /= mag; dy /= mag; }
        } else {
            if (input.keys['KeyW'] || input.keys['ArrowUp'])    dy -= 1;
            if (input.keys['KeyS'] || input.keys['ArrowDown'])  dy += 1;
            if (input.keys['KeyA'] || input.keys['ArrowLeft'])  dx -= 1;
            if (input.keys['KeyD'] || input.keys['ArrowRight']) dx += 1;

            // Normalize diagonal
            if (dx !== 0 && dy !== 0) {
                const inv = 1 / Math.SQRT2;
                dx *= inv;
                dy *= inv;
            }
        }

        // Resolve each axis separately so that running into a wall diagonally
        // slides along it instead of stopping dead.
        if (map) {
            const nx = this.x + dx * this.speed;
            if (map.canOccupy(nx, this.y, this.radius)) this.x = nx;

            const ny = this.y + dy * this.speed;
            if (map.canOccupy(this.x, ny, this.radius)) this.y = ny;

            // Bounds clamp is now a backstop; walls do the real work.
            this.x = Math.max(this.radius, Math.min(this.x, map.width - this.radius));
            this.y = Math.max(this.radius, Math.min(this.y, map.height - this.radius));
        } else {
            this.x += dx * this.speed;
            this.y += dy * this.speed;
        }

        // Aim direction. A touch stick supplies a direction outright; the
        // mouse supplies a screen point that has to be converted to world space.
        if (input.aimActive) {
            this.aimX = input.aimX;
            this.aimY = input.aimY;
        } else if (input.mouseX !== undefined) {
            const worldMouseX = camera ? camera.x + input.mouseX : input.mouseX;
            const worldMouseY = camera ? camera.y + input.mouseY : input.mouseY;
            const adx = worldMouseX - this.x;
            const ady = worldMouseY - this.y;
            const dist = Math.sqrt(adx * adx + ady * ady);
            if (dist > 0) {
                this.aimX = adx / dist;
                this.aimY = ady / dist;
            }
        }

        // Shooting cooldown
        if (this.fireTimer > 0) this.fireTimer--;
        if (this.invincibleTimer > 0) this.invincibleTimer--;

        // Auto-fire on click
        if (input.mouseDown && this.fireTimer <= 0) {
            this.fireTimer = this.fireRate;
            return true; // signal to shoot
        }
        return false;
    }

    /** Shoot bullets in aimed direction with spread. */
    shoot() {
        const bullets = [];
        const count = this.bulletCount;
        const spreadAngle = 0.15; // radians total spread

        for (let i = 0; i < count; i++) {
            let angle;
            if (count === 1) {
                angle = Math.atan2(this.aimY, this.aimX);
            } else {
                const centerAngle = Math.atan2(this.aimY, this.aimX);
                const halfSpread = ((count - 1) / 2) * spreadAngle;
                angle = centerAngle - halfSpread + i * spreadAngle;
            }

            bullets.push({
                x: this.x + this.aimX * (this.radius + 4),
                y: this.y + this.aimY * (this.radius + 4),
                vx: Math.cos(angle) * this.bulletSpeed,
                vy: Math.sin(angle) * this.bulletSpeed,
                damage: this.damage,
                pierce: this.bulletPierce,
                hits: 0,
                radius: 4,
                color: '#4fc3f7'
            });
        }
        return bullets;
    }

    /** Draw the player. */
    draw(ctx) {
        // Invincibility blink — skip whole frames rather than fading, which is
        // both more readable and more in keeping with the era.
        if (this.invincibleTimer > 0 && Math.floor(this.invincibleTimer / 3) % 2 === 0) {
            return;
        }

        const r = this.radius;
        const px = this.renderX ?? this.x;
        const py = this.renderY ?? this.y;
        const accents = { aji: '#ef632b', invocador: '#a66ad4', carguero: '#70ad55', gunslinger: '#d8b54b' };
        const core = accents[this.character] || PALETTE.playerCore;

        // Aim indicator first, so the body sits on top of it
        const ax = px + this.aimX * (r + 12);
        const ay = py + this.aimY * (r + 12);
        pixelRect(ctx, ax, ay, 6, 6, PALETTE.playerAim);

        // Body: dark outline, bone plate, amber core
        pixelRect(ctx, px, py, r * 2 + 4, r * 2 + 4, PALETTE.void);
        pixelRect(ctx, px, py, r * 2, r * 2, PALETTE.player);
        pixelRect(ctx, px, py, r, r, core);

        // Muzzle stub pointing where shots will go
        pixelRect(ctx, px + this.aimX * r, py + this.aimY * r, 7, 7, core);
    }

    /** Get current stat display string. */
    getStatsString() {
        return `DMG: ${this.damage} | SPD: ${this.speed.toFixed(1)} | BULLETS: ${this.bulletCount}`;
    }
}
