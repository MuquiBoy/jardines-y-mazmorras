'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console });
for (const file of [
    'js/characters/roles.js', 'js/bullet.js', 'js/enemy.js',
    'js/enemies/mini-jefes/cochinilla_esquinero/cochinilla_esquinero.js'
]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const Cochinilla = vm.runInContext('CochinillaEsquinero', context);
const bulletHitsEnemy = vm.runInContext('bulletHitsEnemy', context);

test('the first second includes spawn warning and later cycles have exact phase lengths', () => {
    const room = {};
    const map = { isWalkable: () => true, pointInRoom: () => room };
    const players = [
        { id: 'p1', x: 300, y: 350, health: 36, invincibleTimer: 0 },
        { id: 'p2', x: 400, y: 300, health: 36, invincibleTimer: 0 }
    ];
    vm.runInContext('Math.random = () => 0.99', context);
    const enemy = new Cochinilla(200, 200, room);
    assert.equal(enemy.maxHealth, 280);
    enemy.beginEncounter(36);
    assert.equal(enemy.phaseTimer, 24);
    enemy.takeDamage(50);
    assert.equal(enemy.health, 280);
    for (let i = 0; i < 23; i++) enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'entry');
    enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'idle');

    for (let i = 0; i < 299; i++) enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'idle');
    enemy.takeDamage(30);
    assert.equal(enemy.health, 280);
    assert.equal(enemy.update(players[0], [], map, players), 'charge');
    assert.equal(enemy.targetId, 'p2');
    const firstEndY = enemy.beamEndY;
    players[1].y += 120;
    enemy.update(players[0], [], map, players);
    assert.notEqual(enemy.beamEndY, firstEndY, 'warning line must track its chosen player');
    for (let i = 1; i < 299; i++) enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'charge');
    enemy.takeDamage(30);
    assert.equal(enemy.health, 280);
    enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'attack');
    assert.equal(enemy.laserDamageFor(players[1]), 6);
    const fixedEnd = [enemy.beamEndX, enemy.beamEndY];
    players[1].x += 180;
    enemy.update(players[0], [], map, players);
    assert.deepEqual([enemy.beamEndX, enemy.beamEndY], fixedEnd,
        'active beam must not follow movement');
    enemy.takeDamage(30);
    assert.equal(enemy.health, 250);
    for (let i = 1; i < 419; i++) enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'attack');
    enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'idle');
    enemy.takeDamage(30);
    assert.equal(enemy.health, 250);
    assert.equal(enemy.laserDamageFor(players[1]), 0);

    vm.runInContext('Math.random = () => 0', context);
    for (let i = 0; i < 300; i++) enemy.update(players[0], [], map, players);
    assert.equal(enemy.phase, 'charge');
    assert.equal(enemy.targetId, 'p1', 'each new charge must draw a new living player');
    for (let i = 0; i < 300; i++) enemy.update(players[0], [], map, players);
    enemy.takeDamage(999);
    assert.equal(enemy.alive, false);
    assert.equal(enemy.phase, 'dead');
    assert.equal(enemy.phaseTimer, 0);
    assert.equal(enemy.laserDamageFor(players[0]), 0);
});

test('red authored hitbox pixels and their corner mirrors decide projectile impacts', () => {
    for (const [corner, mirrorX, mirrorY] of [
        ['top-left', false, false], ['top-right', true, false],
        ['bottom-left', false, true], ['bottom-right', true, true]
    ]) {
        const enemy = new Cochinilla(200, 200, null, corner);
        const mask = enemy.hitboxMask;
        assert.equal(mask.width, 120);
        assert.equal(mask.height, 120);
        assert.equal(mask.spans.reduce((count, [, start, end]) => count + end - start, 0), 8698);
        const redX = mirrorX ? 119 - 40 : 40;
        const redY = mirrorY ? 119 - 60 : 60;
        const emptyX = mirrorX ? 119 - 60 : 60;
        const emptyY = mirrorY ? 119 - 60 : 60;
        assert.equal(bulletHitsEnemy({ x: 200 - 60 + redX + 0.5,
            y: 200 - 60 + redY + 0.5, radius: 0.4 }, enemy), true, corner);
        assert.equal(bulletHitsEnemy({ x: 200 - 60 + emptyX + 0.5,
            y: 200 - 60 + emptyY + 0.5, radius: 0.4 }, enemy), false, corner);
    }
});
