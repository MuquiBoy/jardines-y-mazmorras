'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console });
for (const file of [
    'js/palette.js', 'js/characters/roles.js', 'js/enemy-projectile-pool.js',
    'js/enemy.js', 'js/map.js',
    'js/enemies/smart-cover.js',
    'js/enemies/esbirros/esbirro_miedoso/esbirro_miedoso.js',
    'js/enemies/esbirros/mosca_tirador/mosca-tirador.js',
    'js/enemies/esbirros/esbirro_tirador/esbirro_tirador.js'
]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const DungeonMap = vm.runInContext('DungeonMap', context);
const SmartCover = vm.runInContext('SmartCover', context);
const EsbirroMiedoso = vm.runInContext('EsbirroMiedoso', context);
const MoscaTirador = vm.runInContext('MoscaTirador', context);
const EsbirroTirador = vm.runInContext('EsbirroTirador', context);

function makeRoom(blocked = []) {
    const map = new DungeonMap(800, 600);
    const mask = new Array(20 * 15).fill(1);
    for (const { x, y, w = 1, h = 1 } of blocked) {
        for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
            mask[row * 20 + col] = 3;
        }
    }
    const walkableCells = [];
    for (let y = 0; y < 15; y++) for (let x = 0; x < 20; x++) {
        if (mask[y * 20 + x] === 1) walkableCells.push({ x, y });
    }
    const room = { x: 0, y: 0, w: 800, h: 600, tw: 20, th: 15,
        template: { mask, walkableCells } };
    map.rooms = [room];
    return { map, room };
}

function player(id, x, y) {
    return { id, x, y, health: 36, alive: true, invincibleTimer: 0 };
}

test('visible player: unchanged damage and cadence from a clear firing band', () => {
    const { map } = makeRoom();
    const fly = new MoscaTirador(320, 300);
    const target = player('one', 520, 300);
    fly.shootTimer = 1;
    const bullets = fly.update(target, [], map, [target]);
    assert.equal(bullets.length, 1);
    assert.equal(bullets[0].damage, 6);
    assert.equal(bullets[0].radius, 4);
    assert.equal(fly.shootTimer, 60);
    assert.equal(fly.health, 28);
    assert.equal(fly.speed, 1.75);
});

test('wall: holds a ready shot and routes to a clear firing angle', () => {
    const { map } = makeRoom([{ x: 10, y: 4, h: 7 }]);
    const fly = new MoscaTirador(320, 300);
    const target = player('one', 520, 300);
    fly.shootTimer = 1;
    assert.equal(map.hasLineOfSight(fly.x, fly.y, target.x, target.y, 4), false);
    assert.equal(fly.update(target, [], map, [target]).length, 0);
    assert.equal(fly.shootTimer, 0, 'blocked shot must not spend the cooldown');
    let shots = 0;
    for (let frame = 0; frame < 420; frame++) {
        const fired = fly.update(target, [], map, [target]);
        if (fired.length) {
            shots += fired.length;
            assert.equal(map.hasLineOfSight(fly.x, fly.y, target.x, target.y, 4), true);
        }
        assert.equal(map.canOccupy(fly.x, fly.y, fly.radius), true);
    }
    assert.ok(shots > 0, 'fly should flank rather than wait at the wall');
});

test('nearby threat: retreats in open space and uses blue cover to peek and fire', () => {
    const open = makeRoom().map;
    const exposed = new MoscaTirador(320, 300);
    const near = player('near', 360, 300);
    exposed.shootTimer = 30;
    exposed.update(near, [], open, [near]);
    assert.ok(exposed.x < 320, 'must retreat when no cover exists');

    const { map } = makeRoom([{ x: 9, y: 6, h: 3 }]);
    const covered = new MoscaTirador(440, 300);
    const target = player('one', 200, 300);
    covered.shootTimer = 1;
    covered.update(target, [], map, [target]);
    assert.ok(covered.coverPoint, 'blue obstacle must be recognized as cover');
    let shots = 0;
    for (let frame = 0; frame < 420; frame++) {
        shots += covered.update(target, [], map, [target]).length;
        assert.equal(map.canOccupy(covered.x, covered.y, covered.radius), true);
    }
    assert.ok(shots > 0, 'cover must not turn into permanent inactivity');
});

test('fly seeks safe cover from room activation at full health and normal firing distance', () => {
    const { map } = makeRoom([{ x: 11, y: 6 }]);
    const target = player('one', 300, 300);
    const fly = new MoscaTirador(520, 300);
    const scared = new EsbirroMiedoso(520, 300);
    fly.shootTimer = 50;
    scared.shootTimer = 50;
    assert.equal(fly.health, 28);
    assert.equal(Math.hypot(fly.x - target.x, fly.y - target.y), 220);
    assert.equal(map.hasLineOfSight(fly.x, fly.y, target.x, target.y, 4), true);
    fly.update(target, [], map, [target]);
    scared.update(target, [], map, [target]);
    assert.ok(fly.coverPoint, 'fly should look for cover before being injured');
    assert.ok(Math.hypot(fly.coverPoint.x - target.x, fly.coverPoint.y - target.y) >= 180,
        'cover must respect the fly safe distance');
    assert.equal(fly.tacticalGoal?.kind, 'cover');
    assert.equal(scared.coverPoint, null,
        'scared esbirro keeps its own half-health activation condition');
});

