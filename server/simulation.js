'use strict';

// Run the original Abyss Engine gameplay classes in a headless VM. The server
// owns these objects; browsers receive state snapshots for rendering only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { loadTemplateCatalog } = require('./template-catalog');
const TEMPLATE_ROOT = path.join(__dirname, '..', 'assets', 'plantillas-salas');

function refreshTemplateCatalog() {
    context.RoomTemplateLibrary = loadTemplateCatalog(TEMPLATE_ROOT);
}

const context = vm.createContext({ console });
context.RoomTemplateLibrary = loadTemplateCatalog(TEMPLATE_ROOT);
for (const file of [
    'palette.js',
    'camera.js',
    'upgrades.js',
    'characters/roles.js',
    'bullet.js',
    'enemy-projectile-pool.js',
    'player.js',
    'enemy.js',
    'enemies/esbirros/basic-enemy.js',
    'enemies/esbirros/mosca-tirador.js',
    'enemies/esbirros/spiral-enemy.js',
    'enemies/mini-jefes/cochinilla_esquinero/cochinilla_esquinero.js',
    'enemies/mini-jefes/babosa_persecucion/babosa_persecucion.js',
    'enemies/catalog.js',
    'map.js'
]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
}
const Engine = vm.runInContext('({ Enemy, DungeonMap, Player, SummonedUnit, BasicEnemy, MoscaTirador, SpiralEnemy, BossEnemy, CochinillaEsquinero, BabosaPersecucion, EnemyProjectilePool, ENEMY_CLASSES, ENEMY_CATEGORY, ENEMY_TYPES_BY_CATEGORY, ENEMY_CATEGORIES_BY_ROOM, enemyCategoriesForRoom, enemyCategoryForType, enemyTypeAllowedInRoom, createEnemy, randomEnemyType, randomMiniBossType, hardEnemyType, circleCollision, ricochetEnemyBulletTowardParty, bulletBlockedByMap, selectPartySpectatorTargetId, UPGRADE_DEFS })', context);
const ENEMY_CLASSES = Engine.ENEMY_CLASSES;

// Co-op room-clear revive tuning. The server remains authoritative.
const COOP_RESPAWN_HEALTH_RATIO = 0.5;
const COOP_RESPAWN_INVINCIBILITY_FRAMES = 60;

function newPlayer(member, x, y) {
    const player = new Engine.Player(x, y);
    player.id = member.id;
    player.name = member.name;
    player.setCharacter(member.character);
    player.pendingLevelUps = 0;
    return player;
}

function rememberDownedPlayers(run) {
    if (run.players.size < 2) return;
    for (const player of run.players.values()) {
        if (player.health > 0 || player.deathPosition) continue;
        const room = run.map.pointInRoom(player.x, player.y);
        player.deathPosition = {
            x: player.x, y: player.y, floor: run.floor,
            roomIndex: room ? run.map.rooms.indexOf(room) : -1
        };
        player.cancelSniperAim?.();
    }
}

function reviveDownedPlayers(run) {
    if (run.players.size < 2) return 0;
    const livingPlayers = [...run.players.values()].filter(player => player.health > 0);
    if (!livingPlayers.length) return 0;

    let revived = 0;
    for (const player of run.players.values()) {
        if (player.health > 0) continue;
        const death = player.deathPosition || { x: player.x, y: player.y, floor: run.floor };
        player.x = death.x;
        player.y = death.y;
        player.teleportTick = run.tick;
        player.grayHealth = 0;
        player.health = Math.max(1, Math.ceil((player.maxHealth || 100) * COOP_RESPAWN_HEALTH_RATIO));
        player.invincibleTimer = COOP_RESPAWN_INVINCIBILITY_FRAMES;
        player.turretActive = false;
        player.cancelSniperAim?.();
        player.deathPosition = null;
        revived++;
    }
    return revived;
}

/**
 * Enemy-kill XP is gated by the shared Enemy flag. The guard makes any bounty
 * idempotent when a death is observed by more than one system (burn tick,
 * bullet pass, summon contact).
 */
