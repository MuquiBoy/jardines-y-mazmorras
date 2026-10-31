/**
 * Cochinilla Esquinero — corner-mounted enemy with a tracking laser.
 *
 * Everything in this file is derived from the art in
 * 00-sprites/enemigos/1_mini-jefes/cochinilla_esquinero/:
 *
 * - The idle Aseprite animation and the charge/attack PNGs are all 120x120 px:
 *   exactly 3x3 cells of 40 px. They are never rescaled, only mirrored.
 * - cochinilla_esquinero_generacion en salas.aseprite (+ "salas 1..4.png")
 *   shows the body sitting ONE cell inside the corner of the template, i.e.
 *   on cells (1,1)-(3,3) of that corner quadrant, mirrored per corner so the
 *   face always looks into the room.
 * - cochinilla_esquinero_ejemplo punto de spawn.aseprite marks that same
 *   120x120 block in magenta (#FF00FF) on an authored room.
 * - cochinilla_esquinero_origen del ataque.aseprite places the laser origin
 *   at sprite-local (11, 11.5) — not at the sprite centre (60, 60) — and
 *   draws the beam leaving that point towards the interior of the room.
 *
 * anchor (placement), sprite (drawing) and emitter (laser origin) are kept
 * independent on purpose.
 */

/** Body size in world pixels: 3x3 cells of 40 px, as authored. */
const COCHINILLA_ESQUINERO_SIZE = 120;
const COCHINILLA_ESQUINERO_ART_ROOT = '00-sprites/enemigos/1_mini-jefes/cochinilla_esquinero/';
const COCHINILLA_ESQUINERO_ART_VERSION = 'cochinilla-three-phase-v1';

/** Laser origin inside the sprite, as an offset from the sprite centre. */
const COCHINILLA_ESQUINERO_EMITTER_X = -49;   // 11 - 60
const COCHINILLA_ESQUINERO_EMITTER_Y = -48.5; // 11.5 - 60

/**
 * Mirroring per corner. The authored pose is the top-left corner; every other
 * corner is a mirror of it, which keeps the face looking into the room and
 * puts the laser origin against the corner wall.
 */
const COCHINILLA_ESQUINERO_MIRROR = {
    'top-left': { x: 1, y: 1 },
    'top-right': { x: -1, y: 1 },
    'bottom-left': { x: 1, y: -1 },
    'bottom-right': { x: -1, y: -1 }
};

// Exact red-pixel runs from cochinilla_esquinero_hitbox.png. Precomputed here
// so the browser and authoritative server share one mask without PNG decoding
// during combat; transparent pixels never receive hits.
const COCHINILLA_ESQUINERO_HITBOX_ROWS =
    "0:0-119;1:0-117;2:0-114;3:0-112;4:0-110;5:0-109;6:0-108;7:0-107;8:0-107;9:0-106;10:0-106;11:0-105;12:0-105;13:" +
    "0-104;14:0-104;15:0-103;16:0-103;17:0-102;18:0-102;19:0-102;20:0-101;21:0-101;22:0-101;23:0-101;24:0-101;25:0-" +
    "102;26:0-36,38-102;27:0-35,39-102;28:0-35,40-102;29:0-35,41-103;30:0-36,42-103;31:0-37,43-103;32:0-37,44-103;3" +
    "3:0-38,45-103;34:0-39,46-103;35:0-40,47-104;36:0-40,48-104;37:0-41,49-104;38:0-42,50-105;39:0-42,51-105;40:0-4" +
    "3,52-105;41:0-44,53-105;42:0-45,54-105;43:0-45,55-106;44:0-46,56-106;45:0-47,58-106;46:0-47,59-106;47:0-47,61-" +
    "106;48:0-47,61-107;49:0-48,62-107;50:0-48,64-107;51:0-49,66-84,90-107;52:0-49,67-83,92-107;53:0-50,68-83,93-10" +
    "7;54:0-50,70-83,94-107;55:0-51,71-82,95-107;56:0-51,76-82,96-106;57:0-52,97-106;58:0-52,99-105;59:0-53,100-104" +
    ";60:0-53;61:0-54;62:0-54;63:0-54;64:0-55;65:0-56;66:0-56;67:0-57;68:0-57;69:0-57;70:0-58;71:0-58;72:0-58;73:0-" +
    "59;74:0-59;75:0-59;76:0-59;77:0-59;78:0-59;79:0-58;80:0-58;81:0-58;82:0-57;83:0-57;84:0-56;85:0-56;86:0-56;87:" +
    "0-55;88:0-55;89:0-54;90:0-54;91:0-54;92:0-53;93:0-52;94:0-50;95:0-47;96:0-46;97:0-46;98:0-45;99:0-45;100:0-44;" +
    "101:0-44;102:0-44;103:0-44;104:0-44;105:0-44;106:0-16,24-45;107:0-14,26-45;108:0-12,27-45;109:0-11,28-45;110:0" +
    "-10,29-46;111:0-9,30-46;112:0-8,31-46;113:0-6,32-46;114:0-2,33-46;115:0-1,34-46;116:0-1,35-46;117:0-1,36-45;11" +
    "8:0-0,37-44;119:0-0,38-43";

