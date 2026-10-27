/* Client-side presentation and input transport for the authoritative run. */
(function () {
    'use strict';
    let game = null;
    let playersById = new Map();
    let enemiesById = new Map();
    let lastSnapshotAt = 0;
    let renderStarted = false;
    let templatesReady = false;
    let pendingSnapshot = null;
    let sendTimer = null;
    const seenNoticeIds = new Set();
    // Level-up flow: the server owns pendingLevelUps. offeredOwed is the count
    // currently on screen; awaitingOwed is what we expect after a sent choice.
    let offeredOwed = 0;
    let awaitingOwed = -1;
    const characterNames = { pistolero: 'Pistolero', tirador: 'Tirador', perdigonero: 'Perdigonero', invocador: 'Invocador', piromano: 'Piromano', bastion: 'Bastión' };
    const enemyClasses = { basic: BasicEnemy, shooter: ShooterEnemy, spiral: SpiralEnemy, boss: BossEnemy };

    function restoreMap(state) {
        const map = new DungeonMap(state.width, state.height);
        map.tileSize = state.tileSize;
        map.corridorWidth = state.corridorWidth;
        map.rooms = state.rooms.map(room => ({ ...room, template: RoomTemplateLibrary.getById(room.templateId), parent: null }));
        state.rooms.forEach((room, i) => { map.rooms[i].parent = room.parent >= 0 ? map.rooms[room.parent] : null; });
        map.corridors = state.corridors.map(c => ({ ...c, a: map.rooms[c.a], b: map.rooms[c.b] }));
        map.corridorRects = state.corridorRects;
        map.bossRoom = state.bossRoom >= 0 ? map.rooms[state.bossRoom] : null;
        map.exit = state.exit ? { x: state.exit.x, y: state.exit.y, room: map.rooms[state.exit.room] } : null;
        map.playerStart = state.playerStart;
        map.roomsCleared = state.roomsCleared;
        map.totalRooms = state.totalRooms;
        // Rebuild the derived door planes from the restored room.locked flags.
        map.refreshDoorBlockers();
        return map;
    }

    function playerObject(state, existing) {
        const player = existing || new Player(state.x, state.y);
        if (!player._drawState) player._drawState = { x: state.x, y: state.y, fromX: state.x, fromY: state.y, time: performance.now() };
        else {
            const distance = Math.hypot(state.x - player._drawState.x, state.y - player._drawState.y);
            // Re-seating a player (combat teleport, new floor) is a cut, not a
            // sprint: interpolating would slide them through the level.
            const reseated = distance > 160 ||
                (state.teleportTick !== undefined && state.teleportTick !== player.teleportTick);
            if (reseated) {
                player._drawState.fromX = state.x;
                player._drawState.fromY = state.y;
            } else {
                player._drawState.fromX = player._drawState.x;
                player._drawState.fromY = player._drawState.y;
            }
            player._drawState.x = state.x;
            player._drawState.y = state.y;
            player._drawState.time = performance.now();
        }
        Object.assign(player, state, { className: characterNames[state.character] || state.character });
        return player;
    }

    function enemyObject(state, existing) {
        const Ctor = enemyClasses[state.type] || BasicEnemy;
        const enemy = existing || new Ctor(state.x, state.y);
        Object.assign(enemy, state);
        return enemy;
    }

    function applySnapshot(state) {
        if (!game || !state) return;
        if (!templatesReady) { pendingSnapshot = state; return; }
        const localId = window.coopClient.playerId;
        const currentPlayers = new Map();
        for (const record of state.players) {
            const oldPlayer = playersById.get(record.id);
            if (record.id === localId && oldPlayer && record.ammo < oldPlayer.ammo) {
                if (record.character === 'tirador') game.audio.sniperShot();
                else if (record.character === 'piromano') game.audio.flameShot();
                else game.audio.shoot();
            }
            const player = playerObject(record, playersById.get(record.id));
            currentPlayers.set(record.id, player);
        }
        playersById = currentPlayers;
        const local = playersById.get(localId) || state.players[0] && playersById.get(state.players[0].id);
        if (!local) return;
        game.player = local;
        game.remotePlayers = [...playersById.values()].filter(p => p.id !== local.id && p.health > 0);

        let burnSound = false;
        const nextEnemies = new Map();
        for (const record of state.enemies) {
            const oldEnemy = enemiesById.get(record.id);
            if (oldEnemy && (record.burnPulse || 0) > (oldEnemy.burnPulse || 0)) burnSound = true;
            nextEnemies.set(record.id, enemyObject(record, oldEnemy));
        }
        if (burnSound) game.audio.burnTick();
        enemiesById = nextEnemies;
        game.enemies = [...enemiesById.values()];
        game.summons = state.summons || [];
        game.bullets = state.playerBullets;
        game.enemyBullets = state.enemyBullets;
        game.map = restoreMap(state.map);
        // One-shot server notices (treasure rooms, etc.) are shown exactly once
        // even though every snapshot repeats the recent list. The id set is
        // only cleared on a new floor: clearing it on every room change could
        // show a still-recent notice twice.
        if (state.floor !== game.floor) {
            seenNoticeIds.clear();
            game.audio.nextTrack();
        }
        for (const notice of state.notices || []) {
            if (!notice || seenNoticeIds.has(notice.id)) continue;
            seenNoticeIds.add(notice.id);
            game.ui.drawNotification(game.ctx, notice.text);
        }
        game.floor = state.floor;
        if (state.phase === 'ended') {
            game.state = 'GAME_OVER';
            game.ui.hideLevelUp();
            game.ui.showGameOver(game.player.level, game.map.roomsCleared, 0, game.floor);
        } else {
            applyLevelUpState(local);
        }
        game.ui.updateHUD(game.player, game.floor);
        game.ui.showHUD(true);
        lastSnapshotAt = performance.now();
    }

    /**
     * Keep the upgrade screen in sync with the authoritative level queue.
     *
     * snapshots arrive every 50 ms, so the cards must not be rebuilt on each
     * one. A sent choice is in flight until the server's count drops; until
     * then the same snapshot value must not reopen the screen.
     */
    function applyLevelUpState(local) {
        const owed = local.pendingLevelUps || 0;
        if (owed <= 0) {
            offeredOwed = 0;
            awaitingOwed = -1;
            if (game.state === 'LEVEL_UP') game.ui.hideLevelUp();
            game.state = 'PLAYING';
            return;
        }
        if (awaitingOwed >= 0 && owed > awaitingOwed) {
            // The server has not consumed the choice yet.
            game.state = 'PLAYING';
            return;
        }
        if (game.state !== 'LEVEL_UP' || owed !== offeredOwed) {
            offeredOwed = owed;
            awaitingOwed = -1;
            game.handleLevelUp();
        }
    }

    /** Called by Game.applyUpgrade() after sending the chosen card id. */
    function noteUpgradeSent() {
        awaitingOwed = Math.max(0, offeredOwed - 1);
    }

    function readMovement() {
        const input = game.input;
        let moveX = input.moveX || 0, moveY = input.moveY || 0;
        if (!moveX && !moveY) {
            if (input.keys.KeyA || input.keys.ArrowLeft) moveX -= 1;
            if (input.keys.KeyD || input.keys.ArrowRight) moveX += 1;
            if (input.keys.KeyW || input.keys.ArrowUp) moveY -= 1;
            if (input.keys.KeyS || input.keys.ArrowDown) moveY += 1;
        }
        const length = Math.hypot(moveX, moveY);
        if (length > 1) { moveX /= length; moveY /= length; }

        let aimX = input.aimX, aimY = input.aimY;
        if (!input.aimActive) {
            const worldX = game.camera.x + input.mouseX;
            const worldY = game.camera.y + input.mouseY;
            aimX = worldX - game.player.x;
            aimY = worldY - game.player.y;
            const aimLength = Math.hypot(aimX, aimY) || 1;
            aimX /= aimLength; aimY /= aimLength;
        }
        return { type: 'input', moveX, moveY, aimX, aimY, fire: input.mouseDown, reload: !!input.keys.KeyR };
    }

    function renderFrame() {
        if (!game || !renderStarted) return;
        if (game.state === 'GAME_OVER') { game.render(); renderStarted = false; return; }
        const now = performance.now();
        const alpha = Math.min(1, (now - lastSnapshotAt) / 50);
        for (const player of playersById.values()) {
            const draw = player._drawState;
            player.renderX = draw.fromX + (draw.x - draw.fromX) * alpha;
            player.renderY = draw.fromY + (draw.y - draw.fromY) * alpha;
        }
        const px = game.player.renderX ?? game.player.x;
        const py = game.player.renderY ?? game.player.y;
        game.camera.x = Math.max(0, Math.min(px - game.viewWidth / 2, game.map.width - game.viewWidth));
        game.camera.y = Math.max(0, Math.min(py - game.viewHeight / 2, game.map.height - game.viewHeight));
        game.frameCount++;
        game.render();
        requestAnimationFrame(renderFrame);
    }

    window.coopGame = {
        start(initialSnapshot) {
            game = window.abyssGame;
            if (!game) return;
            // The online flow starts from a WebSocket message, not from a
            // button, so it never went through startGame(). Unlock here too;
            // the page-wide gesture listener is what actually resumes the
            // context when the browser requires a user gesture.
            game.audio.unlock();
            return RoomTemplateLibrary.load().then(() => {
            templatesReady = true;
            game.coopMode = true;
            game.loopRunning = false;
            game.audio.ensureMusic(0);
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('gameover-screen').classList.add('hidden');
            applySnapshot(pendingSnapshot || initialSnapshot);
            pendingSnapshot = null;
            if (!renderStarted) { renderStarted = true; requestAnimationFrame(renderFrame); }
            if (sendTimer) clearInterval(sendTimer);
            sendTimer = setInterval(() => {
                if (game?.state === 'PLAYING') window.coopClient.send(readMovement());
            }, 50);
            document.getElementById('game').focus();
            });
        },
        applySnapshot,
        noteUpgradeSent
    };
}());