function awardKill(run, enemy, ownerId) {
    if (!Engine.Enemy.ENEMY_XP_REWARDS_ENABLED || !enemy || enemy.xpAwarded || !ownerId || !(enemy.xpValue > 0)) return;
    const player = run.players.get(ownerId);
    if (!player || player.health <= 0) return;
    enemy.xpAwarded = true;
    player.pendingLevelUps = (player.pendingLevelUps || 0) + player.gainXP(enemy.xpValue);
}

function generateFloor(run) {
    refreshTemplateCatalog(); // rescans the author folders once per floor
    const nextFloor = run.floor + 1;
    const map = new Engine.DungeonMap(14000, 14000);
    map.generate(nextFloor);
    // Release this run's previous-floor cache before preparing exactly one new floor.
    run.preparedEnemiesByRoom?.clear();
    run.preparedEnemiesByRoom = new Map();
    run.map = map;
    run.enemies = [];
    run.playerBullets = [];
    run.enemyProjectilePool.releaseAll(run.enemyBullets);
    run.summons = [];
    run.notices = [];
    run.visitedRooms = new Set([0]);
    run.floor = nextFloor;
    const start = map.playerStart;
    const players = [...run.players.values()].filter(p => p.health > 0);
    players.forEach((player, i) => {
        const offset = (i - (players.length - 1) / 2) * 30;
        player.x = start.x + offset;
        player.y = start.y;
        player.invincibleTimer = 45;
    });
    run.preparedEnemiesByRoom = map.prepareEnemiesForFloor(nextFloor);
    for (const enemies of run.preparedEnemiesByRoom.values()) {
        for (const enemy of enemies) enemy.id = crypto.randomUUID();
    }
    run.mapVersion++;
}

function createRun(members, reusableProjectilePool = null) {
    const run = { floor: 0, players: new Map(), enemies: [], playerBullets: [], enemyBullets: [],
        enemyProjectilePool: reusableProjectilePool || new Engine.EnemyProjectilePool(), summons: [], notices: [],
        visitedRooms: new Set(), mapVersion: 0, phase: 'playing', tick: 0, spectatorTargetId: null, roomCompletionPending: false };
    run.enemyProjectilePool.releaseAll(run.enemyBullets);
    run.enemyProjectilePool.resetRunStats();
    for (const member of members) run.players.set(member.id, newPlayer(member, 0, 0));
    generateFloor(run);
    return run;
}

function spawnEnemiesForRoom(run, room, player) {
    const roomIndex = run.map.rooms.indexOf(room);
    const enemies = run.preparedEnemiesByRoom.get(roomIndex) || [];
    run.preparedEnemiesByRoom.delete(roomIndex);
    for (const enemy of enemies) {
        enemy.roomIndex = roomIndex;
        run.enemies.push(enemy);
    }
    room.spawnWarningTimer = 0;
    room.spawnWarningMarkers = [];
    room.spawned = true;
}

function beginRoomSpawnWarning(run, room) {
    if (!room || room.spawned || room.spawnWarningTimer > 0) return;
    const roomIndex = run.map.rooms.indexOf(room);
    const enemies = run.preparedEnemiesByRoom.get(roomIndex) || [];
    if (!enemies.length) {
        spawnEnemiesForRoom(run, room);
        return;
    }
    room.spawnWarningTimer = 36; // 0.6 s at 60 Hz
    room.spawnWarningMarkers = enemies.map(enemy => ({ x: enemy.x, y: enemy.y }));
}

function spawnRoom(run, room, player) {
    const roomIndex = run.map.rooms.indexOf(room);
    if (roomIndex < 0 || run.visitedRooms.has(roomIndex)) return;
    run.visitedRooms.add(roomIndex);
    if (['combat', 'combat-simple', 'combat-hard', 'boss'].includes(room.type) && !room.cleared) {
        // Arm the encounter instead of spawning now. The room closes first
        // (updateRoomLocks), then the enemies appear behind sealed doors.
        // The boss hall seals exactly like a combat room; its doors reopen
        // through onBossDefeated() the moment the boss dies.
        room.lockPending = true;
        room.triggerPlayerId = player.id;
        run.mapVersion++;
        return;
    }
    spawnEnemiesForRoom(run, room, player);
    if (room.type === 'treasure') {
        const reward = run.map.getTreasureForRoom(room);
        for (const member of run.players.values()) {
            if (member.health <= 0) continue;
            member.heal(reward.heal);
            member.pendingLevelUps = (member.pendingLevelUps || 0) + member.gainXP(reward.xp);
        }
        run.notices.push({
            id: crypto.randomUUID(),
            text: `¡Sala del tesoro! +${reward.heal} HP, +${reward.xp} XP`,
            tick: run.tick
        });
    }
    run.mapVersion++;
}

