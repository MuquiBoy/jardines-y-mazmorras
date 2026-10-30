'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Simulation = require('../server/simulation');

const expected = {
    esbirro_miedoso: { health: 30, movementSpeedMultiplier: 0.70, speed: 1.75, shootCooldown: 180 },
    mosca_tirador: { health: 28, movementSpeedMultiplier: 0.70, speed: 1.75, shootCooldown: 60 },
    spiral: { health: 50, movementSpeedMultiplier: 0.50, speed: 1.25, shootCooldown: 300 },
    'cochinilla-esquinero': { health: 100, movementSpeedMultiplier: 0, speed: 0 },
    babosa_persecucion: { health: 500, movementSpeedMultiplier: 0.70, speed: 1.75 },
    boss: { health: 500, movementSpeedMultiplier: 0.16, speed: 0.40, shootCooldown: 30 }
};

function statProfile(enemy) {
    return {
        health: enemy.maxHealth,
        movementSpeedMultiplier: enemy.movementSpeedMultiplier,
        speed: enemy.speed,
        damage: enemy.damage,
        radius: enemy.radius,
        xpValue: enemy.xpValue,
        shootCooldown: enemy.shootCooldown
    };
}

test('enemy stats stay fixed across generated floors while room composition remains procedural', () => {
    const run = Simulation.createRun([{ id: 'floor-stats-probe', name: 'Probe', character: 'pistolero' }]);
    const roomTypes = ['combat', 'combat-hard', 'boss'];
    const rooms = roomTypes.map(type => run.map.rooms.find(room => room.type === type));
    assert.ok(rooms.every(Boolean), 'generated test floor should contain ordinary, hard, and boss rooms');

    const seen = new Map();
    const simpleRoomCounts = new Map();
    for (const floor of [1, 10, 14, 30]) {
        for (const room of rooms) {
            for (let attempt = 0; attempt < 40; attempt++) {
                const enemies = run.map.getEnemiesForRoom(room, null, 0, floor);
                if (room.type === 'combat') {
                    simpleRoomCounts.set(floor, (simpleRoomCounts.get(floor) || 0) + enemies.length);
                }
                for (const enemy of enemies) {
                    const profile = statProfile(enemy);
                    if (seen.has(enemy.type)) {
                        assert.deepEqual(profile, seen.get(enemy.type), `${enemy.type} changed stats on floor ${floor}`);
                    } else {
                        seen.set(enemy.type, profile);
                    }
                    const reference = expected[enemy.type];
                    if (reference) {
                        for (const [stat, value] of Object.entries(reference)) {
                            assert.equal(profile[stat], value, `${enemy.type} ${stat}`);
                        }
                    }
                }
            }
        }
    }

    for (const type of ['esbirro_miedoso', 'mosca_tirador', 'spiral', 'babosa_persecucion', 'boss']) {
        assert.ok(seen.has(type), `expected to encounter ${type} during generated-room sampling`);
    }
    const average = floor => simpleRoomCounts.get(floor) / 40;
    assert.ok(average(14) > average(1), 'deeper-floor pressure should remain in room composition');
});

test('floor stat scaler and bullet-speed multiplier are absent from game and server code', () => {
    const root = path.resolve(__dirname, '..');
    const files = ['js/enemy.js', 'js/map.js', 'js/game.js', 'js/enemy-projectile-pool.js', 'server/simulation.js'];
    const source = files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    for (const obsolete of ['applyDifficulty', 'difficultyForFloor', 'endgameFloors', 'bulletSpeedScale', 'scaleToFloor']) {
        assert.equal(source.includes(obsolete), false, `${obsolete} remains active in game/server code`);
    }
});

test('all enemy movement follows the shared universal player speed reference', () => {
    const root = path.resolve(__dirname, '..');
    function createEnemyTypes(referenceSpeed) {
        const context = vm.createContext({ console, Image: undefined, DecompressionStream: undefined });
        const rolesPath = path.join(root, 'js/characters/roles.js');
        const rolesSource = fs.readFileSync(rolesPath, 'utf8').replace(
            'const UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME = 2.5;',
            `const UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME = ${referenceSpeed};`
        );
        assert.ok(rolesSource.includes(`const UNIVERSAL_MOVEMENT_SPEED_PX_PER_FRAME = ${referenceSpeed};`),
            'test should vary the single speed reference');
        vm.runInContext(fs.readFileSync(path.join(root, 'js/palette.js'), 'utf8'), context);
        vm.runInContext(rolesSource, context);
        const files = [
            'js/enemy.js',
            'js/enemies/esbirros/esbirro_miedoso/esbirro_miedoso.js',
            'js/enemies/esbirros/mosca-tirador.js',
            'js/enemies/esbirros/spiral-enemy.js',
            'js/enemies/mini-jefes/cochinilla_esquinero/cochinilla_esquinero.js',
            'js/enemies/mini-jefes/babosa_persecucion/babosa_persecucion.js'
        ];
        for (const file of files) {
            vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
        }
        return vm.runInContext(`(() => {
            const types = [EsbirroMiedoso, MoscaTirador, SpiralEnemy, BossEnemy,
                CochinillaEsquinero, BabosaPersecucion];
            return types.map(Type => new Type(0, 0));
        })()`, context);
    }

    const defaultReference = createEnemyTypes(2.5);
    const changedReference = createEnemyTypes(4.0);
    assert.equal(defaultReference.length, changedReference.length);
    for (let i = 0; i < defaultReference.length; i++) {
        const original = defaultReference[i];
        const changed = changedReference[i];
        assert.equal(changed.movementSpeedMultiplier, original.movementSpeedMultiplier);
        assert.equal(original.speed, 2.5 * original.movementSpeedMultiplier);
        assert.equal(changed.speed, 4.0 * changed.movementSpeedMultiplier);
    }
});