function createCochinillaHitboxMask(mirror) {
    const spans = [];
    for (const encodedRow of COCHINILLA_ESQUINERO_HITBOX_ROWS.split(';')) {
        const [rowText, rangesText] = encodedRow.split(':');
        const sourceRow = Number(rowText);
        for (const rangeText of rangesText.split(',')) {
            const [startText, endText] = rangeText.split('-');
            const start = Number(startText), end = Number(endText) + 1;
            spans.push(Object.freeze([
                mirror.y === 1 ? sourceRow : COCHINILLA_ESQUINERO_SIZE - 1 - sourceRow,
                mirror.x === 1 ? start : COCHINILLA_ESQUINERO_SIZE - end,
                mirror.x === 1 ? end : COCHINILLA_ESQUINERO_SIZE - start
            ]));
        }
    }
    return Object.freeze({
        width: COCHINILLA_ESQUINERO_SIZE,
        height: COCHINILLA_ESQUINERO_SIZE,
        originX: COCHINILLA_ESQUINERO_SIZE / 2,
        originY: COCHINILLA_ESQUINERO_SIZE / 2,
        spans: Object.freeze(spans)
    });
}

const COCHINILLA_ESQUINERO_HITBOX_MASKS = Object.freeze(Object.fromEntries(
    Object.entries(COCHINILLA_ESQUINERO_MIRROR).map(([corner, mirror]) =>
        [corner, createCochinillaHitboxMask(mirror)])
));

class CochinillaEsquinero extends Enemy {
    static artwork = null;
    static artworkPromise = null;

    /**
     * @param {number} x - world centre of the 3x3 spawn block
     * @param {number} y - world centre of the 3x3 spawn block
     * @param {object|null} room - room the enemy is bolted to
     * @param {string} corner - 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
     */
    constructor(x, y, room = null, corner = 'top-left') {
        super(x, y, 'cochinilla-esquinero');
        this.name = 'Cochinilla de esquina';
        this.health = this.maxHealth = 280;
        this.radius = 40;
        this.setMovementSpeedMultiplier(0);
        this.color = '#c9b7a3';
        this.xpValue = 0;

        this.room = room;
        this.corner = COCHINILLA_ESQUINERO_MIRROR[corner] ? corner : 'top-left';
        this.hitboxMask = COCHINILLA_ESQUINERO_HITBOX_MASKS[this.corner];

        // Immovable: the anchor is the centre of the 3x3 block and never moves.
        this.anchorX = x;
        this.anchorY = y;

        // The one-off entry second includes the room's 0.6 s spawn telegraph.
        // Every later cycle is exactly idle 5 s -> charge 5 s -> attack 7 s.
        this.phase = 'entry';
        this.entryFrames = 60;
        this.idleFrames = 300;
        this.chargeFrames = 300;
        this.attackFrames = 420;
        this.phaseTimer = this.entryFrames;

        // Beam geometry. The visual and the hitbox share beamEndX/beamEndY.
        this.beamWidth = 34;
        this.beamEndX = x;
        this.beamEndY = y;
        this.beamBlocked = false;
        this.targetId = null;
        this._chargeTarget = null;
        this.lockedBeamAngle = null;

        // Universal rule: a laser tick is 6 HP, applied on every simulation
        // tick the target is inside the beam.
        this.laserDamagePerTick = 6;

        CochinillaEsquinero.loadArtwork();
    }

