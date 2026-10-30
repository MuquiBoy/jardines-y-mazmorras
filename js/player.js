/** Player combat, movement, ammunition, and leveling. */
// One second at the authoritative 60 Hz simulation rate, shared by all damage sources.
const PLAYER_DAMAGE_INVULNERABILITY_FRAMES = 60;
const PLAYER_SPRITE_ROOT = '00-sprites/jugador/';
const PLAYER_SPRITE_VERSION = 'player-role-sprites-v1';

const PLAYER_WALK_VERSION = 'role-walk-v2-authored-timing';
const PLAYER_PISTOLERO_DIRECTION_VERSION = 'pistolero-directional-walk-v4';
const PLAYER_BASTION_FORM_VERSION = 'bastion-directional-forms-v2';
const PLAYER_DAMAGE_MASK_VERSION = 'player-role-damage-masks-v2';
const PLAYER_DAMAGE_FLASH_PHASE_FRAMES = 10;

/**
 * Decode simple RGBA Aseprite animations whose frames contain full-frame
 * compressed cels. Frame durations come directly from the Aseprite timeline.
 */
async function decodeAsepriteAnimation(url) {
    if (typeof fetch !== 'function' || typeof DecompressionStream === 'undefined' ||
        typeof document === 'undefined') return null;

    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    const data = new DataView(bytes);
    if (data.byteLength < 144 || data.getUint16(4, true) !== 0xA5E0 ||
        data.getUint16(12, true) !== 32) {
        throw new Error('Formato Aseprite RGBA no compatible');
    }

    const frameCount = data.getUint16(6, true);
    const width = data.getUint16(8, true);
    const height = data.getUint16(10, true);
    const frames = [];
    const durations = [];
    let frameOffset = 128;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        if (frameOffset + 16 > data.byteLength ||
            data.getUint16(frameOffset + 4, true) !== 0xF1FA) {
            throw new Error('Encabezado de fotograma Aseprite inválido');
        }

        const frameBytes = data.getUint32(frameOffset, true);
        const chunkCount = data.getUint16(frameOffset + 6, true);
        const duration = data.getUint16(frameOffset + 8, true) || 100;
        const frameEnd = frameOffset + frameBytes;
        if (frameEnd > data.byteLength || frameBytes < 16) {
            throw new Error('Fotograma Aseprite incompleto');
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        let chunkOffset = frameOffset + 16;

        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            if (chunkOffset + 6 > frameEnd) throw new Error('Bloque Aseprite incompleto');
            const chunkSize = data.getUint32(chunkOffset, true);
            const chunkType = data.getUint16(chunkOffset + 4, true);
            if (chunkSize < 6 || chunkOffset + chunkSize > frameEnd) {
                throw new Error('Tamaño de bloque Aseprite inválido');
            }

            const cel = chunkOffset + 6;
            if (chunkType === 0x2005 && chunkSize >= 26 && data.getUint16(cel + 7, true) === 2) {
                const x = data.getInt16(cel + 2, true);
                const y = data.getInt16(cel + 4, true);
                const opacity = data.getUint8(cel + 6);
                const celWidth = data.getUint16(cel + 16, true);
                const celHeight = data.getUint16(cel + 18, true);
                const compressedStart = cel + 20;
                const compressedEnd = chunkOffset + chunkSize;
                const compressed = new Uint8Array(bytes, compressedStart, compressedEnd - compressedStart);
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
                const rgba = new Uint8ClampedArray(await new Response(stream).arrayBuffer());
                if (rgba.length !== celWidth * celHeight * 4) {
                    throw new Error('Datos de píxel Aseprite incompletos');
                }
                if (opacity !== 255) {
                    for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * opacity / 255);
                }
                context.putImageData(new ImageData(rgba, celWidth, celHeight), x, y);
            }
            chunkOffset += chunkSize;
        }

        frames.push(canvas);
        durations.push(duration);
        frameOffset = frameEnd;
    }

    if (!frames.length) throw new Error('La animación Aseprite no contiene fotogramas');
    return { frames, durations, totalDuration: durations.reduce((sum, ms) => sum + ms, 0) };
}

