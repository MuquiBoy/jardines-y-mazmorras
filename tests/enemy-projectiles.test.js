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
    projectile.hits = 99;
    projectile.pierce = 2;
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
    assert.equal(reused.hits, 0);
    assert.equal(reused.pierce, 0);
    assert.equal('ignorePlayerId' in reused, false);
    assert.equal('ignoreFrames' in reused, false);
    assert.equal(reused.burn, null);
    assert.equal(reused.ownerId, 'new-owner');
    assert.equal(Simulation.getProjectilePoolStats(run).active, 1);
});

test('Bastión pierde el daño completo y los proyectiles terminan al impactar en cooperativo', () => {
    const run = Simulation.createRun(membersFor(2));
    const [pistolero, bastion] = [...run.players.values()];
    assert.equal(bastion.maxHealth, 36);
    assert.equal(bastion.grayHealth, 12);
    assert.equal(bastion.health, 48);

    const inputs = new Map([pistolero, bastion].map(player => [player.id, {
        moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false, reload: false
    }]));
    for (const damage of [6, 12]) {
        const before = [pistolero.health, bastion.health];
        for (const player of [pistolero, bastion]) {
            player.invincibleTimer = 0;
            const bullet = run.enemyProjectilePool.acquire({
                id: 'damage-check', x: player.x, y: player.y, type: 'basic', color: '#f00'
            }, 0, 0);
            bullet.damage = damage;
            run.enemyBullets.push(bullet);
        }
        Simulation.stepRun(run, inputs);
        assert.equal(pistolero.health, before[0] - damage);
        assert.equal(bastion.health, before[1] - damage);
        assert.equal(run.enemyBullets.length, 0);
        assert.equal(Simulation.getProjectilePoolStats(run).active, 0);
        if (damage === 6) {
            assert.equal(bastion.grayHealth, 6);
            assert.equal(bastion.bastionForm, 'calabaza-blindada');
        }
    }
    assert.equal(bastion.grayHealth, 0);
    assert.equal(bastion.permanentHealth, 30);
    assert.equal(bastion.bastionForm, 'bastion-debil');

    run.phase = 'loading';
    run.nextFloorPending = true;
    assert.equal(Simulation.completeFloorTransition(run), true);
    assert.equal(bastion.grayHealth, 12);
    assert.equal(bastion.permanentHealth, 30);
    assert.equal(bastion.bastionForm, 'calabaza-blindada');
});

test('Bastión elige la animación según el umbral exacto del corazón gris', () => {
    const run = Simulation.createRun([{ id: 'form-check', name: 'Bastión', character: 'bastion' }]);
    const player = run.players.get('form-check');
    const Player = player.constructor;
    const armoredFrame = { form: 'armored' };
    const weakFrame = { form: 'weak' };
    Player.animations.bastion = { frames: [armoredFrame], durations: [100], totalDuration: 100 };
    Player.animations['bastion:debil'] = { frames: [weakFrame], durations: [100], totalDuration: 100 };

    for (const { grayHealth, expectedForm, expectedFrame } of [
        { grayHealth: 12, expectedForm: 'calabaza-blindada', expectedFrame: armoredFrame },
        { grayHealth: 1, expectedForm: 'calabaza-blindada', expectedFrame: armoredFrame },
        { grayHealth: 0, expectedForm: 'bastion-debil', expectedFrame: weakFrame },
        { grayHealth: 1, expectedForm: 'calabaza-blindada', expectedFrame: armoredFrame }
    ]) {
        player.grayHealth = grayHealth;
        player.health = player.maxHealth + grayHealth;
        player.updateBastionForm();
        assert.equal(player.bastionForm, expectedForm);
        assert.equal(Player.walkFrameFor('bastion', 0, player.bastionForm), expectedFrame);
    }
});

test('el HUD muestra un corazón gris de Bastión y lo retira al agotarse', () => {
    const context = vm.createContext({ console });
    for (const file of ['js/characters/roles.js', 'js/player.js', 'js/ui.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    const Player = vm.runInContext('Player', context);
    const UI = vm.runInContext('UI', context);
    const player = new Player(0, 0);
    player.setCharacter('bastion');
    const ui = Object.create(UI.prototype);
    Object.assign(ui, {
        hpHearts: { innerHTML: '', setAttribute() {} },
        hpText: { textContent: '' }, xpBar: { style: {} },
        xpText: { textContent: '' }, ammoText: { textContent: '' },
        statsDisplay: { textContent: '' }
    });
    const visibleHearts = () => ({
        red: (ui.hpHearts.innerHTML.match(/health-heart red/g) || []).length,
        gray: (ui.hpHearts.innerHTML.match(/health-heart gray/g) || []).length
    });

    ui.updateHUD(player);
    assert.deepEqual(visibleHearts(), { red: 3, gray: 1 });
    player.takeDamage(12);
    ui.updateHUD(player);
    assert.deepEqual(visibleHearts(), { red: 3, gray: 0 });
    assert.equal(player.bastionForm, 'bastion-debil');
    player.restoreGrayHeartForNextFloor();
    ui.updateHUD(player);
    assert.deepEqual(visibleHearts(), { red: 3, gray: 1 });
    assert.equal(player.bastionForm, 'calabaza-blindada');
});

test('Bastión pierde el daño completo y los proyectiles terminan al impactar en solitario', () => {
    const context = vm.createContext({ console });
    for (const file of ['js/palette.js', 'js/characters/roles.js', 'js/bullet.js',
        'js/enemy-projectile-pool.js', 'js/player.js', 'js/game.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    const Player = vm.runInContext('Player', context);
    const Pool = vm.runInContext('EnemyProjectilePool', context);
    const Game = vm.runInContext('Game', context);

    for (const role of ['pistolero', 'bastion']) {
        const player = new Player(500, 500);
        player.setCharacter(role);
        const pool = new Pool(2, 2);
        const game = Object.create(Game.prototype);
        Object.assign(game, {
            player, enemyProjectilePool: pool, enemyBullets: [], summons: [],
            map: { isWalkable: () => true, width: 1000, height: 1000 },
            spawnParticles: () => {}, addImpact: () => {}, audio: { playerHurt: () => {} }
        });
        for (const damage of [6, 12]) {
            const before = player.health;
            player.invincibleTimer = 0;
            const bullet = pool.acquire({ id: 'solo-damage-check', x: 500, y: 500,
                type: 'basic', color: '#f00' }, 0, 0);
            bullet.damage = damage;
            game.enemyBullets.push(bullet);
            game.updateEnemyBullets();
            assert.equal(player.health, before - damage);
            assert.equal(game.enemyBullets.length, 0);
            assert.equal(pool.getStats().active, 0);
        }
    }
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
