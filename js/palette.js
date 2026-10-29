/**
 * Visual identity — palette and pixel-grid constants.
 *
 * The look is "loose modern retro": a chunky pixel grid and a tight, grimy
 * palette, but without the hard constraints of a real 8-bit target (no fixed
 * colour count, no sprite/tile limits). Colours lean on DOOM's register —
 * rust and dried blood for the world, hot amber and fire for anything that
 * demands attention, sickly green for pickups.
 */

/**
 * Internal render scale: one world pixel maps to one canvas pixel.
 *
 * The canvas backing store is the window divided by this, then upscaled with
 * smoothing disabled, so everything lands on a visible grid. It also settles
 * the HiDPI question: integer upscaling is what a pixel look wants, where a
 * devicePixelRatio-smoothed canvas would fight it.
 */
const PIXEL_SIZE = 1;
const AIM_POINTER_MIN_DISTANCE = 40;
const AIM_POINTER_MAX_DISTANCE = 120;
const AIM_POINTER_DEFAULT_DISTANCE = 80;

/**
 * Pixel-perfect camera scales: both the fixed view and Tirador aim use
 * whole-number zoom factors, so each authored pixel stays a uniform square.
 */
const CAMERA_ZOOM = 3.0;
const TIRADOR_AIM_ZOOM = 2.0;

const PALETTE = {
    // World
    void:        '#07050a',  // outside the level
    floorDark:   '#2a211d',
    floorLight:  '#372a24',
    floorGrime:  '#1b1513',
    wall:        '#5c4638',
    wallLit:     '#8a6a52',
    corridor:    '#2a211d',  // same as floorDark; see DungeonMap.fillFloor()

    // Player
    player:      '#e8dcc8',  // bone
    playerCore:  '#ffb000',  // amber
    playerAim:   '#a01c1c',

    // Enemies
    chaser:      '#a01c1c',  // dried blood
    chaserLit:   '#e03b1e',
    moscaTirador:     '#7a3f8f',  // bruise
    moscaTiradorLit:  '#b45fd0',
    spiral:      '#c06010',  // ember
    spiralLit:   '#ffb000',
    boss:        '#5e0d0d',
    bossLit:     '#e03b1e',

    // Projectiles
    playerShot:  '#ffd23c',
    enemyShot:   '#ff5a1f',

    // Pickups / UI
    xp:          '#7fbf3f',  // sickly green
    xpGlow:      '#4a7a20',
    exit:        '#4ade5a',
    hud:         '#ffb000',
    hudDim:      '#7a4a00',
    bone:        '#d8cfc0',
    danger:      '#e03b1e',
    blood:       '#6b0f0f'
};

/** Snap a world coordinate to the pixel grid so nothing renders half-lit. */
function snap(v) {
    return Math.floor(v);
}

/**
 * Align a followed sprite to one exact canvas pixel while scrolling the world.
 * Camera translation is quantized to the output pixel grid (1 / scale world
 * units), and derived from the very same snapped sprite edge used by draw().
 * This avoids alternating floor/round offsets at fractional movement speeds.
 */
function cameraOffsetForPixelAnchor(center, viewportPixels, spriteSize, scale) {
    const spriteLeft = snap(center - spriteSize / 2);
    const screenLeft = Math.round((viewportPixels - spriteSize * scale) / 2);
    return spriteLeft - screenLeft / scale;
}

/** Keep a world-space aim marker anchored to the exact snapped player sprite. */
function aimPointerPosition(centerX, centerY, spriteSize, aimX, aimY, distance) {
    const renderedSize = Math.round(spriteSize);
    const anchorX = snap(centerX - spriteSize / 2) + renderedSize / 2;
    const anchorY = snap(centerY - spriteSize / 2) + renderedSize / 2;
    const radius = clampAimPointerDistance(distance);
    const directionLength = Math.hypot(aimX, aimY);
    const directionX = directionLength > 0.001 ? aimX / directionLength : 0;
    const directionY = directionLength > 0.001 ? aimY / directionLength : -1;
    return { x: anchorX + directionX * radius, y: anchorY + directionY * radius };
}

function clampAimPointerDistance(distance) {
    const value = Number.isFinite(distance) ? distance : AIM_POINTER_DEFAULT_DISTANCE;
    return Math.max(AIM_POINTER_MIN_DISTANCE, Math.min(AIM_POINTER_MAX_DISTANCE, value));
}

function interpolateAimPointerDistance(from, to, alpha) {
    const t = Math.max(0, Math.min(1, alpha));
    return clampAimPointerDistance(from + (to - from) * t);
}

/** Interpolate aim vectors by their shortest angular path for network rendering. */
function interpolateDirection(fromX, fromY, toX, toY, alpha) {
    const fromAngle = Math.atan2(fromY, fromX);
    const toAngle = Math.atan2(toY, toX);
    const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
    const angle = fromAngle + delta * Math.max(0, Math.min(1, alpha));
    return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Draw a pixel-snapped rectangle centred on (x, y).
 * Circles at this resolution turn to mush, so entities are built from squares.
 */
function pixelRect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(snap(x - w / 2), snap(y - h / 2), Math.max(1, snap(w)), Math.max(1, snap(h)));
}

/** Pixel-snapped square outline, drawn as four fills so the grid stays exact. */
function pixelFrame(ctx, x, y, w, h, t, color) {
    ctx.fillStyle = color;
    const X = snap(x), Y = snap(y), W = snap(w), H = snap(h), T = Math.max(1, snap(t));
    ctx.fillRect(X, Y, W, T);
    ctx.fillRect(X, Y + H - T, W, T);
    ctx.fillRect(X, Y, T, H);
    ctx.fillRect(X + W - T, Y, T, H);
}
