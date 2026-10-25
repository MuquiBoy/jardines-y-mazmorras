'use strict';

// Run the original Abyss Engine gameplay classes in a headless VM. The server
// owns these objects; browsers receive state snapshots for rendering only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const context = vm.createContext({ console });
for (const file of ['palette.js', 'characters/roles.js', 'bullet.js', 'player.js', 'enemy.js', 'map.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
}
const Engine = vm.runInContext('({ DungeonMap, Player, BasicEnemy, ShooterEnemy, SpiralEnemy, BossEnemy, createEnemy, difficultyForFloor, circleCollision })', context);
const ENEMY_CLASSES = { basic: Engine.BasicEnemy, shooter: Engine.ShooterEnemy, spiral: Engine.SpiralEnemy, boss: Engine.BossEnemy };

function newPlayer(member, x, y) {
    const player = new Engine.Player(x, y);
    player.id = member.id;
    player.name = member.name;
    player.setCharacter(member.character);
    return player;
}

function generateFloor(run) {
    const map = new Engine.DungeonMap(7000, 7000);
    map.generate();
    run.map = map;
    run.enemies = [];
    run.playerBullets = [];
    run.enemyBullets = [];
    run.visitedRooms = new Set([0]);
    run.floor++;
    const start = map.playerStart;
    const players = [...run.players.values()].filter(p => p.health > 0);
    players.forEach((player, i) => {
        const offset = (i - (players.length - 1) / 2) * 30;
        player.x = start.x + offset;
        player.y = start.y;
        player.invincibleTimer = 45;
    });
    run.mapVersion++;
}

function createRun(members) {
    const run = { floor: 0, players: new Map(), enemies: [], playerBullets: [], enemyBullets: [], visitedRooms: new Set(), mapVersion: 0, phase: 'playing', tick: 0 };
    for (const member of members) run.players.set(member.id, newPlayer(member, 0, 0));
    generateFloor(run);
    return run;
}

function spawnRoom(run, room, player) {
    const roomIndex = run.map.rooms.indexOf(room);
    if (roomIndex < 0 || run.visitedRooms.has(roomIndex)) return;
    run.visitedRooms.add(roomIndex);
    const enemies = run.map.getEnemiesForRoom(room, player, 280, run.floor);
    for (const enemy of enemies) {
        enemy.applyDifficulty(Engine.difficultyForFloor(run.floor), run.floor);
        enemy.id = crypto.randomUUID();
        enemy.roomIndex = roomIndex;
        run.enemies.push(enemy);
    }
    if (room.type === 'treasure') {
        const reward = run.map.getTreasureForRoom(room);
        for (const member of run.players.values()) member.heal(reward.heal);
    }
    run.mapVersion++;
}

function stepRun(run, inputs) {
    if (!run || run.phase !== 'playing') return;
    run.tick++;
    const players = [...run.players.values()];
    for (const player of players) {
        if (player.health <= 0) continue;
        const input = inputs.get(player.id) || { moveX: 0, moveY: 0, aimX: player.aimX, aimY: player.aimY, fire: false };
        const gameInput = { keys: {}, moveX: input.moveX, moveY: input.moveY, aimX: input.aimX, aimY: input.aimY, aimActive: true, mouseDown: input.fire };
        if (player.update(gameInput, null, run.map)) {
            for (const bullet of player.shoot()) {
                bullet.ownerId = player.id;
                run.playerBullets.push(bullet);
            }
        }
        const room = run.map.getCurrentRoom(player.x, player.y);
        if (room) spawnRoom(run, room, player);
        if (run.map.exit && Math.hypot(player.x - run.map.exit.x, player.y - run.map.exit.y) < player.radius + 20) {
            generateFloor(run);
            return;
        }
    }

    const targets = players.filter(p => p.health > 0);
    if (targets.length) for (const enemy of run.enemies) {
        if (!enemy.alive) continue;
        let target = targets[0], best = Infinity;
        for (const player of targets) {
            const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
            if (distance < best) { target = player; best = distance; }
        }
        const bullets = enemy.update(target, run.enemies, run.map);
        if (bullets) run.enemyBullets.push(...bullets);
    }

    const keptPlayerBullets = [];
    for (const bullet of run.playerBullets) {
        bullet.x += bullet.vx; bullet.y += bullet.vy;
        let hit = false;
        for (const enemy of run.enemies) {
            if (!enemy.alive || !Engine.circleCollision(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius)) continue;
            enemy.takeDamage(bullet.damage); hit = true;
            if (!enemy.alive && enemy.type === 'boss') {
                run.map.openExit(run.map.rooms[enemy.roomIndex], { x: enemy.x, y: enemy.y });
                run.mapVersion++;
            }
            break;
        }
        if (!hit && bullet.x > -50 && bullet.x < run.map.width + 50 && bullet.y > -50 && bullet.y < run.map.height + 50) keptPlayerBullets.push(bullet);
    }
    run.playerBullets = keptPlayerBullets;

    const keptEnemyBullets = [];
    for (const bullet of run.enemyBullets) {
        bullet.x += bullet.vx; bullet.y += bullet.vy;
        if (!run.map.isWalkable(bullet.x, bullet.y)) continue;
        const target = targets.find(p => Engine.circleCollision(bullet.x, bullet.y, bullet.radius, p.x, p.y, p.radius));
        if (target) target.takeDamage(bullet.damage);
        else if (bullet.x > -50 && bullet.x < run.map.width + 50 && bullet.y > -50 && bullet.y < run.map.height + 50) keptEnemyBullets.push(bullet);
    }
    run.enemyBullets = keptEnemyBullets;

    run.enemies = run.enemies.filter(enemy => enemy.alive);
    for (const room of run.map.rooms) {
        const roomIndex = run.map.rooms.indexOf(room);
        if (!room.cleared && run.visitedRooms.has(roomIndex) && ['combat', 'combat-hard', 'boss'].includes(room.type) &&
            !run.enemies.some(enemy => enemy.roomIndex === roomIndex)) {
            run.map.clearRoom(room);
            run.mapVersion++;
        }
    }
    if (!targets.length) run.phase = 'ended';
}

function mapState(map) {
    const roomIndex = room => room ? map.rooms.indexOf(room) : -1;
    return {
        width: map.width, height: map.height, tileSize: map.tileSize, corridorWidth: map.corridorWidth,
        rooms: map.rooms.map(room => ({ ...room, parent: roomIndex(room.parent) })),
        corridors: map.corridors.map(c => ({ a: roomIndex(c.a), b: roomIndex(c.b), x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 })),
        corridorRects: map.corridorRects,
        bossRoom: roomIndex(map.bossRoom), exit: map.exit ? { x: map.exit.x, y: map.exit.y, room: roomIndex(map.exit.room) } : null,
        playerStart: map.playerStart, roomsCleared: map.roomsCleared, totalRooms: map.totalRooms
    };
}

function playerState(player) {
    return Object.fromEntries(['id','name','character','x','y','radius','maxHealth','health','speed','damage','fireRate','bulletSpeed','bulletCount','bulletPierce','magnetRange','level','xp','fireTimer','invincibleTimer','aimX','aimY'].map(key => [key, player[key]]));
}
function enemyState(enemy) {
    return Object.fromEntries(['id','type','roomIndex','x','y','health','maxHealth','speed','damage','radius','color','xpValue','shootCooldown','shootTimer','bulletSpeedScale','alive','deathTimer','angle','phase','phaseTimer','phaseDuration','centerX','centerY','driftAngle','spiralAngle'].filter(key => enemy[key] !== undefined).map(key => [key, enemy[key]]));
}
function bulletState(bullet) {
    return Object.fromEntries(['x','y','vx','vy','damage','pierce','hits','radius','color','ownerId'].filter(key => bullet[key] !== undefined).map(key => [key, bullet[key]]));
}
function snapshot(run) {
    return { phase: run.phase, floor: run.floor, tick: run.tick, mapVersion: run.mapVersion, map: mapState(run.map),
        players: [...run.players.values()].map(playerState), enemies: run.enemies.map(enemyState),
        playerBullets: run.playerBullets.map(bulletState), enemyBullets: run.enemyBullets.map(bulletState) };
}

module.exports = { createRun, stepRun, snapshot };