/** Decode one authored Aseprite layer as a transparent canvas overlay. */
async function decodeAsepriteLayer(url, targetLayerName) {
    if (typeof fetch !== 'function' || typeof DecompressionStream === 'undefined' ||
        typeof document === 'undefined') return null;

    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    const data = new DataView(bytes);
    if (data.byteLength < 144 || data.getUint16(4, true) !== 0xA5E0 ||
        data.getUint16(12, true) !== 32) {
        throw new Error('Formato Aseprite RGBA no compatible');
    }

    const width = data.getUint16(8, true);
    const height = data.getUint16(10, true);
    const frameCount = data.getUint16(6, true);
    const layers = [];
    const overlay = document.createElement('canvas');
    overlay.width = width;
    overlay.height = height;
    const context = overlay.getContext('2d');
    let drewLayer = false;
    let frameOffset = 128;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const frameBytes = data.getUint32(frameOffset, true);
        const chunkCount = data.getUint16(frameOffset + 6, true);
        const frameEnd = frameOffset + frameBytes;
        if (frameEnd > data.byteLength || frameBytes < 16) {
            throw new Error('Fotograma Aseprite incompleto');
        }

        let chunkOffset = frameOffset + 16;
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            if (chunkOffset + 6 > frameEnd) throw new Error('Bloque Aseprite incompleto');
            const chunkSize = data.getUint32(chunkOffset, true);
            const chunkType = data.getUint16(chunkOffset + 4, true);
            if (chunkSize < 6 || chunkOffset + chunkSize > frameEnd) {
                throw new Error('Tamaño de bloque Aseprite inválido');
            }

            const chunk = chunkOffset + 6;
            if (chunkType === 0x2004 && chunkSize >= 24) {
                const nameLength = data.getUint16(chunk + 16, true);
                const nameEnd = chunk + 18 + nameLength;
                if (nameEnd <= chunkOffset + chunkSize) {
                    layers.push({
                        name: new TextDecoder().decode(new Uint8Array(bytes, chunk + 18, nameLength)),
                        visible: !!(data.getUint16(chunk, true) & 1),
                        opacity: data.getUint8(chunk + 12)
                    });
                } else {
                    layers.push(null);
                }
            } else if (chunkType === 0x2005 && chunkSize >= 26 &&
                data.getUint16(chunk + 7, true) === 2) {
                const layer = layers[data.getUint16(chunk, true)];
                if (layer?.name === targetLayerName && layer.visible) {
                    const x = data.getInt16(chunk + 2, true);
                    const y = data.getInt16(chunk + 4, true);
                    const celOpacity = data.getUint8(chunk + 6) / 255;
                    const celWidth = data.getUint16(chunk + 16, true);
                    const celHeight = data.getUint16(chunk + 18, true);
                    const compressedStart = chunk + 20;
                    const compressedEnd = chunkOffset + chunkSize;
                    const compressed = new Uint8Array(bytes, compressedStart, compressedEnd - compressedStart);
                    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
                    const rgba = new Uint8ClampedArray(await new Response(stream).arrayBuffer());
                    if (rgba.length !== celWidth * celHeight * 4) {
                        throw new Error('Datos de píxel Aseprite incompletos');
                    }
                    const opacity = celOpacity * (layer.opacity / 255);
                    if (opacity < 1) {
                        for (let i = 3; i < rgba.length; i += 4) {
                            rgba[i] = Math.round(rgba[i] * opacity);
                        }
                    }
                    context.putImageData(new ImageData(rgba, celWidth, celHeight), x, y);
                    drewLayer = true;
                }
            }
            chunkOffset += chunkSize;
        }
        frameOffset = frameEnd;
    }

    return drewLayer ? overlay : null;
}

class Player {
    static XP_GROWTH = 1.20;
    static sprites = null;
    static animations = Object.create(null);
    static animationPromises = Object.create(null);
    static damageMasks = Object.create(null);
    static damageMaskPromises = Object.create(null);