/**
 * Bring the whole living party into a room that just sealed.
 *
 * The player who triggered the fight is the anchor: anyone still outside is
 * placed on the nearest collision-free cell around them. Enemy spawns happen
 * after this call, so teleported bodies can never land on an enemy.
 */
function teleportPartyIntoRoom(run, room, anchor) {
    const alive = [...run.players.values()].filter(player => player.health > 0);
    const placed = alive.filter(player => run.map.pointInRoom(player.x, player.y) === room);
    for (const player of alive) {
        if (run.map.pointInRoom(player.x, player.y) === room) continue;
        // Someone already fighting elsewhere keeps their fight: pulling them
        // out would leave that sealed room with enemies and nobody to clear it.
        const otherRoom = run.map.pointInRoom(player.x, player.y);
        const otherIndex = otherRoom ? run.map.rooms.indexOf(otherRoom) : -1;
        if (otherIndex >= 0 && run.enemies.some(enemy => enemy.alive && enemy.roomIndex === otherIndex)) continue;
        const radius = player.radius || 14;
        const spot = run.map.findFreeSpotNear(anchor.x, anchor.y, radius, placed, 900, room) ||
                     run.map.findFreeSpotNear(anchor.x, anchor.y, radius, [], 900, room);
        if (!spot) continue;
        player.x = spot.x;
        player.y = spot.y;
        player.teleportTick = run.tick;
        placed.push(player);
    }
}

function updateRoomLocks(run) {
    const players = [...run.players.values()].filter(player => player.health > 0);
    const blockers = [
        ...run.enemies.filter(enemy => enemy.alive),
        ...run.summons.filter(summon => summon.alive && summon.health > 0)
    ];
    // All enemies in the room leave the dormant cache on one shared tick.
    for (const room of run.map.rooms) {
        if (!(room.spawnWarningTimer > 0)) continue;
        room.spawnWarningTimer--;
        if (room.spawnWarningTimer <= 0) spawnEnemiesForRoom(run, room);
    }
    for (const room of run.map.rooms) {
        if (!room.lockPending || room.locked || room.cleared) continue;
        if (!run.map.canLockRoom(room, players, blockers)) continue;
        run.map.lockRoom(room);
        const inside = players.filter(player => run.map.pointInRoom(player.x, player.y) === room);
        const anchor = inside.find(player => player.id === room.triggerPlayerId) || inside[0];
        if (anchor) teleportPartyIntoRoom(run, room, anchor);
        if (!room.spawned) beginRoomSpawnWarning(run, room);
        run.mapVersion++;
    }
}

/**
 * The boss encounter is over: release its doors and open the way out.
 *
 * Every death path (summon, burn, bullet) funnels through this helper so a
 * sealed boss hall can never stay closed by accident. The room is marked
 * cleared immediately, even if minions are still alive, because the exit is
 * unlocked by the boss's death specifically.
 */
function onBossDefeated(run, room, origin) {
    const bossRoom = room || run.map.bossRoom;
    if (!bossRoom) return;
    run.map.clearRoom(bossRoom);
    run.roomCompletionPending = true;
    run.map.openExit(bossRoom, origin || { x: bossRoom.cx, y: bossRoom.cy });
    run.mapVersion++;
}

