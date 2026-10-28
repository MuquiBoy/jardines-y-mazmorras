'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'js/camera.js'), 'utf8'), context);
const resolveTarget = vm.runInContext('resolveSpectatorCameraTarget', context);
const selectPartyTargetId = vm.runInContext('selectPartySpectatorTargetId', context);

function player(id, health, x = 0) { return { id, health, x, y: x + 10 }; }

test('living player keeps their own camera; two clients see the same survivor', () => {
    const downed = player('a', 0, 12);
    const survivor = player('b', 24, 400);
    const roster = [downed, survivor];

    const deadView = resolveTarget(downed, roster, null, () => 0.7);
    const livingView = resolveTarget(survivor, roster, null, () => 0.7);

    assert.equal(deadView.target.id, 'b');
    assert.equal(deadView.spectating, true);
    assert.equal(livingView.target.id, 'b');
    assert.equal(livingView.spectating, false);
    assert.equal(deadView.target.x, livingView.target.x);
});

test('random target is stable until it dies, then switches to another survivor', () => {
    const downed = player('a', 0);
    const first = player('b', 24, 200);
    const second = player('c', 24, 500);
    const third = player('d', 24, 800);
    const roster = [downed, first, second, third];

    const chosenId = selectPartyTargetId(roster, null, () => 0.99);
    const firstDeadView = resolveTarget(downed, roster, chosenId, () => 0);
    const secondDeadViewer = player('e', 0);
    const secondDeadView = resolveTarget(secondDeadViewer, [...roster, secondDeadViewer], chosenId, () => 0);
    assert.equal(chosenId, 'd');
    assert.equal(firstDeadView.target.id, 'd');
    assert.equal(secondDeadView.target.id, 'd');

    third.health = 0;
    const switchedId = selectPartyTargetId(roster, chosenId, () => 0);
    const switched = resolveTarget(downed, roster, switchedId, () => 0.99);
    assert.equal(switched.target.id, 'b');
    assert.equal(selectPartyTargetId(roster, switchedId, () => 0.99), 'b');
    assert.equal(switched.spectating, true);
});

test('downed viewer returns to their own camera after revival', () => {
    const viewer = player('a', 0, 50);
    const teammate = player('b', 24, 300);
    const before = resolveTarget(viewer, [viewer, teammate], null);
    assert.equal(before.target.id, 'b');

    viewer.health = 10;
    const after = resolveTarget(viewer, [viewer, teammate], before.targetId);
    assert.equal(after.target.id, 'a');
    assert.equal(after.targetId, null);
    assert.equal(after.spectating, false);
});

test('returns no target when all players are down', () => {
    const downed = player('a', 0);
    const teammate = player('b', 0);
    const result = resolveTarget(downed, [downed, teammate], null);
    assert.equal(result.target, null);
    assert.equal(result.targetId, null);
});

test('fixed camera and Tirador aim use integer pixel-perfect zooms', () => {
    const palette = fs.readFileSync(path.join(root, 'js/palette.js'), 'utf8');
    const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
    assert.match(palette, /const CAMERA_ZOOM = 3\\.0;/);
    assert.match(palette, /const TIRADOR_AIM_ZOOM = 2\\.0;/);
    assert.match(game, /this\\.player\\.sniperAiming \\? TIRADOR_AIM_ZOOM : CAMERA_ZOOM/);
    const zoomContext = vm.createContext({});
    vm.runInContext(palette, zoomContext);
    assert.equal(vm.runInContext('1920 / CAMERA_ZOOM', zoomContext), 640);
    assert.equal(vm.runInContext('1080 / CAMERA_ZOOM', zoomContext), 360);
    assert.equal(vm.runInContext('1920 / TIRADOR_AIM_ZOOM', zoomContext), 960);
    assert.equal(vm.runInContext('1080 / TIRADOR_AIM_ZOOM', zoomContext), 540);
    assert.equal(vm.runInContext('Number.isInteger(CAMERA_ZOOM) && Number.isInteger(TIRADOR_AIM_ZOOM)', zoomContext), true);
});
test('shared target clears when everyone revives or no survivor remains', () => {
    const downed = player('a', 0);
    const teammate = player('b', 0);
    assert.equal(selectPartyTargetId([downed, teammate], 'a'), null);
    assert.equal(selectPartyTargetId([player('a', 10), player('b', 20)], 'b'), null);
});