    /** Fetch all authored role loops once. Stickers remain visible as fallback. */
    static loadAnimations() {
        if (typeof fetch !== 'function' || typeof DecompressionStream === 'undefined' ||
            typeof document === 'undefined') return;
        for (const role of Object.values(CHARACTER_ROLES)) {
            const sources = role.id === 'bastion' ? [
                { key: 'bastion:back', filename: 'bastion_walk-back.aseprite', version: PLAYER_BASTION_FORM_VERSION },
                { key: 'bastion:front', filename: 'bastion_walk-front.aseprite', version: PLAYER_BASTION_FORM_VERSION }
            ] : [{
                key: role.id,
                name: role.sprite,
                version: PLAYER_WALK_VERSION
            }];
            if (role.id === 'pistolero') {
                sources.push(
                    { key: 'pistolero:back', filename: 'pistolero_walk-back.aseprite', version: PLAYER_PISTOLERO_DIRECTION_VERSION },
                    { key: 'pistolero:front', filename: 'pistolero_walk-front.aseprite', version: PLAYER_PISTOLERO_DIRECTION_VERSION }
                );
            }
            if (role.depletedSprite) {
                if (role.id === 'bastion') {
                    sources.push(
                        { key: 'bastion:debil:back', filename: 'bastion-debil_walk-back.aseprite', version: PLAYER_BASTION_FORM_VERSION },
                        { key: 'bastion:debil:front', filename: 'bastion-debil_walk-front.aseprite', version: PLAYER_BASTION_FORM_VERSION }
                    );
                } else {
                    sources.push({ key: role.id + ':debil', name: role.depletedSprite, version: PLAYER_WALK_VERSION });
                }
            }
            for (const source of sources) {
                if ((!source.name && !source.filename) || Player.animations[source.key] || Player.animationPromises[source.key]) continue;
                const filename = encodeURIComponent(source.filename || source.name + '_walk.aseprite');
                const url = PLAYER_SPRITE_ROOT + role.sprite + '/' + filename + '?v=' + source.version;
                Player.animationPromises[source.key] = decodeAsepriteAnimation(url)
                    .then(animation => { if (animation) Player.animations[source.key] = animation; })
                    .catch(error => {
                        delete Player.animationPromises[source.key];
                        console.warn('No se pudo cargar la animación ' + (source.name || source.filename) + '.', error);
                    });
            }
        }
    }

    /** Load optional role damage overlays from the named Aseprite layer. */
    static loadDamageMasks() {
        if (typeof fetch !== 'function' || typeof DecompressionStream === 'undefined' ||
            typeof document === 'undefined') return;
        for (const role of Object.values(CHARACTER_ROLES)) {
            if (!role.damageMask || Player.damageMasks[role.id] || Player.damageMaskPromises[role.id]) continue;
            const filename = encodeURIComponent(role.damageMask);
            const url = PLAYER_SPRITE_ROOT + role.id + '/' + filename + '?v=' + PLAYER_DAMAGE_MASK_VERSION;
            Player.damageMaskPromises[role.id] = decodeAsepriteLayer(url, role.damageMaskLayer || 'mask')
                .then(mask => { if (mask) Player.damageMasks[role.id] = mask; })
                .catch(error => {
                    delete Player.damageMaskPromises[role.id];
                    console.warn('No se pudo cargar la máscara de daño de ' + role.name + '.', error);
                });
        }
    }

