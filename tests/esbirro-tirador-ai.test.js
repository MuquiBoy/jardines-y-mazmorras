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
    'js/enemy.js', 'js/map.js', 'js/enemies/smart-cover.js',
    'js/enemies/esbirros/mosca_tirador/mosca-tirador.js',
    'js/enemies/esbirros/esbirro_tirador/esbirro_tirador.js'
]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const DungeonMap = vm.runInContext('DungeonMap', context);
const SmartCover = vm.runInContext('SmartCover', context);
const EsbirroTirador = vm.runInContext('EsbirroTirador', context);
const MoscaTirador = vm.runInContext('MoscaTirador', context);

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
    map.rooms = [{ x: 0, y: 0, w: 800, h: 600, tw: 20, th: 15,
        template: { mask, walkableCells } }];
    return map;
}

function player(id, x, y) {
    return { id, x, y, health: 36, alive: true };
}

test('160 px is a maximum, and the esbirro uses half the universal movement speed', () => {
    const map = makeRoom();
    const target = player('one', 520, 300);
    const enemy = new EsbirroTirador(320, 300);
    enemy.shootTimer = 0;
    const oldX = enemy.x;
    assert.equal(enemy.update(target, [], map, [target]).length, 0);
    assert.equal(enemy.attackState, 'SEEK_ATTACK_POSITION');
    assert.equal(enemy.speed, 1.25);
    assert.ok(enemy.x > oldX);

    for (const range of [160, 120, 100, 80]) {
        const shooter = new EsbirroTirador(320, 300);
        shooter.shootTimer = 0;
        target.x = 320 + range;
        assert.equal(shooter.update(target, [], map, [target]).length, 1,
            `a clear position at ${range} px must allow the first shot`);
        assert.equal(shooter.attackState, 'BURST_ATTACK');
        assert.equal(shooter.x, 320, 'it must not retreat just to stay 160 px away');
    }
});

test('a complete burst has five individually timed pooled projectiles and a full reload', () => {
    const map = makeRoom();
    const enemy = new EsbirroTirador(320, 300);
    const target = player('one', 440, 300);
    const shots = [];
    const pool = { acquire(owner, angle, speed) {
        return { owner: owner.type, angle, speed, damage: 6, radius: 4 };
    } };
    enemy.shootTimer = 0;
    enemy.retreatFrom = () => false; // Hold the range steady while testing the clock.
    for (let frame = 0; frame <= 144; frame++) {
        const fired = enemy.update(target, [], map, [target], pool);
        if (fired.length) shots.push({ frame, bullet: fired[0] });
    }
    assert.deepEqual(shots.map(shot => shot.frame), [0, 36, 72, 108, 144]);
    assert.ok(shots.every(shot => shot.bullet.owner === 'esbirro_tirador' &&
        shot.bullet.speed === 2.5 && shot.bullet.damage === 6 && shot.bullet.radius === 4));
    assert.equal(enemy.attackState, 'RELOAD_COVER');
    assert.equal(enemy.reloadTimer, 198);
    for (let frame = 1; frame < 198; frame++) {
        assert.equal(enemy.update(target, [], map, [target], pool).length, 0);
    }
    assert.equal(enemy.reloadTimer, 1);
    assert.equal(enemy.update(target, [], map, [target], pool).length, 1,
        'the next burst may start only after all 198 reload frames');
});

test('spread is independently sampled to both sides and never caps projectile travel at 160 px', () => {
    const map = makeRoom();
    const enemy = new EsbirroTirador(320, 300);
    const target = player('one', 440, 300);
    enemy.shootTimer = 0;
    vm.runInContext('globalThis.__savedRandom = Math.random; Math.random = (() => { let i = 0; return () => [0, 1][i++ % 2]; })()', context);
    try {
        const first = enemy.update(target, [], map, [target])[0];
        for (let i = 0; i < 35; i++) enemy.update(target, [], map, [target]);
        const second = enemy.update(target, [], map, [target])[0];
        assert.ok(first.vy < 0 && second.vy > 0);
        assert.ok(Math.abs(Math.atan2(first.vy, first.vx)) <= Math.PI / 15 + 1e-9);
        assert.ok(Math.abs(Math.atan2(second.vy, second.vx)) <= Math.PI / 15 + 1e-9);
        assert.equal(first.radius, 4);
        assert.equal(first.damage, 6);
        assert.equal(first.range, undefined, 'the 160 px limit must not attach to a projectile');
    } finally {
        vm.runInContext('Math.random = globalThis.__savedRandom; delete globalThis.__savedRandom', context);
    }
});

