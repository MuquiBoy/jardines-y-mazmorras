'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'js/palette.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/game.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/camera.js'), 'utf8'), context);
const snap = vm.runInContext('snap', context);
const cameraOffset = vm.runInContext('cameraOffsetForPixelAnchor', context);
const aimPointerPosition = vm.runInContext('aimPointerPosition', context);
const clampAimPointerDistance = vm.runInContext('clampAimPointerDistance', context);
const interpolateDirection = vm.runInContext('interpolateDirection', context);
const interpolateAimPointerDistance = vm.runInContext('interpolateAimPointerDistance', context);
const GamePrototype = vm.runInContext('Game.prototype', context);
const resolveSpectatorTarget = vm.runInContext('resolveSpectatorCameraTarget', context);

test('fractional player speeds keep the sprite edge at a fixed output pixel while the camera follows', () => {
    for (const { viewport, scale, size } of [
        { viewport: 1920, scale: 3, size: 24 },
        { viewport: 1365, scale: 3, size: 36 },
        { viewport: 1920, scale: 3, size: 48 },
        { viewport: 1920, scale: 2, size: 24 }
    ]) {
        const positions = [1000, 1002.5, 1005, 1007.5, 1010, 1012.5];
        const renderedEdges = positions.map(center => {
            const camera = cameraOffset(center, viewport, size, scale);
            const cameraScreenPixels = Math.round(camera * scale);
            assert.equal(cameraScreenPixels, camera * scale,
                'camera translation must align to the canvas pixel grid');
            return snap(center - size / 2) * scale - cameraScreenPixels;
        });
        assert.equal(new Set(renderedEdges).size, 1,
            `sprite anchor drifted for viewport=${viewport}, scale=${scale}, size=${size}`);
    }
});

test('regression reproduces the old floor/round mismatch and both local and co-op use the shared anchor', () => {
    const viewport = 1920, scale = 3, size = 24;
    const positions = [1000, 1002.5, 1005, 1007.5];
    const oldEdges = positions.map(center => {
        const oldCamera = Math.round(center - viewport / (2 * scale));
        return snap(center - size / 2) * scale - oldCamera * scale;
    });
    assert.ok(new Set(oldEdges).size > 1, 'the old camera/sprite rounding mismatch should reproduce the jitter');

    const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
    const coop = fs.readFileSync(path.join(root, 'js/coop-game.js'), 'utf8');
    assert.match(game, /cameraOffsetForPixelAnchor\(/);
    assert.match(game, /updateCamera\(cameraFocus, true\)/);
    assert.match(coop, /game\.updateCamera\(focus, true\)/);
    assert.doesNotMatch(game, /Math\.round\(this\.camera\.[xy]\)/);
});

test('aim pointer keeps a fixed pixel offset from the player while the camera follows fractional movement', () => {
    for (const { viewport, scale, size } of [
        { viewport: 1920, scale: 3, size: 24 },
        { viewport: 1365, scale: 3, size: 36 },
        { viewport: 1920, scale: 3, size: 48 },
        { viewport: 1920, scale: 2, size: 24 }
    ]) {
        const positions = [1000, 1002.5, 1005, 1007.5, 1010];
        const relativeMarkerPixels = positions.map(center => {
            const camera = cameraOffset(center, viewport, size, scale);
            const cameraPixels = Math.round(camera * scale);
            const pointer = aimPointerPosition(center, center, size, 0.6, 0.8, 80);
            const playerLeft = snap(center - size / 2) * scale - cameraPixels;
            const markerLeft = snap(pointer.x - 4) * scale - cameraPixels;
            const markerTop = snap(pointer.y - 4) * scale - cameraPixels;
            const playerTop = snap(center - size / 2) * scale - cameraPixels;
            return [markerLeft - playerLeft, markerTop - playerTop].join(',');
        });
        assert.equal(new Set(relativeMarkerPixels).size, 1,
            `aim marker drifted for viewport=${viewport}, scale=${scale}, size=${size}`);
    }
});

test('radial pointer distance follows cursor distance and clamps to one through three tiles', () => {
    const game = Object.create(GamePrototype);
    game.canvas = {
        width: 1920,
        height: 1080,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 })
    };
    game.camera = { x: 0, y: 0 };
    game.map = { width: 10000, height: 8000 };
    game.input = { aimActive: false, aimX: 0, aimY: -1 };
    game.renderShakeX = 2;
    game.renderShakeY = -1;

    for (const { character, visualScale, sniperAiming } of [
        { character: 'pistolero', visualScale: 1, sniperAiming: false },
        { character: 'tirador', visualScale: 1, sniperAiming: true },
        { character: 'bastion', visualScale: 2, sniperAiming: false }
    ]) {
        game.player = { character, x: 1000, y: 800, visualScale, sniperAiming, aimX: 0, aimY: -1,
            _lastAimPointerDirection: { x: 1, y: 0 } };
        for (const { cursorDistance, expectedRadius } of [
            { cursorDistance: 0, expectedRadius: 40 },
            { cursorDistance: 0.5, expectedRadius: 40 },
            { cursorDistance: 20, expectedRadius: 40 },
            { cursorDistance: 40, expectedRadius: 40 },
            { cursorDistance: 75, expectedRadius: 75 },
            { cursorDistance: 120, expectedRadius: 120 },
            { cursorDistance: 240, expectedRadius: 120 }
        ]) {
            game.updateCamera(game.player);
            const renderScale = game.cameraZoom;
            const size = 24 * visualScale;
            const centerX = (snap(game.player.x - size / 2) + size / 2) * renderScale - Math.round(game.camera.x * renderScale) + game.renderShakeX * renderScale;
            const centerY = (snap(game.player.y - size / 2) + size / 2) * renderScale - Math.round(game.camera.y * renderScale) + game.renderShakeY * renderScale;
            game.pointerClientX = centerX + cursorDistance * renderScale;
            game.pointerClientY = centerY;
            const pointer = game.getAimPointerForRender(game.player);
            assert.ok(Math.abs(pointer.distance - expectedRadius) < 1e-9);
            assert.ok(Math.abs(pointer.x - 1) < 1e-9);
            assert.ok(Math.abs(pointer.y) < 1e-9);
            const marker = aimPointerPosition(game.player.x, game.player.y, size, pointer.x, pointer.y, pointer.distance);
            const spriteCenterX = snap(game.player.x - size / 2) + size / 2;
            const spriteCenterY = snap(game.player.y - size / 2) + size / 2;
            assert.ok(Math.abs(Math.hypot(marker.x - spriteCenterX, marker.y - spriteCenterY) - expectedRadius) < 1e-9);
        }
    }
});