    /** Select a frame by its authored Aseprite duration; looping never depends on movement. */
    static walkFrameFor(character, now = (typeof performance !== 'undefined' ? performance.now() : Date.now()), form = null, facing = null) {
        let animationKey = character;
        if (character === 'pistolero' && (facing === 'back' || facing === 'front')) {
            animationKey = 'pistolero:' + facing;
        } else if (character === 'bastion' && (facing === 'back' || facing === 'front')) {
            animationKey = form === 'bastion-debil'
                ? 'bastion:debil:' + facing
                : 'bastion:' + facing;
        }
        const animation = Player.animations[animationKey];
        if (!animation) return null;
        let time = now % animation.totalDuration;
        for (let i = 0; i < animation.frames.length; i++) {
            if (time < animation.durations[i]) return animation.frames[i];
            time -= animation.durations[i];
        }
        return animation.frames[0];
    }

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
            if (role.depletedSprite) {
                const depletedImage = new Image();
                depletedImage.src = `${PLAYER_SPRITE_ROOT}${role.sprite}/${encodeURIComponent(role.depletedSprite + '_sticker.png')}?v=${PLAYER_BASTION_FORM_VERSION}`;
                Player.sprites[`${role.id}:debil`] = depletedImage;
            }
        }
        return Player.sprites;
    }

    static spriteFor(character, form = null) {
        const sprites = Player.sprites || Player.loadSprites();
        if (!sprites) return null;
        const formKey = character === 'bastion' && form === 'bastion-debil' ? 'bastion:debil' : character;
        return sprites[formKey] || sprites[character] || null;
    }

    constructor(x, y) {
        Player.loadSprites();
        this.x = x; this.y = y; this.radius = 12; this.visualScale = 1;
        this.hitboxWidth = 0; this.hitboxHeight = 0; this.spriteWidth = 24; this.spriteHeight = 24;
        this.hitboxMask = null; this.depletedHitboxMask = null;
        this.maxHealth = 100; this.health = 100; this.maxGrayHealth = 0; this.grayHealth = 0;
        this.bastionForm = null; this.bastionTransformEvent = 0;
        this.speed = 2.25; this.damage = 10;
        this.fireRate = 12; this.bulletSpeed = 3.5; this.bulletCount = 1;
        this.bulletPierce = 0; this.magnetRange = 100;
        this.ammoCapacity = 15; this.ammo = 15; this.reloadFrames = 54; this.reloadTimer = 0;
        this.pelletCount = 1; this.spread = 0.03; this.range = 500;
        this.weaponKind = 'gun'; this.color = '#55d64b'; this.burn = null; this.summon = null;
        this.turretActive = false;
        this.level = 1; this.xp = 0;
        this.pendingLevelUps = 0;
        this.xpTable = [50, 120, 220, 350, 520, 750, 1050, 1400, 1850, 2400];
        this.fireTimer = 0; this.invincibleTimer = 0; this.sniperAiming = false;
        this.knockbackImpulse = null;
        this.aimX = 0; this.aimY = -1; this.angle = 0; this.character = 'pistolero';
        this.pistoleroFacing = 'front';
        this.bastionFacing = 'front';
    }

    cancelSniperAim() { this.sniperAiming = false; }

    canOccupyAt(map, x, y) {
        if (!map) return true;
        if (this.hitboxMask && typeof map.canOccupyPixelMask === 'function') {
            return map.canOccupyPixelMask(x, y, this.hitboxMask);
        }
        if (this.hitboxWidth > 0 && this.hitboxHeight > 0 && typeof map.canOccupyRect === 'function') {
            return map.canOccupyRect(x, y, this.hitboxWidth, this.hitboxHeight);
        }
        return map.canOccupy(x, y, this.radius);
    }

    overlapsCircleAt(x, y, circle) {
        const radius = Math.max(0, circle?.radius || 0);
        if (this.hitboxMask && typeof circleIntersectsPixelHitbox === 'function') {
            return circleIntersectsPixelHitbox(circle.x, circle.y, radius, x, y, this.hitboxMask);
        }
        if (this.hitboxWidth > 0 && this.hitboxHeight > 0) {
            const halfWidth = this.hitboxWidth / 2;
            const halfHeight = this.hitboxHeight / 2;
            const closestX = Math.max(x - halfWidth, Math.min(circle.x, x + halfWidth));
            const closestY = Math.max(y - halfHeight, Math.min(circle.y, y + halfHeight));
            const dx = circle.x - closestX;
            const dy = circle.y - closestY;
            return dx * dx + dy * dy < radius * radius;
        }
        const dx = circle.x - x, dy = circle.y - y;
        return dx * dx + dy * dy < (this.radius + radius) * (this.radius + radius);
    }

    setCharacter(characterId) {
        const role = CHARACTER_ROLES[characterId] || CHARACTER_ROLES.pistolero;
        role.apply(this);
        return role;
    }

    /** Keep Bastion's form and movement tied to the temporary gray heart. */
    updateBastionForm() {
        if (this.character !== 'bastion') return false;
        const previousForm = this.bastionForm;
        this.bastionForm = (this.grayHealth || 0) > 0
            ? 'calabaza-blindada'
            : 'bastion-debil';

        const role = CHARACTER_ROLES.bastion;
        const multiplier = this.bastionForm === 'bastion-debil'
            ? role.depletedMovementSpeed
            : role.movementSpeed;
        this.speed = movementSpeedFromMultiplier(multiplier);
        this.hitboxMask = this.bastionForm === 'bastion-debil'
            ? role.depletedHitboxMask
            : role.hitboxMask;
        return previousForm !== this.bastionForm;
    }

    /** Refill only Bastion's gray heart at the floor boundary; preserve red HP. */
    restoreGrayHeartForNextFloor() {
        if (this.character !== 'bastion') return false;
        const redHealth = this.permanentHealth;
        this.grayHealth = this.maxGrayHealth;
        this.health = redHealth + this.grayHealth;
        this.updateBastionForm();
        return true;
    }

    xpToNext() {
        const i = this.level - 1;
        if (i < this.xpTable.length) return this.xpTable[i];
        return Math.round(this.xpTable[this.xpTable.length - 1] * Math.pow(Player.XP_GROWTH, i - this.xpTable.length + 1));
    }

    gainXP(amount) {
        this.xp += amount;
        // A single orb can cross more than one threshold on deep floors.
        // Return the number of levels gained so both solo and co-op can queue
        // one upgrade choice per level instead of silently dropping the rest.
        let gained = 0;
        let needed = this.xpToNext();
        while (needed > 0 && this.xp >= needed) {
            this.xp -= needed;
            this.level++;
            gained++;
            needed = this.xpToNext();
        }
        return gained;
    }

    takeDamage(amount) {
        if (this.invincibleTimer > 0 || amount <= 0 || this.health <= 0) return;
        const damage = Math.max(0, amount);
        this.health = Math.max(0, this.health - damage);
        // Gray hearts are temporary: damage consumes them before red health.
        // They never regenerate through healing, upgrades, or revival.
        this.grayHealth = Math.max(0, (this.grayHealth || 0) - damage);
        if (this.character === 'bastion' && this.grayHealth <= 0 && this.updateBastionForm()) {
            this.bastionTransformEvent = (this.bastionTransformEvent || 0) + 1;
        }
        this.invincibleTimer = PLAYER_DAMAGE_INVULNERABILITY_FRAMES;
    }

    get permanentHealth() {
        return Math.max(0, this.health - (this.grayHealth || 0));
    }

    /** Apply an outward momentum impulse that normal movement cannot cancel. */
    applyKnockbackImpulse(directionX, directionY, sourceX, sourceY, separationGain = 80) {
        const magnitude = Math.hypot(directionX, directionY);
        if (magnitude < 0.001) return;
        const dx = directionX / magnitude;
        const dy = directionY / magnitude;
        const currentDistance = Math.hypot(this.x - sourceX, this.y - sourceY);
        this.knockbackImpulse = {
            sourceX,
            sourceY,
            startingDistance: currentDistance,
            targetDistance: currentDistance + Math.max(0, separationGain),
            fallbackDistance: currentDistance + Math.min(40, Math.max(0, separationGain)),
            fallbackApplied: false,
            directionX: dx,
            directionY: dy,
            frames: 0,
            travelled: 0
        };
    }

    heal(amount) {
        const grayHealth = this.grayHealth || 0;
        const restoredPermanentHealth = Math.min(this.maxHealth, this.permanentHealth + Math.max(0, amount));
        this.health = restoredPermanentHealth + grayHealth;
    }

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
            if (map && !this.canOccupyAt(map, x, y)) return false;
            for (const blocker of blockers) {
                if (!blocker || blocker.alive === false) continue;
                const currentX = this.x - blocker.x, currentY = this.y - blocker.y;
                const nextX = x - blocker.x, nextY = y - blocker.y;
                const currentDistanceSq = currentX * currentX + currentY * currentY;
                const nextDistanceSq = nextX * nextX + nextY * nextY;
                const overlapsCurrent = this.overlapsCircleAt(this.x, this.y, blocker);
                const overlapsNext = this.overlapsCircleAt(x, y, blocker);
                if (overlapsNext && !(overlapsCurrent && nextDistanceSq > currentDistanceSq)) return false;
            }
            return true;
        };
        const nx = this.x + dx * moveSpeed;
        if (canMoveTo(nx, this.y)) this.x = nx;
        const ny = this.y + dy * moveSpeed;
        if (canMoveTo(this.x, ny)) this.y = ny;
        if (map) {
            const halfWidth = this.hitboxWidth > 0 ? this.hitboxWidth / 2 : this.radius;
            const halfHeight = this.hitboxHeight > 0 ? this.hitboxHeight / 2 : this.radius;
            const bounds = this.hitboxMask?.bounds;
            const left = bounds?.left ?? halfWidth;
            const right = bounds?.right ?? halfWidth;
            const top = bounds?.top ?? halfHeight;
            const bottom = bounds?.bottom ?? halfHeight;
            this.x = Math.max(left, Math.min(this.x, map.width - right));
            this.y = Math.max(top, Math.min(this.y, map.height - bottom));
        }

        this.updateKnockbackImpulse(map, blockers);

        if (input.aimActive) { this.aimX = input.aimX; this.aimY = input.aimY; }
        else if (input.mouseX !== undefined) {
            const ax = (camera ? camera.x : 0) + input.mouseX - this.x;
            const ay = (camera ? camera.y : 0) + input.mouseY - this.y;
            const dist = Math.hypot(ax, ay);
            if (dist > 0) { this.aimX = ax / dist; this.aimY = ay / dist; }
        }
        if (this.fireTimer > 0) this.fireTimer--;
        if (this.invincibleTimer > 0) this.invincibleTimer--;

        if (this.character === 'tirador') {
            if (input.cancelAim || this.health <= 0 || this.reloadTimer > 0) this.sniperAiming = false;
            const pressed = !!input.mousePressed;
            const released = !!input.mouseReleased;
            if (pressed && !this.sniperAiming && this.fireTimer <= 0 && this.reloadTimer <= 0 && this.ammo > 0) {
                this.sniperAiming = true;
            }
            if (released && this.sniperAiming) {
                this.sniperAiming = false;
                if (this.fireTimer <= 0 && this.reloadTimer <= 0 && this.ammo > 0) {
                    this.fireTimer = this.fireRate;
                    this.ammo--;
                    if (this.ammo <= 0) this.startReload();
                    return true;
                }
            }
            return false;
        }
        this.sniperAiming = false;
        if (input.mouseDown && this.fireTimer <= 0 && this.reloadTimer <= 0 && this.ammo > 0) {
            this.fireTimer = this.fireRate;
            this.ammo--;
            if (this.ammo <= 0) this.startReload();
            return true;
        }
        return false;
    }

    /** Move the pending hit impulse after player input, redirecting around walls. */
    updateKnockbackImpulse(map, blockers = []) {
        const impulse = this.knockbackImpulse;
        if (!impulse) return;

        const sourceDx = this.x - impulse.sourceX;
        const sourceDy = this.y - impulse.sourceY;
        const distance = Math.hypot(sourceDx, sourceDy);
        if (distance >= impulse.targetDistance - 0.5) {
            this.knockbackImpulse = null;
            return;
        }
        if (impulse.frames >= 30 || impulse.travelled >= 220) {
            if (!impulse.fallbackApplied && distance < impulse.fallbackDistance - 0.5) {
                // A tight room may make the full two-tile displacement
                // impossible. Keep the same outward/collision-safe behavior
                // with a one-tile minimum separation gain instead.
                impulse.targetDistance = impulse.fallbackDistance;
                impulse.fallbackApplied = true;
                impulse.frames = 0;
                impulse.travelled = 0;
            } else {
                this.knockbackImpulse = null;
                return;
            }
        }

        const outwardX = distance > 0.001 ? sourceDx / distance : impulse.directionX;
        const outwardY = distance > 0.001 ? sourceDy / distance : impulse.directionY;
        const step = Math.min(12, Math.max(3, (impulse.targetDistance - distance) * 0.28));
        const canStepTo = (x, y) => {
            if (map && !this.canOccupyAt(map, x, y)) return false;
            for (const blocker of blockers) {
                if (!blocker || blocker.alive === false) continue;
                const currentDistance = Math.hypot(this.x - blocker.x, this.y - blocker.y);
                const nextDistance = Math.hypot(x - blocker.x, y - blocker.y);
                const overlapsCurrent = this.overlapsCircleAt(this.x, this.y, blocker);
                const overlapsNext = this.overlapsCircleAt(x, y, blocker);
                if (overlapsNext && !(overlapsCurrent && nextDistance > currentDistance)) return false;
            }
            return true;
        };

        // Try the outward direction first. If a wall blocks it, sweep the
        // outward half-plane and take the step that increases separation most.
        // This gives the impulse a visible slide/bounce around corners.
        let best = null;
        let bestScore = -Infinity;
        for (let offset = -Math.PI / 2; offset <= Math.PI / 2 + 0.001; offset += Math.PI / 24) {
            const angle = Math.atan2(outwardY, outwardX) + offset;
            const dx = Math.cos(angle), dy = Math.sin(angle);
            const nextX = this.x + dx * step;
            const nextY = this.y + dy * step;
            if (!canStepTo(nextX, nextY)) continue;
            const nextDistance = Math.hypot(nextX - impulse.sourceX, nextY - impulse.sourceY);
            const radialGain = nextDistance - distance;
            const alignment = dx * outwardX + dy * outwardY;
            const score = radialGain * 100 + alignment;
            if (score > bestScore) {
                bestScore = score;
                best = { x: nextX, y: nextY, dx, dy };
            }
        }

        if (!best || bestScore < -0.01) {
            // No safe outward step exists in this geometry; do not tunnel or
            // force the player through a wall. If the player is pinned with no
            // outward route, even the shorter fallback cannot be achieved.
            this.knockbackImpulse = null;
            return;
        }

        this.x = best.x;
        this.y = best.y;
        impulse.directionX = best.dx;
        impulse.directionY = best.dy;
        impulse.travelled += step;
        impulse.frames++;
    }

    shoot() {
        if (this.weaponKind === 'summoner') return [];
        const bullets = [];
        const count = this.character === 'tirador' ? 1 : this.weaponKind === 'shotgun'
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

    draw(ctx, aimPointer = null, aimPointerState = null) {
        const visualScale = this.visualScale || 1;
        const size = 24 * visualScale;
        const px = this.renderX ?? this.x, py = this.renderY ?? this.y;
        const directionX = aimPointerState?.x ?? this.renderAimX ?? this.aimX;
        const directionY = aimPointerState?.y ?? this.renderAimY ?? this.aimY;
        const distance = aimPointerState?.distance ?? this.renderAimPointerDistance ?? AIM_POINTER_DEFAULT_DISTANCE;
        const pointerPosition = aimPointerPosition(px, py, size, directionX, directionY, distance);
        const pointerX = pointerPosition.x;
        const pointerY = pointerPosition.y;
        if (this.character === 'pistolero') {
            if (!this.pistoleroFacing) this.pistoleroFacing = 'front';
            // Preserve the last vertical facing when the pointer is level with the sprite center.
            if (pointerY <= py - 1) this.pistoleroFacing = 'back';
            else if (pointerY >= py + 1) this.pistoleroFacing = 'front';
        }
        else if (this.character === 'bastion') {
            if (!this.bastionFacing) this.bastionFacing = 'front';
            // Both forms preserve the last orientation within the center dead zone.
            if (pointerY <= py - 1) this.bastionFacing = 'back';
            else if (pointerY >= py + 1) this.bastionFacing = 'front';
        }
        const invulnerable = this.invincibleTimer > 0;
        const elapsedInvulnerability = PLAYER_DAMAGE_INVULNERABILITY_FRAMES - this.invincibleTimer;
        const redFlash = invulnerable &&
            Math.floor(elapsedInvulnerability / PLAYER_DAMAGE_FLASH_PHASE_FRAMES) % 2 === 0;
        const facing = this.character === 'bastion' ? this.bastionFacing : this.pistoleroFacing;
        const walkFrame = Player.walkFrameFor(this.character, undefined, this.bastionForm, facing);
        const sprite = Player.spriteFor(this.character, this.bastionForm);
        const spriteReady = sprite && sprite.complete && sprite.naturalWidth > 0;
        const sourceWidth = walkFrame?.width || (spriteReady ? sprite.naturalWidth : this.spriteWidth || 24);
        const sourceHeight = walkFrame?.height || (spriteReady ? sprite.naturalHeight : this.spriteHeight || 24);
        const renderWidth = this.character === 'pistolero' ? Math.round(sourceWidth * visualScale) : Math.round(size);
        const renderHeight = this.character === 'pistolero' ? Math.round(sourceHeight * visualScale) : Math.round(size);
        const spriteLeft = snap(px - renderWidth / 2);
        const spriteTop = snap(py - renderHeight / 2);
        const damageMask = redFlash ? Player.damageMasks[this.character] : null;

        ctx.save();
        if (invulnerable) ctx.globalAlpha = redFlash ? 0.88 : 0.96;
        ctx.save();
        if (redFlash && !damageMask) ctx.filter = 'sepia(1) saturate(5) hue-rotate(315deg)';
        if (walkFrame || spriteReady) {
            // Preserve each authored frame's dimensions with nearest-neighbor scaling.
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(walkFrame || sprite, spriteLeft, spriteTop, renderWidth, renderHeight);
        } else {
            pixelRect(ctx, px, py, renderWidth + 4, renderHeight + 4, PALETTE.void);
            pixelRect(ctx, px, py, renderWidth, renderHeight, this.color || PALETTE.player);
            pixelRect(ctx, px, py, renderWidth * 0.52, renderHeight * 0.52, PALETTE.bone);
        }
        if (damageMask) {
            // source-atop clips the authored red overlay to the current walk
            // frame's alpha, so transparent pixels stay completely invisible.
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-atop';
            ctx.drawImage(damageMask, spriteLeft, spriteTop, renderWidth, renderHeight);
        }
        ctx.restore();
        if (aimPointer?.complete && aimPointer.naturalWidth > 0) {
            const pointerWidth = aimPointer.naturalWidth;
            const pointerHeight = aimPointer.naturalHeight;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(aimPointer,
                snap(pointerX - pointerWidth / 2), snap(pointerY - pointerHeight / 2),
                pointerWidth, pointerHeight);
            ctx.restore();
        } else {
            // Keep aiming visible if the image is still loading or unavailable.
            pixelRect(ctx, pointerX, pointerY, Math.max(5, size * 0.22), Math.max(5, size * 0.22), this.color || PALETTE.playerCore);
        }
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
        ctx.restore();
    }

    getStatsString() {
        return `${this.character.toUpperCase()} | DMG: ${this.damage} | SPD: ${this.speed.toFixed(1)}`;
    }
}

// Start fetching role artwork during page load instead of on first draw.
Player.loadSprites();
Player.loadAnimations();
Player.loadDamageMasks();