test('180 px is the fly safe-distance threshold when no cover exists', () => {
    const { map } = makeRoom();
    const tooClose = new MoscaTirador(320, 300);
    const closePlayer = player('close', 499, 300);
    tooClose.shootTimer = 50;
    tooClose.update(closePlayer, [], map, [closePlayer]);
    assert.ok(tooClose.x < 320, 'at 179 px it must retreat');

    const safe = new MoscaTirador(320, 300);
    const safePlayer = player('safe', 501, 300);
    safe.shootTimer = 50;
    safe.update(safePlayer, [], map, [safePlayer]);
    assert.equal(safe.x, 320, 'at 181 px with a clear lane it may hold position');
});

test('fly abandons cover when a player closes in; scared esbirro may stay hidden', () => {
    const { map } = makeRoom([{ x: 9, y: 6, h: 3 }]);
    const target = player('one', 200, 300);
    const fly = new MoscaTirador(440, 300);
    const scared = new EsbirroMiedoso(440, 300);
    scared.health = 17;
    fly.shootTimer = 80;
    scared.shootTimer = 80;
    fly.update(target, [], map, [target]);
    scared.update(target, [], map, [target]);
    assert.ok(fly.coverPoint && scared.coverPoint);

    target.x = 320;
    const oldFlyX = fly.x;
    fly.update(target, [], map, [target]);
    scared.update(target, [], map, [target]);
    assert.equal(fly.coverPoint, null, 'cover inside 180 px is no longer safe for the fly');
    assert.ok(fly.x > oldFlyX, 'fly retreats from a nearby player');
    assert.ok(scared.coverPoint, 'scared esbirro keeps cover without the fly distance rule');
});

test('complex obstacles and cooperative targets remain stable; clone keeps old AI', () => {
    const { map } = makeRoom([
        { x: 8, y: 3, h: 8 }, { x: 8, y: 10, w: 6 }
    ]);
    const fly = new MoscaTirador(240, 300);
    const left = player('left', 300, 300);
    const right = player('right', 560, 300);
    const summon = { ownerId: 'left', x: 250, y: 300, health: 18, alive: true };
    fly.shootTimer = 1;
    fly.update(summon, [], map, [left, right, summon]);
    assert.equal(fly.trackedPlayer, left, 'summon is not the player target');
    left.health = 0;
    fly.update(summon, [], map, [left, right, summon]);
    assert.equal(fly.trackedPlayer, right, 'dead player is no longer a target');
    for (let frame = 0; frame < 300; frame++) {
        fly.update(right, [], map, [left, right, summon]);
        assert.equal(map.canOccupy(fly.x, fly.y, fly.radius), true);
    }
    assert.ok(Math.hypot(fly.x - 240, fly.y - 300) > 30,
        'must navigate around the L-shaped obstruction');

    const clone = new EsbirroTirador(320, 300);
    assert.equal(clone.health, 28);
    assert.equal(clone.shootCooldown, 60);
    assert.notEqual(Object.getPrototypeOf(clone).update,
        Object.getPrototypeOf(fly).update, 'clone must retain its independent AI');
});

test('both cover users call the same shared strategy without inheriting each other', () => {
    const { map } = makeRoom([{ x: 9, y: 6, h: 3 }]);
    const threat = player('one', 200, 300);
    const scared = new EsbirroMiedoso(440, 300);
    const fly = new MoscaTirador(440, 300);
    scared.health = 17;
    scared.shootTimer = 80;
    fly.shootTimer = 80;
    const original = SmartCover.findCoverPoint;
    const users = new Set();
    SmartCover.findCoverPoint = function (enemy, ...args) {
        users.add(enemy.type);
        return original.call(this, enemy, ...args);
    };
    try {
        scared.update(threat, [], map, [threat]);
        fly.update(threat, [], map, [threat]);
        assert.deepEqual([...users].sort(), ['esbirro_miedoso', 'mosca_tirador']);
        assert.equal(Object.hasOwn(EsbirroMiedoso.prototype, 'findCoverPoint'), false);
        assert.equal(Object.hasOwn(MoscaTirador.prototype, 'findCoverPoint'), false);
        assert.ok(scared.coverPoint, 'scared esbirro still finds its shelter at half health');
        assert.ok(fly.coverPoint, 'fly still finds its shelter when threatened');
    } finally {
        SmartCover.findCoverPoint = original;
    }
});