function stepRun(run, inputs) {
    if (!run || run.phase !== 'playing') return;
    run.tick++;
    // Notices only exist to be shown once by each client. Keep the snapshot
    // small without assuming the clients have already consumed them.
    if (run.notices?.length) run.notices = run.notices.filter(notice => run.tick - notice.tick < 300);
    const players = [...run.players.values()];
    for (const player of players) {
        if (player.health <= 0) { player.cancelSniperAim?.(); continue; }
        const input = inputs.get(player.id) || { moveX: 0, moveY: 0, aimX: player.aimX, aimY: player.aimY, fire: false, reload: false };
        // Presentation-only reticle radius; never consulted by combat or shooting.
        player.aimPointerDistance = Math.max(40, Math.min(120,
            Number.isFinite(input.aimPointerDistance) ? input.aimPointerDistance : (player.aimPointerDistance ?? 80)));
        const gameInput = { keys: { KeyR: input.reload }, moveX: input.moveX, moveY: input.moveY,
            aimX: input.aimX, aimY: input.aimY, aimActive: true, mouseDown: input.fire, mousePressed: !!input.firePressed,
            mouseReleased: !!input.fireReleased, cancelAim: !!input.cancelAim, reload: input.reload };
        const shouldShoot = player.update(gameInput, null, run.map);
        input.firePressed = false; input.fireReleased = false; input.cancelAim = false;
        if (shouldShoot) {
            if (player.weaponKind === 'summoner') {
                const x = player.x + player.aimX * (player.radius + 15);
                const y = player.y + player.aimY * (player.radius + 15);
                const ownerSummons = run.summons.filter(summon => summon.ownerId === player.id && summon.alive && summon.lifetime > 0);
                const summonLimit = player.summon?.maxActive ?? 6;
                if (ownerSummons.length >= summonLimit) {
                    const oldestIndex = run.summons.indexOf(ownerSummons[0]);
                    if (oldestIndex >= 0) run.summons.splice(oldestIndex, 1);
                }
                run.summons.push(new Engine.SummonedUnit(crypto.randomUUID(), player.id, x, y, player.summon));
            } else {
                for (const bullet of player.shoot()) {
                    bullet.ownerId = player.id;
                    run.playerBullets.push(bullet);
                }
            }
        }
        const room = run.map.getCurrentRoom(player.x, player.y);
        if (room) spawnRoom(run, room, player);
        if (run.map.exit && Math.hypot(player.x - run.map.exit.x, player.y - run.map.exit.y) < player.radius + 20) {
            run.phase = 'loading';
            run.nextFloorPending = true;
            return;
        }
    }

    updateRoomLocks(run);

    for (const summon of run.summons) {
        const hit = summon.update(run.enemies, run.map);
        if (hit && !hit.alive) {
            awardKill(run, hit, summon.ownerId);
            if (hit.type === 'boss') onBossDefeated(run, run.map.rooms[hit.roomIndex], { x: hit.x, y: hit.y });
        }
    }
    run.summons = run.summons.filter(summon => summon.alive && summon.lifetime > 0);

    for (const enemy of run.enemies) {
        if (!enemy.alive || !enemy.updateBurn()) continue;
        if (!enemy.alive) {
            awardKill(run, enemy, enemy.burnOwnerId);
            if (enemy.type === 'boss') {
                onBossDefeated(run, run.map.rooms[enemy.roomIndex], { x: enemy.x, y: enemy.y });
            }
        }
    }

    const livingPlayers = players.filter(p => p.health > 0);
    const targets = [...livingPlayers, ...run.summons.filter(s => s.alive)];
    if (targets.length) for (const enemy of run.enemies) {
        if (!enemy.alive) continue;
        let target = targets[0], best = Infinity;
        for (const candidate of targets) {
            const distance = Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y);
            if (distance < best) { target = candidate; best = distance; }
        }
        if (enemy instanceof Engine.CochinillaEsquinero) {
            const bullets = enemy.update ? enemy.update(target, run.enemies, run.map, targets, run.enemyProjectilePool) : null;
            if (bullets && Array.isArray(bullets)) run.enemyBullets.push(...bullets);
            // Authoritative laser damage: 6 HP per simulation tick of contact.
            // The client only replays snapshots, so nothing is applied twice.
            if (enemy.laserDamageFor) {
                for (const player of players) {
                    if (player.health <= 0 || player.invincibleTimer > 0) continue;
                    const dmg = enemy.laserDamageFor(player);
                    if (dmg > 0) player.takeDamage(dmg);
                }
            }
            continue;
        }
        const bullets = enemy.update(target, run.enemies, run.map, targets, run.enemyProjectilePool);
        if (enemy instanceof Engine.BabosaPersecucion) enemy.resolvePlayerContacts(livingPlayers, run.map);
        if (bullets && Array.isArray(bullets)) run.enemyBullets.push(...bullets);
    }

    const keptPlayerBullets = [];
    for (const bullet of run.playerBullets) {
        bullet.x += bullet.vx; bullet.y += bullet.vy;
        bullet.travelled = (bullet.travelled || 0) + Math.hypot(bullet.vx, bullet.vy);
        // Walls and blue obstacles stop player shots exactly like enemy shots.
        if (Engine.bulletBlockedByMap(run.map, bullet)) continue;
        let hit = false;
        for (const enemy of run.enemies) {
            if (!enemy.alive || !Engine.circleCollision(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius)) continue;
            enemy.takeDamage(bullet.damage);
            if (bullet.burn) enemy.applyBurn({ ...bullet.burn, ownerId: bullet.ownerId });
            hit = true;
            if (!enemy.alive) {
                awardKill(run, enemy, bullet.ownerId);
                if (enemy.type === 'boss') {
                    onBossDefeated(run, run.map.rooms[enemy.roomIndex], { x: enemy.x, y: enemy.y });
                }
            }
            break;
        }
        const withinRange = !bullet.range || bullet.travelled < bullet.range;
        if ((!hit || bullet.pierce > 0) && withinRange && bullet.x > -50 && bullet.x < run.map.width + 50 && bullet.y > -50 && bullet.y < run.map.height + 50) keptPlayerBullets.push(bullet);
    }
    run.playerBullets = keptPlayerBullets;

    let keptEnemyBulletCount = 0;
    for (let i = 0; i < run.enemyBullets.length; i++) {
        const bullet = run.enemyBullets[i];
        bullet.x += bullet.vx; bullet.y += bullet.vy;
        if (bullet.ignoreFrames > 0) bullet.ignoreFrames--;
        let keep = run.map.isWalkable(bullet.x, bullet.y);
        if (keep) {
            const target = targets.find(p => p.alive !== false && p.health > 0 &&
                !(p.id === bullet.ignorePlayerId && bullet.ignoreFrames > 0) &&
                Engine.circleCollision(bullet.x, bullet.y, bullet.radius, p.x, p.y, p.radius));
            if (target) {
                const ricochetChance = target.enemyProjectileRicochetChance ?? 0;
                const damageMultiplier = target.incomingDamageMultiplier ?? 1;
                target.takeDamage(bullet.damage * damageMultiplier);
                keep = ricochetChance > 0 && Math.random() < ricochetChance;
                if (keep) Engine.ricochetEnemyBulletTowardParty(bullet, target, players);
            }
        }
        keep = keep && bullet.x > -50 && bullet.x < run.map.width + 50 &&
            bullet.y > -50 && bullet.y < run.map.height + 50;
        if (keep) run.enemyBullets[keptEnemyBulletCount++] = bullet;
        else run.enemyProjectilePool.release(bullet);
    }
    run.enemyBullets.length = keptEnemyBulletCount;

    run.enemies = run.enemies.filter(enemy => enemy.alive);
    for (const room of run.map.rooms) {
        const roomIndex = run.map.rooms.indexOf(room);
        if (!room.cleared && room.spawned && run.visitedRooms.has(roomIndex) && ['combat', 'combat-simple', 'combat-hard', 'boss'].includes(room.type) &&
            !run.enemies.some(enemy => enemy.roomIndex === roomIndex)) {
            run.map.clearRoom(room);
            run.roomCompletionPending = true;
            run.mapVersion++;
        }
    }
    // Capture death coordinates before a room-clear event revives the party.
    rememberDownedPlayers(run);
    if (run.roomCompletionPending) {
        reviveDownedPlayers(run);
        run.roomCompletionPending = false;
    }
    run.spectatorTargetId = Engine.selectPartySpectatorTargetId(
        run.players.values(), run.spectatorTargetId
    );
    if (![...run.players.values()].some(player => player.health > 0)) run.phase = 'ended';
}

