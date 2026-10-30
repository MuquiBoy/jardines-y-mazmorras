'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Simulation = require('../server/simulation');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console });
for (const file of ['js/characters/roles.js', 'js/player.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const Player = vm.runInContext('Player', context);
const universalSpeed = vm.runInContext('UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME', context);

const input = (fire, moveX = 1, moveY = 0) => ({
    keys: {}, moveX, moveY, mouseDown: fire, aimActive: true, aimX: 1, aimY: 0
});

test('Bastión avanza a 0,60 universal al disparar en ambas formas', () => {
    const player = new Player(500, 500);
    player.setCharacter('bastion');
    assert.equal(universalSpeed, 2.5);
    assert.equal(player.speed, 0.85 * universalSpeed);

    let before = player.x;
    player.update(input(false), null, null);
    assert.equal(player.x - before, 0.85 * universalSpeed);

    before = player.x;
    player.update(input(true), null, null);
    assert.equal(player.x - before, 0.60 * universalSpeed);
    assert.equal(player.turretActive, true);

    player.grayHealth = 0;
    player.updateBastionForm();
    assert.equal(player.speed, universalSpeed);
    before = player.x;
    player.update(input(true), null, null);
    assert.equal(player.x - before, 0.60 * universalSpeed);

    before = player.x;
    player.update(input(false), null, null);
    assert.equal(player.x - before, universalSpeed);
    assert.equal(player.turretActive, false);

    const startX = player.x, startY = player.y;
    player.update(input(true, 1, 1), null, null);
    assert.ok(Math.abs(Math.hypot(player.x - startX, player.y - startY) - 0.60 * universalSpeed) < 1e-9);
});

test('el servidor cooperativo aplica la misma velocidad y no altera al compañero', () => {
    const run = Simulation.createRun([
        { id: 'bastion', name: 'Bastión', character: 'bastion' },
        { id: 'pistolero', name: 'Pistolero', character: 'pistolero' }
    ]);
    const bastion = run.players.get('bastion');
    const pistolero = run.players.get('pistolero');
    const beforeBastion = bastion.x, beforePistolero = pistolero.x;
    const inputs = new Map([
        ['bastion', { moveX: 1, moveY: 0, aimX: 1, aimY: 0, fire: true, reload: false }],
        ['pistolero', { moveX: 1, moveY: 0, aimX: 1, aimY: 0, fire: true, reload: false }]
    ]);

    Simulation.stepRun(run, inputs);
    assert.equal(bastion.x - beforeBastion, 0.60 * universalSpeed);
    assert.equal(pistolero.x - beforePistolero, universalSpeed);
    assert.equal(Simulation.snapshot(run).players.find(player => player.id === 'bastion').turretActive, true);

    bastion.grayHealth = 0;
    bastion.updateBastionForm();
    const weakBefore = bastion.x;
    Simulation.stepRun(run, inputs);
    assert.equal(bastion.x - weakBefore, 0.60 * universalSpeed);
});
