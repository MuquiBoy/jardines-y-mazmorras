'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Simulation = require('../server/simulation');

const membersFor = count => Array.from({ length: count }, (_, index) => ({
    id: `projectile-test-${count}-${index}`,
    name: `Test ${index + 1}`,
    character: index ? 'bastion' : 'pistolero'
}));

function armRoomWithMinions(run, players) {
    const room = run.map.rooms.find(candidate => candidate.type === 'combat');
    assert.ok(room, 'generated floor should have an ordinary combat room');
    const roomIndex = run.map.rooms.indexOf(room);
    players.forEach((player, index) => {
        player.x = room.cx + (index ? 30 : 0);
        player.y = room.cy;
        player.invincibleTimer = 600;
    });
    run.visitedRooms.add(roomIndex);

    const enemies = run.map.getEnemiesForRoom(room, players[0], 280, run.floor);
    assert.ok(enemies.length > 0, 'ordinary combat room should spawn minions');
    for (let index = 0; index < enemies.length; index++) {
        const enemy = enemies[index];
        enemy.id = `enemy-projectile-${index}`;
        enemy.roomIndex = roomIndex;
        enemy.shootTimer = 1;
    }
    run.enemies.push(...enemies);
}

for (const playerCount of [1, 2]) {
    test(`${playerCount === 1 ? 'solo' : 'coop'} simulation pools only enemy bullets and snapshots the standard sprite`, () => {
        const run = Simulation.createRun(membersFor(playerCount));
        const players = [...run.players.values()];
        armRoomWithMinions(run, players);

        const poolBeforePlayerShot = Simulation.getProjectilePoolStats(run);
        for (const player of players) {
            player.aimX = 1;
            player.aimY = 0;
            const playerShots = player.shoot();
            assert.ok(playerShots.length > 0, 'player retains their existing weapon shot');
            assert.ok(playerShots.every(shot => shot.visualType === undefined),
                'player shots must not receive the enemy projectile visual metadata');
            assert.ok(playerShots.every(shot => shot._poolOwner === undefined),
                'player shots must stay outside the enemy projectile pool');
            run.playerBullets.push(...playerShots);
        }
        assert.equal(Simulation.getProjectilePoolStats(run).active, poolBeforePlayerShot.active,
            'firing player weapons must not consume enemy pool objects');

        const inputs = new Map(players.map(player => [player.id, {
            moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false, reload: false
        }]));
        Simulation.stepRun(run, inputs);

        const snapshot = Simulation.snapshot(run);
        assert.equal(snapshot.players.length, playerCount);
        assert.ok(snapshot.enemyBullets.length > 0, 'at least one minion should fire during the simulated tick');
        assert.ok(snapshot.enemyBullets.every(bullet => bullet.radius === 4));
        assert.ok(snapshot.enemyBullets.every(bullet => bullet.visualType === 'enemy-standard'));
        assert.ok(snapshot.playerBullets.every(bullet => bullet.visualType === undefined),
            'player bullets keep their existing rendering path');

        const stats = Simulation.getProjectilePoolStats(run);
        assert.equal(stats.initialCapacity, 512);
        assert.equal(stats.capacity, 512);
        assert.equal(stats.active, run.enemyBullets.length);
        assert.equal(stats.emergencyExpansions, 0, 'normal solo/coop volley must fit the initial pool');
        assert.equal(stats.requestsWithoutFree, 0);
    });
}

test('enemy pool reuses released projectiles without carrying old state', () => {
    const run = Simulation.createRun(membersFor(1));
    const projectile = run.enemyProjectilePool.acquire({
        id: 'recycle-me', x: 120, y: 140, color: '#fff', type: 'basic', projectileVisualType: 'enemy-standard'
    }, 0, 1.5);
    projectile.ignorePlayerId = 'stale-target';
    projectile.burn = { damage: 99 };
    assert.equal(projectile.radius, 4);
    assert.equal(projectile.visualType, 'enemy-standard');

    assert.equal(run.enemyProjectilePool.release(projectile), true);
    const reused = run.enemyProjectilePool.acquire({
        id: 'new-owner', x: 220, y: 240, color: '#f00', type: 'basic'
    }, Math.PI / 2, 2);
    assert.equal(reused, projectile);
    assert.equal(reused.radius, 4);
    assert.equal(reused.visualType, 'enemy-standard');
    assert.equal(reused.ignorePlayerId, null);
    assert.equal(reused.burn, null);
    assert.equal(reused.ownerId, 'new-owner');
    assert.equal(Simulation.getProjectilePoolStats(run).active, 1);
});

test('standard enemy projectile renders a cached 10px Aseprite frame with smoothing disabled', () => {
    const root = path.resolve(__dirname, '..');
    const context = vm.createContext({ Math, Date });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/enemy-projectile-pool.js'), 'utf8'), context,
        { filename: 'js/enemy-projectile-pool.js' });
    const Pool = vm.runInContext('EnemyProjectilePool', context);
    const frame = { frame: 0 };
    Pool.spriteAnimations['enemy-standard'] = { frames: [frame], durations: [100], totalDuration: 100 };
    const calls = [];
    const ctx = {
        imageSmoothingEnabled: true,
        save() { calls.push(['save']); },
        restore() { calls.push(['restore']); },
        drawImage(...args) { calls.push(['drawImage', ...args]); }
    };

    Pool.draw(ctx, { x: 30, y: 50, visualType: 'enemy-standard' }, 1250);
    assert.equal(ctx.imageSmoothingEnabled, false);
    const draw = calls.find(call => call[0] === 'drawImage');
    assert.deepEqual(draw, ['drawImage', frame, 25, 45, 10, 10]);
});
