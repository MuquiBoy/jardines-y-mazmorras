/**
 * Cochinilla Esquinero — corner-mounted enemy with a tracking laser.
 *
 * Everything in this file is derived from the art in
 * 00-sprites/enemigos/cochinilla_esquinero/:
 *
 * - cochinilla_esquinero.png (120x120 px) is the body: exactly 3x3 cells of
 *   40 px. It is never rescaled, only mirrored.
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

class CochinillaEsquinero extends Enemy {
    static sprite = null;

    /**
     * @param {number} x - world centre of the 3x3 spawn block
     * @param {number} y - world centre of the 3x3 spawn block
     * @param {object|null} room - room the enemy is bolted to
     * @param {string} corner - 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
     */
    constructor(x, y, room = null, corner = 'top-left') {
        super(x, y, 'cochinilla-esquinero');
        this.name = 'Cochinilla de esquina';
        this.health = this.maxHealth = 100;
        this.radius = 40;
        this.speed = 0;
        this.color = '#c9b7a3';
        this.xpValue = 0;

        this.room = room;
        this.corner = COCHINILLA_ESQUINERO_MIRROR[corner] ? corner : 'top-left';

        // Immovable: the anchor is the centre of the 3x3 block and never moves.
        this.anchorX = x;
        this.anchorY = y;

        // State machine: wait -> warning (0.90 s) -> active (5 s) -> cooldown (5 s).
        this.phase = 'wait';
        this.waitFrames = 120;
        this.warningFrames = 54;   // 0.90 s at the fixed 60 Hz step
        this.activeFrames = 300;   // 5 s
        this.cooldownFrames = 300; // 5 s
        this.phaseTimer = this.waitFrames;

        // Beam geometry. The visual and the hitbox share beamEndX/beamEndY.
        this.beamWidth = 34;
        this.beamEndX = x;
        this.beamEndY = y;
        this.beamBlocked = false;
        this.targetId = null;

        // Universal rule: a laser tick is 6 HP, applied on every simulation
        // tick the target is inside the beam.
        this.laserDamagePerTick = 6;

        this.loadSprite();
    }

    loadSprite() {
        if (CochinillaEsquinero.sprite || typeof Image === 'undefined') return;
        const image = new Image();
        image.src = '00-sprites/enemigos/cochinilla_esquinero/cochinilla_esquinero.png';
        CochinillaEsquinero.sprite = image;
    }

    /** Only the active beam exposes the body. Wait, warning and cooldown are immune. */
    isVulnerable() {
        return this.alive && this.phase === 'active';
    }

    /**
     * Persistent damage (burn ticks, bullets) only lands during the active
     * beam. Everything else is rejected before touching health.
     */
    takeDamage(amount) {
        if (!this.isVulnerable()) return false;
        super.takeDamage(amount);
        if (!this.alive) {
            this.phase = 'dead';
            this.phaseTimer = 0;
            this._clearBeam();
        }
        return true;
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

    /** Nearest living target, or the current one while it is still valid. */
    _selectTarget(targets) {
        if (!targets || !targets.length) return null;
        if (this.targetId !== null) {
            const current = targets.find(t => t && (t.id === this.targetId || t === this.targetId));
            if (current) return current;
            this.targetId = null;
        }
        let best = null;
        let bestDist = Infinity;
        for (const target of targets) {
            if (!target || target.health <= 0 || target.alive === false) continue;
            const dist = Math.hypot((target.x || 0) - this.anchorX, (target.y || 0) - this.anchorY);
            if (dist < bestDist) { bestDist = dist; best = target; }
        }
        if (best) this.targetId = best.id !== undefined ? best.id : best;
        return best;
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

        const list = Array.isArray(allTargets) ? allTargets : (target ? [target] : []);
        const targets = list.filter(t => t && t.health > 0 && t.alive !== false);

        if (this.phase === 'wait') {
            this._clearBeam();
            if (--this.phaseTimer <= 0) {
                this.phase = 'warning';
                this.phaseTimer = this.warningFrames;
                // The warning locks a direction; it does not track.
                const picked = this._selectTarget(targets);
                if (picked) this._aimAt(map, picked.x || 0, picked.y || 0);
                else this._clearBeam();
                return 'warning';
            }
            return null;
        }

        if (this.phase === 'warning') {
            // Fixed white line, still no damage.
            if (--this.phaseTimer <= 0) {
                this.phase = 'active';
                this.phaseTimer = this.activeFrames;
            }
            return null;
        }

        if (this.phase === 'active') {
            // Retarget every frame: the beam follows the player's live position.
            const picked = this._selectTarget(targets);
            if (picked) this._aimAt(map, picked.x || 0, picked.y || 0);
            else this._clearBeam();
            if (--this.phaseTimer <= 0) {
                this.phase = 'cooldown';
                this.phaseTimer = this.cooldownFrames;
                this._clearBeam();
            }
            return null;
        }

        if (this.phase === 'cooldown') {
            this._clearBeam();
            if (--this.phaseTimer <= 0) {
                this.phase = 'wait';
                this.phaseTimer = this.waitFrames;
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
        if (!this.alive || this.phase !== 'active' || !target) return 0;
        if (!this.touchesBeam(target)) return 0;
        return this.laserDamagePerTick;
    }

    /**
     * Capsule vs circle against the clamped beam. Uses the same two endpoints
     * as the drawing, so what the player sees is what can hit them.
     */
    touchesBeam(point) {
        if (!this.alive || this.phase !== 'active' || !point) return false;
        const emitter = this._emitter();
        const dx = this.beamEndX - emitter.x;
        const dy = this.beamEndY - emitter.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) return false;
        const t = ((point.x - emitter.x) * dx + (point.y - emitter.y) * dy) / (length * length);
        if (t < 0 || t > 1) return false;
        const projectionX = emitter.x + dx * t;
        const projectionY = emitter.y + dy * t;
        const distance = Math.hypot(point.x - projectionX, point.y - projectionY);
        return distance <= this.beamWidth / 2 + (point.radius || 12);
    }

    draw(ctx) {
        const emitter = this._emitter();
        if (this.phase === 'warning') {
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(emitter.x, emitter.y);
            ctx.lineTo(this.beamEndX, this.beamEndY);
            ctx.stroke();
            ctx.restore();
        } else if (this.phase === 'active') {
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

        const sprite = CochinillaEsquinero.sprite;
        const mirror = COCHINILLA_ESQUINERO_MIRROR[this.corner] || COCHINILLA_ESQUINERO_MIRROR['top-left'];
        let drew = false;
        if (sprite && sprite.complete !== false && (sprite.naturalWidth || sprite.width)) {
            const half = COCHINILLA_ESQUINERO_SIZE / 2;
            ctx.save();
            ctx.translate(this.anchorX, this.anchorY);
            // Mirrors keep the face pointing into the room; the body is never
            // rotated or rescaled, so the pixel art stays crisp.
            ctx.scale(mirror.x, mirror.y);
            ctx.drawImage(sprite, -half, -half, COCHINILLA_ESQUINERO_SIZE, COCHINILLA_ESQUINERO_SIZE);
            ctx.restore();
            drew = true;
        }
        if (!drew) this.drawBody(ctx, '#7a6a58', '#c9b7a3', 80);
        this.drawHealth(ctx, 88);
    }
}