function completeFloorTransition(run) {
    if (!run || run.phase !== 'loading' || !run.nextFloorPending) return false;
    run.nextFloorPending = false;
    generateFloor(run);
    run.phase = 'playing';
    return true;
}

function mapState(map) {
    const roomIndex = room => room ? map.rooms.indexOf(room) : -1;
    return {
        width: map.width, height: map.height, tileSize: map.tileSize, corridorWidth: map.corridorWidth,
        rooms: map.rooms.map(room => {
            const { parent, template, _usedTemplateDoors, ...plain } = room;
            return { ...plain, templateId: template?.id || room.templateId || null, parent: roomIndex(parent) };
        }),
        corridors: map.corridors.map(c => ({ a: roomIndex(c.a), b: roomIndex(c.b), x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, doorA: c.doorA, doorB: c.doorB, templateConnection: !!c.templateConnection })),
        corridorRects: map.corridorRects,
        bossRoom: roomIndex(map.bossRoom), exit: map.exit ? { x: map.exit.x, y: map.exit.y, room: roomIndex(map.exit.room) } : null,
        playerStart: map.playerStart, roomsCleared: map.roomsCleared, totalRooms: map.totalRooms
    };
}

function playerState(player) {
    return Object.fromEntries(['id','name','character','x','y','radius','visualScale','color','weaponKind','maxHealth','health','maxGrayHealth','grayHealth','speed','damage','incomingDamageMultiplier','enemyProjectileRicochetChance','fireRate','bulletSpeed','bulletCount','bulletPierce','magnetRange','level','xp','pendingLevelUps','fireTimer','invincibleTimer','aimX','aimY','aimPointerDistance','ammo','ammoCapacity','reloadFrames','reloadTimer','range','pelletCount','spread','turretActive','sniperAiming','burn','summon','teleportTick'].filter(key => player[key] !== undefined).map(key => [key, player[key]]));
}
function enemyState(enemy) {
    const base = ['id','type','roomIndex','x','y','health','maxHealth','speed','movementSpeedMultiplier','damage','radius','color','xpValue','shootCooldown','shootTimer','alive','deathTimer','angle','phase','phaseTimer','phaseDuration','centerX','centerY','driftAngle','spiralAngle','burnTimer','burnTickTimer','burnDamage','burnInterval','burnPulse','corner','anchorX','anchorY','beamEndX','beamEndY','targetId'];
    return Object.fromEntries(base.filter(key => enemy[key] !== undefined).map(key => [key, enemy[key]]));
}
function bulletState(bullet) {
    return Object.fromEntries(['x','y','vx','vy','damage','pierce','hits','radius','color','ownerId','range','travelled','burn','visualType','ignorePlayerId','ignoreFrames'].filter(key => bullet[key] !== undefined).map(key => [key, bullet[key]]));
}
function summonState(summon) { return Object.fromEntries(['id','ownerId','x','y','health','maxHealth','speed','damage','attackRate','attackTimer','lifetime','radius','color','alive'].map(key => [key, summon[key]])); }
function snapshot(run) {
    return { phase: run.phase, floor: run.floor, tick: run.tick, mapVersion: run.mapVersion, map: mapState(run.map),
        spectatorTargetId: run.spectatorTargetId || null,
        players: [...run.players.values()].map(playerState), enemies: run.enemies.map(enemyState),
        playerBullets: run.playerBullets.map(bulletState), enemyBullets: run.enemyBullets.map(bulletState),
        summons: run.summons.map(summonState), notices: run.notices || [] };
}

/**
 * Spend one queued level-up on the upgrade the client picked.
 *
 * The client only sends an id from the shared UPGRADE_DEFS list; the server
 * stays authoritative on the stats and on how many choices are still owed.
 * Returns true when the choice was applied.
 */
function applyUpgrade(run, playerId, upgradeId) {
    const player = run?.players.get(playerId);
    if (!player || player.health <= 0) return false;
    if (!(player.pendingLevelUps > 0)) return false;
    const upgrade = Engine.UPGRADE_DEFS.find(def => def.id === upgradeId);
    if (!upgrade) return false;
    upgrade.apply(player);
    player.pendingLevelUps--;
    return true;
}

module.exports = { createRun, stepRun, snapshot, applyUpgrade, completeFloorTransition,
    getProjectilePoolStats: run => run?.enemyProjectilePool?.getStats() || null };