test('losing range or a clear line interrupts the burst and requires the full reload', () => {
    for (const obstruction of ['range', 'wall']) {
        const map = makeRoom();
        const enemy = new EsbirroTirador(320, 300);
        const target = player('one', 440, 300);
        enemy.shootTimer = 0;
        assert.equal(enemy.update(target, [], map, [target]).length, 1);
        if (obstruction === 'range') target.x = 550;
        else map.rooms[0].template.mask[7 * 20 + 9] = 3;
        assert.equal(enemy.update(target, [], map, [target]).length, 0);
        assert.equal(enemy.attackState, 'RELOAD_COVER');
        assert.equal(enemy.reloadTimer, 198);
        for (let i = 0; i < 120; i++) {
            assert.equal(enemy.update(target, [], map, [target]).length, 0);
            assert.ok(map.canOccupy(enemy.x, enemy.y, enemy.radius));
        }
    }
});

test('the shared SmartCover module supplies attack positions and reload shelters', () => {
    const map = makeRoom([{ x: 9, y: 6, h: 3 }]);
    const target = player('one', 200, 300);
    const enemy = new EsbirroTirador(440, 300);
    enemy.shootTimer = 0;
    let attackCalls = 0;
    let coverCalls = 0;
    const originalAttack = SmartCover.findAttackPoint;
    const originalCover = SmartCover.findCoverPoint;
    SmartCover.findAttackPoint = function (...args) {
        attackCalls++;
        assert.equal(args[5].maxRange, 160);
        return originalAttack.apply(this, args);
    };
    SmartCover.findCoverPoint = function (...args) {
        coverCalls++;
        return originalCover.apply(this, args);
    };
    try {
        enemy.update(target, [], map, [target]);
        assert.ok(attackCalls > 0);
        enemy.beginReload();
        enemy.update(target, [], map, [target]);
        assert.ok(coverCalls > 0);
        assert.equal(Object.hasOwn(EsbirroTirador.prototype, 'findCoverPoint'), false);
        assert.equal(Object.hasOwn(EsbirroTirador.prototype, 'findAttackPoint'), false);
        for (let frame = 0; frame < 240; frame++) {
            enemy.update(target, [], map, [target]);
            assert.ok(map.canOccupy(enemy.x, enemy.y, enemy.radius));
        }
    } finally {
        SmartCover.findAttackPoint = originalAttack;
        SmartCover.findCoverPoint = originalCover;
    }
});

test('cooperative targeting follows living players and ignores summons; Mosca remains unchanged', () => {
    const map = makeRoom();
    const first = player('first', 380, 300);
    const second = player('second', 440, 300);
    const summon = { ownerId: 'first', x: 330, y: 300, health: 18, alive: true };
    const enemy = new EsbirroTirador(320, 300);
    enemy.shootTimer = 0;
    enemy.update(summon, [], map, [first, second, summon]);
    assert.equal(enemy.trackedPlayer, first);
    first.health = 0;
    enemy.update(summon, [], map, [first, second, summon]);
    assert.equal(enemy.trackedPlayer, second);
    assert.equal(enemy.attackState, 'RELOAD_COVER');
    assert.equal(enemy.reloadTimer, 198, 'switching players during a burst starts a full reload');
    const fly = new MoscaTirador(320, 300);
    assert.equal(fly.speed, 1.75);
    assert.equal(fly.shootCooldown, 60);
    assert.equal(fly.health, 28);
});
