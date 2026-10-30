'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Simulation = require('../server/simulation');

const root = path.resolve(__dirname, '..');

function poolClasses() {
    const context = vm.createContext({});
    for (const file of ['js/enemy-projectile-pool.js', 'js/particle-pool.js', 'js/game.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
    return vm.runInContext('({ ParticlePool, Game })', context);
}

test('death bursts reuse a fixed pool even when hit particles fill it', () => {
    const { ParticlePool } = poolClasses();
    const pool = new ParticlePool(64);
    const originals = new Set(pool.free);
    pool.spawn(10, 20, '#ff4444', 64);
    assert.equal(pool.active.length, 64);
    pool.spawn(10, 20, '#ff4444', 12, 'death');
    assert.equal(pool.active.length, 64);
    assert.equal(pool.getStats().recycledForDeath, 12);
    assert.ok(pool.active.every(particle => originals.has(particle)));
    pool.update(35);
    assert.equal(pool.active.length, 0);
    assert.equal(pool.free.length, 64);
    pool.spawn(10, 20, '#ff4444', 60, 'death');
    assert.equal(pool.active.length, 60);
    assert.ok(pool.active.every(particle => originals.has(particle)));
});

test('both offline pools are prepared and reused between floors', () => {
    const { Game, ParticlePool } = poolClasses();
    const game = Object.create(Game.prototype);
    game.enemyProjectilePool = null;
    game.enemyBullets = [];
    game.particlePool = null;
    game.particles = [];
    game.preparePoolsForFloor();
    assert.equal(game.enemyProjectilePool.capacity, 512);
    assert.equal(game.particlePool.capacity, ParticlePool.CAPACITY);
    const projectilePool = game.enemyProjectilePool;
    const particlePool = game.particlePool;
    game.spawnParticles(1, 2, '#f00', 8, 'death');
    game.preparePoolsForFloor();
    assert.equal(game.enemyProjectilePool, projectilePool);
    assert.equal(game.particlePool, particlePool);
    assert.equal(game.particlePool.active.length, 0);
    assert.equal(game.particlePool.free.length, ParticlePool.CAPACITY);
});

test('co-op snapshots carry each death once and clear old events on the next floor', () => {
    const run = Simulation.createRun([
        { id: 'one', name: 'Uno', character: 'pistolero' },
        { id: 'two', name: 'Dos', character: 'tirador' }
    ]);
    const encounter = [...run.preparedEnemiesByRoom.values()].find(enemies => enemies.length);
    assert.ok(encounter, 'the floor needs one prepared enemy');
    const enemy = encounter[0];
    run.enemies.push(enemy);
    enemy.alive = false;
    Simulation.stepRun(run, new Map());
    const first = Simulation.snapshot(run).deathEffects;
    assert.equal(first.length, 1);
    assert.equal(first[0].id, enemy.id);
    assert.equal(first[0].type, enemy.type);
    Simulation.stepRun(run, new Map());
    assert.equal(Simulation.snapshot(run).deathEffects.length, 1);
    const projectilePool = run.enemyProjectilePool;
    run.phase = 'loading';
    run.nextFloorPending = true;
    assert.equal(Simulation.completeFloorTransition(run), true);
    assert.equal(Simulation.snapshot(run).deathEffects.length, 0);
    assert.equal(run.enemyProjectilePool, projectilePool);
    assert.ok(run.enemyProjectilePool.capacity >= 512);
});