test('cursor at sprite center retains the last valid direction and uses the one-tile minimum', () => {
    const game = Object.create(GamePrototype);
    game.canvas = { width: 1920, height: 1080, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) };
    game.camera = { x: 0, y: 0 };
    game.map = { width: 10000, height: 8000 };
    game.input = { aimActive: false, aimX: 0, aimY: -1 };
    game.player = { character: 'pistolero', x: 1000, y: 800, visualScale: 1, aimX: 1, aimY: 0 };
    game.updateCamera(game.player);
    const renderScale = game.cameraZoom;
    game.pointerClientX = (snap(game.player.x - 12) + 12) * renderScale - Math.round(game.camera.x * renderScale);
    game.pointerClientY = (snap(game.player.y - 12) + 12) * renderScale - Math.round(game.camera.y * renderScale);
    const pointer = game.getAimPointerForRender(game.player);
    assert.equal(pointer.distance, 40);
    assert.equal(pointer.x, 1);
    assert.equal(pointer.y, 0);
});

test('remote pointer radii interpolate and remain inside the same limits', () => {
    assert.equal(interpolateAimPointerDistance(40, 120, 0.5), 80);
    assert.equal(interpolateAimPointerDistance(160, 10, 0), 120);
    assert.equal(interpolateAimPointerDistance(160, 10, 1), 40);
    assert.equal(clampAimPointerDistance(NaN), 80);
    const invalidHeading = aimPointerPosition(100, 100, 24, 0, 0, 200);
    assert.equal(Math.hypot(invalidHeading.x - 100, invalidHeading.y - 100), 120);
    const coop = fs.readFileSync(path.join(root, 'js/coop-game.js'), 'utf8');
    const simulation = fs.readFileSync(path.join(root, 'server/simulation.js'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(coop, /aimPointerDistance: game\.getAimPointerForRender/);
    assert.match(coop, /interpolateAimPointerDistance\(aimDistance\.from, aimDistance\.to, alpha\)/);
    assert.match(simulation, /'aimPointerDistance'/);
    assert.match(server, /aimPointerDistance = message\.aimPointerDistance/);
});

test('co-op aim interpolation crosses the angle boundary along the short path', () => {
    const from = { x: Math.cos(179 * Math.PI / 180), y: Math.sin(179 * Math.PI / 180) };
    const to = { x: Math.cos(-179 * Math.PI / 180), y: Math.sin(-179 * Math.PI / 180) };
    const halfway = interpolateDirection(from.x, from.y, to.x, to.y, 0.5);
    assert.ok(halfway.x < -0.999, 'midpoint should point left, not swing through the right side');
    assert.match(fs.readFileSync(path.join(root, 'js/coop-game.js'), 'utf8'), /interpolateDirection\(aim\.fromX, aim\.fromY, aim\.toX, aim\.toY, alpha\)/);
});

test('Game.updateCamera anchors the actual role sprite and keeps camera bounds pixel-aligned', () => {
    const game = Object.create(GamePrototype);
    game.canvas = { width: 1365, height: 768 };
    game.camera = { x: 0, y: 0 };
    game.map = { width: 10000, height: 8000 };
    game.player = { character: 'pistolero', x: 1000, y: 800, visualScale: 1, sniperAiming: false };

    for (const x of [1000, 1002.5, 1005, 1007.5]) {
        game.player.x = x;
        game.updateCamera(game.player);
        const scale = game.cameraZoom;
        const visibleLeft = snap(game.player.x - 12) * scale - Math.round(game.camera.x * scale);
        assert.equal(visibleLeft, Math.round((game.canvas.width - 24 * scale) / 2));
    }

    game.player.character = 'bastion';
    game.player.visualScale = 2;
    game.updateCamera(game.player);
    assert.equal(snap(game.player.x - 48 / 2) * 3 - Math.round(game.camera.x * 3),
        Math.round((game.canvas.width - 48 * 3) / 2));

    game.player.character = 'tirador';
    game.player.visualScale = 1;
    game.player.sniperAiming = true;
    const spectator = { x: 1200, y: 900, renderX: 1202.5, renderY: 902.5, visualScale: 1 };
    game.updateCamera(spectator, true);
    assert.equal(snap(spectator.renderX - 12) * 2 - Math.round(game.camera.x * 2),
        Math.round((game.canvas.width - 24 * 2) / 2));
    assert.equal(snap(spectator.renderY - 12) * 2 - Math.round(game.camera.y * 2),
        Math.round((game.canvas.height - 24 * 2) / 2));

    game.player.x = 12;
    game.updateCamera(game.player);
    assert.equal(game.camera.x, 0, 'camera remains clamped at the near map edge');
    assert.equal(Math.round(game.camera.x * game.cameraZoom), game.camera.x * game.cameraZoom);
});

test('spectator camera follows a living teammate, switches targets, and returns to the revived player', () => {
    const game = Object.create(GamePrototype);
    game.canvas = { width: 1920, height: 1080 };
    game.camera = { x: 0, y: 0 };
    game.map = { width: 10000, height: 8000 };
    const viewer = { id: 'viewer', character: 'pistolero', health: 0, x: 600, y: 600, visualScale: 1 };
    const first = { id: 'a', character: 'tirador', health: 86, x: 700, y: 800, renderX: 702.5, renderY: 802.5, visualScale: 1 };
    const second = { id: 'b', character: 'bastion', health: 120, x: 1400, y: 1300, renderX: 1402.5, renderY: 1302.5, visualScale: 2 };
    game.player = viewer;
    const players = [viewer, first, second];

    const focusAndCheck = (currentTargetId, random) => {
        const selection = resolveSpectatorTarget(viewer, players, currentTargetId, random);
        game.spectatorTarget = selection.spectating ? selection.target : null;
        const focus = selection.target || viewer;
        game.updateCamera(focus, true);
        const size = 24 * (focus.visualScale || 1);
        const scale = game.cameraZoom;
        const screenLeft = snap((focus.renderX ?? focus.x) - size / 2) * scale - Math.round(game.camera.x * scale);
        const screenTop = snap((focus.renderY ?? focus.y) - size / 2) * scale - Math.round(game.camera.y * scale);
        // Match Player.draw's snapped top-left, including the interpolated co-op coordinates.
        const expectedLeft = Math.round((game.canvas.width - size * scale) / 2);
        const expectedTop = Math.round((game.canvas.height - size * scale) / 2);
        assert.equal(screenLeft, expectedLeft);
        assert.equal(screenTop, expectedTop);
        return selection;
    };

    let selection = focusAndCheck(null, () => 0);
    assert.equal(selection.target.id, 'a');
    assert.equal(selection.spectating, true);
    assert.ok(game.camera.x > 0, 'camera must be based on the survivor, not the downed viewer');

    first.health = 0;
    selection = focusAndCheck(selection.targetId, () => 0.99);
    assert.equal(selection.target.id, 'b');
    assert.equal(selection.spectating, true);

    viewer.health = 50;
    selection = focusAndCheck(selection.targetId, () => 0.99);
    assert.equal(selection.target.id, 'viewer');
    assert.equal(selection.targetId, null);
    assert.equal(selection.spectating, false);
    assert.equal(game.spectatorTarget, null);

    const coop = fs.readFileSync(path.join(root, 'js/coop-game.js'), 'utf8');
    assert.match(coop, /game\.spectatorTarget = cameraSelection\.spectating \? cameraSelection\.target : null/);
    assert.match(coop, /game\.updateCamera\(focus, true\)/);
});
