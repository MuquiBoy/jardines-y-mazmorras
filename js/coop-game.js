/* Client-side presentation and input transport for the authoritative run. */
(function () {
    'use strict';
    let game = null;
    let playersById = new Map();
    let enemiesById = new Map();
    let lastSnapshotAt = 0;
    let renderStarted = false;
    let sendTimer = null;
    const characterNames = { aji: 'Piromano Ají', invocador: 'Invocador', carguero: 'Carguero', gunslinger: 'Gunslinger' };
    const enemyClasses = { basic: BasicEnemy, shooter: ShooterEnemy, spiral: SpiralEnemy, boss: BossEnemy };

    function restoreMap(state) {
        const map = new DungeonMap(state.width, state.height);
        map.tileSize = state.tileSize;
        map.corridorWidth = state.corridorWidth;
        map.rooms = state.rooms.map(room => ({ ...room, parent: null }));
        state.rooms.forEach((room, i) => { map.rooms[i].parent = room.parent >= 0 ? map.rooms[room.parent] : null; });
        map.corridors = state.corridors.map(c => ({ ...c, a: map.rooms[c.a], b: map.rooms[c.b] }));
        map.corridorRects = state.corridorRects;
        map.bossRoom = state.bossRoom >= 0 ? map.rooms[state.bossRoom] : null;
        map.exit = state.exit ? { x: state.exit.x, y: state.exit.y, room: map.rooms[state.exit.room] } : null;
        map.playerStart = state.playerStart;
        map.roomsCleared = state.roomsCleared;
        map.totalRooms = state.totalRooms;
        return map;
    }

    function playerObject(state, existing) {
        const player = existing || new Player(state.x, state.y);
        if (!player._drawState) player._drawState = { x: state.x, y: state.y, fromX: state.x, fromY: state.y, time: performance.now() };
        else {
            player._drawState.fromX = player._drawState.x;
            player._drawState.fromY = player._drawState.y;
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
        const localId = window.coopClient.playerId;
        const currentPlayers = new Map();
        for (const record of state.players) {
            const player = playerObject(record, playersById.get(record.id));
            currentPlayers.set(record.id, player);
        }
        playersById = currentPlayers;
        const local = playersById.get(localId) || state.players[0] && playersById.get(state.players[0].id);
        if (!local) return;
        game.player = local;
        game.remotePlayers = [...playersById.values()].filter(p => p.id !== local.id && p.health > 0);

        const nextEnemies = new Map();
        for (const record of state.enemies) nextEnemies.set(record.id, enemyObject(record, enemiesById.get(record.id)));
        enemiesById = nextEnemies;
        game.enemies = [...enemiesById.values()];
        game.bullets = state.playerBullets;
        game.enemyBullets = state.enemyBullets;
        game.map = restoreMap(state.map);
        game.floor = state.floor;
        game.state = state.phase === 'ended' ? 'GAME_OVER' : 'PLAYING';
        game.ui.updateHUD(game.player, game.floor);
        game.ui.showHUD(true);
        if (state.phase === 'ended') game.ui.showGameOver(game.player.level, game.map.roomsCleared, 0, game.floor);
        lastSnapshotAt = performance.now();
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
        return { type: 'input', moveX, moveY, aimX, aimY, fire: input.mouseDown };
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
            game.coopMode = true;
            game.loopRunning = false;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('gameover-screen').classList.add('hidden');
            applySnapshot(initialSnapshot);
            if (!renderStarted) { renderStarted = true; requestAnimationFrame(renderFrame); }
            if (sendTimer) clearInterval(sendTimer);
            sendTimer = setInterval(() => {
                if (game?.state === 'PLAYING') window.coopClient.send(readMovement());
            }, 50);
            document.getElementById('game').focus();
        },
        applySnapshot
    };
}());