    static loadArtwork() {
        if (CochinillaEsquinero.artwork) return CochinillaEsquinero.artwork;
        if (CochinillaEsquinero.artworkPromise) return CochinillaEsquinero.artworkPromise;
        if (typeof Image === 'undefined' || typeof decodeAsepriteAnimation !== 'function') return null;
        const version = '?v=' + COCHINILLA_ESQUINERO_ART_VERSION;
        const loadImage = filename => new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('No se pudo cargar ' + filename));
            image.src = COCHINILLA_ESQUINERO_ART_ROOT + filename + version;
        });
        CochinillaEsquinero.artworkPromise = Promise.all([
            decodeAsepriteAnimation(COCHINILLA_ESQUINERO_ART_ROOT + 'cochinilla_esquinero_iddle.aseprite' + version),
            loadImage('cochinilla_esquinero_charge.png'),
            loadImage('cochinilla_esquinero_attack.png')
        ]).then(([idle, charge, attack]) => {
            if (!idle?.frames?.length || !charge?.naturalWidth || !attack?.naturalWidth) {
                throw new Error('Arte incompleto de Cochinilla Esquinero');
            }
            CochinillaEsquinero.artwork = { idle, charge, attack };
            return CochinillaEsquinero.artwork;
        }).catch(error => {
            CochinillaEsquinero.artworkPromise = null;
            console.warn('No se pudo cargar el arte de Cochinilla Esquinero.', error);
            return null;
        });
        return CochinillaEsquinero.artworkPromise;
    }

    // Keep the old loader name for existing startup callers.
    static loadSprite() { return CochinillaEsquinero.loadArtwork(); }

    /** The one-second arrival delay starts when the room is entered, not after its warning. */
    beginEncounter(warningFrames = 0) {
        if (this.phase !== 'entry') return;
        this.phaseTimer = Math.max(0, this.entryFrames - warningFrames);
        if (this.phaseTimer === 0) this._enterIdle();
    }

    /** No direct, projectile, summon, or burn damage outside the active laser. */
    takeDamage(amount) {
        if (!this.alive || this.phase !== 'attack') return;
        super.takeDamage(amount);
        if (!this.alive) {
            this.phase = 'dead';
            this.phaseTimer = 0;
            this._chargeTarget = null;
            this.targetId = null;
            this.lockedBeamAngle = null;
            this._clearBeam();
        }
    }

    /** Laser origin in world space: sprite-local (11, 11.5), mirrored per corner. */
    _emitter() {
        const mirror = COCHINILLA_ESQUINERO_MIRROR[this.corner] || COCHINILLA_ESQUINERO_MIRROR['top-left'];
        // The authored offset already points at the sprite's top-left, so the
        // mirror has to be applied to the offset (not to the anchor): that is
        // what puts the muzzle against the corner wall for all four corners.
        return {
            x: this.anchorX + COCHINILLA_ESQUINERO_EMITTER_X * mirror.x,
            y: this.anchorY + COCHINILLA_ESQUINERO_EMITTER_Y * mirror.y
        };
    }

    /** Only living players in this encounter are eligible; summons are not players. */
    _validPlayers(target, allTargets, map) {
        const candidates = Array.isArray(allTargets) ? allTargets : (target ? [target] : []);
        return candidates.filter(player => player && Number.isFinite(player.invincibleTimer) &&
            player.health > 0 && player.alive !== false &&
            (!this.room || !map || typeof map.pointInRoom !== 'function' ||
             map.pointInRoom(player.x, player.y) === this.room));
    }

    _enterIdle() {
        this.phase = 'idle';
        this.phaseTimer = this.idleFrames;
        this.targetId = null;
        this._chargeTarget = null;
        this.lockedBeamAngle = null;
        this._clearBeam();
    }

    _enterCharge(players, map) {
        this.phase = 'charge';
        this.phaseTimer = this.chargeFrames;
        this.lockedBeamAngle = null;
        this._clearBeam();
        const picked = players.length ? players[Math.floor(Math.random() * players.length)] : null;
        this._chargeTarget = picked;
        this.targetId = picked?.id ?? null;
        if (picked) this._aimAt(map, picked.x, picked.y);
    }

    _enterAttack() {
        const emitter = this._emitter();
        const dx = this.beamEndX - emitter.x;
        const dy = this.beamEndY - emitter.y;
        this.lockedBeamAngle = Math.hypot(dx, dy) >= 1 ? Math.atan2(dy, dx) : null;
        this.phase = 'attack';
        this.phaseTimer = this.attackFrames;
    }

    /**
     * Aim from the emitter at a world point and clamp the beam to the first
     * solid cell. Walls, template obstacles and closed doors all live in
     * map.isWalkable, so they stop the ray exactly where they stop bullets.
     */
    _aimAt(map, targetX, targetY) {
        const emitter = this._emitter();
        const dx = targetX - emitter.x;
        const dy = targetY - emitter.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) {
            this.beamEndX = emitter.x;
            this.beamEndY = emitter.y;
            this.beamBlocked = false;
            return;
        }
        const hit = this.raycastObstacle(map, emitter.x, emitter.y, dx / length, dy / length, 4000, 2);
        this.beamEndX = hit.x;
        this.beamEndY = hit.y;
        this.beamBlocked = hit.hit;
    }

    /** Park the beam on the emitter (invisible, no hitbox). */
    _clearBeam() {
        const emitter = this._emitter();
        this.beamEndX = emitter.x;
        this.beamEndY = emitter.y;
        this.beamBlocked = false;
    }

    update(target, enemies, map, allTargets = null) {
        if (!this.alive) return null;
        // Bolted to the corner: nothing can push it around.
        this.x = this.anchorX;
        this.y = this.anchorY;

        const players = this._validPlayers(target, allTargets, map);

        if (this.phase === 'entry') {
            if (--this.phaseTimer <= 0) {
                this._enterIdle();
            }
            return null;
        }

        if (this.phase === 'idle') {
            if (--this.phaseTimer <= 0) {
                this._enterCharge(players, map);
                return 'charge';
            }
            return null;
        }

        if (this.phase === 'charge') {
            // Track only the player picked at this charge's start. If they die or
            // leave, hold the last safe direction rather than jumping targets.
            if (this._chargeTarget && players.includes(this._chargeTarget)) {
                this._aimAt(map, this._chargeTarget.x, this._chargeTarget.y);
            } else {
                this._chargeTarget = null;
                this.targetId = null;
            }
            if (--this.phaseTimer <= 0) {
                this._enterAttack();
            }
            return null;
        }

        if (this.phase === 'attack') {
            // The endpoint and angle are locked for the entire damaging phase.
            if (--this.phaseTimer <= 0) {
                this._enterIdle();
            }
            return null;
        }

        return null;
    }

    /**
     * Damage owed to `target` on this simulation tick.
     *
     * A laser tick is 6 HP: every tick the target is inside the beam while the
     * laser is active, it takes exactly laserDamagePerTick. Zero in any other
     * phase and zero when the target is clear of the beam.
     */
    laserDamageFor(target) {
        if (!this.alive || this.phase !== 'attack' || !target) return 0;
        if (!this.touchesBeam(target)) return 0;
        return this.laserDamagePerTick;
    }

    /**
     * Capsule vs circle against the clamped beam. Uses the same two endpoints
     * as the drawing, so what the player sees is what can hit them.
     */
    touchesBeam(point) {
        if (!this.alive || this.phase !== 'attack' || !point) return false;
        const emitter = this._emitter();
        const dx = this.beamEndX - emitter.x;
        const dy = this.beamEndY - emitter.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) return false;
        if (point.hitboxMask && typeof segmentIntersectsPixelHitbox === 'function') {
            return segmentIntersectsPixelHitbox(
                emitter.x, emitter.y, this.beamEndX, this.beamEndY,
                this.beamWidth / 2, point.x, point.y, point.hitboxMask
            );
        }
        const t = ((point.x - emitter.x) * dx + (point.y - emitter.y) * dy) / (length * length);
        if (t < 0 || t > 1) return false;
        const projectionX = emitter.x + dx * t;
        const projectionY = emitter.y + dy * t;
        const distance = Math.hypot(point.x - projectionX, point.y - projectionY);
        return distance <= this.beamWidth / 2 + (point.radius || 12);
    }

    draw(ctx) {
        const artwork = CochinillaEsquinero.artwork;
        if (!artwork) return;
        const emitter = this._emitter();
        if (this.phase === 'charge') {
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(emitter.x, emitter.y);
            ctx.lineTo(this.beamEndX, this.beamEndY);
            ctx.stroke();
            ctx.restore();
        } else if (this.phase === 'attack') {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ff402c';
            ctx.lineWidth = this.beamWidth;
            ctx.beginPath();
            ctx.moveTo(emitter.x, emitter.y);
            ctx.lineTo(this.beamEndX, this.beamEndY);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#ffd9c9';
            ctx.lineWidth = Math.max(2, this.beamWidth * 0.22);
            ctx.beginPath();
            ctx.moveTo(emitter.x, emitter.y);
            ctx.lineTo(this.beamEndX, this.beamEndY);
            ctx.stroke();
            ctx.restore();
        }

        const mirror = COCHINILLA_ESQUINERO_MIRROR[this.corner] || COCHINILLA_ESQUINERO_MIRROR['top-left'];
        const half = COCHINILLA_ESQUINERO_SIZE / 2;
        let sprite = artwork.idle.frames[0];
        if (this.phase === 'charge') sprite = artwork.charge;
        else if (this.phase === 'attack') sprite = artwork.attack;
        else if (this.phase === 'idle') {
            let elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) % artwork.idle.totalDuration;
            for (let i = 0; i < artwork.idle.frames.length; i++) {
                elapsed -= artwork.idle.durations[i];
                if (elapsed < 0) { sprite = artwork.idle.frames[i]; break; }
            }
        }
        ctx.save();
        ctx.translate(this.anchorX, this.anchorY);
        // Mirrors keep the face pointing into the room; the body is never
        // rotated or rescaled, so the pixel art stays crisp.
        ctx.scale(mirror.x, mirror.y);
        ctx.drawImage(sprite, -half, -half, COCHINILLA_ESQUINERO_SIZE, COCHINILLA_ESQUINERO_SIZE);
        ctx.restore();
        this.drawHealth(ctx, 88);
    }
}
