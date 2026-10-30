/* Private solo / party lobby for the shared authoritative simulation. */
(function () {
    'use strict';
    const screen = document.getElementById('start-screen');
    if (!screen) return;
    const panel = document.createElement('section');
    panel.className = 'coop-panel';
    panel.innerHTML = `
        <h2>REFUGIO DE EXPEDICIÓN</h2>
        <label class="coop-label" for="coop-name">Nombre</label>
        <input id="coop-name" maxlength="20" value="Jugador" autocomplete="nickname">
        <label class="coop-label" for="coop-character">Rol</label>
        <select id="coop-character">
            <option value="pistolero">Pistolero</option>
            <option value="tirador">Tirador</option>
            <option value="perdigonero">Perdigonero</option>
            <option value="invocador">Invocador</option>
            <option value="piromano">Piromano</option>
            <option value="bastion">Bastión</option>
        </select>
        <p id="coop-heart-note" class="coop-stage-note" aria-live="polite"></p>
        <div class="coop-actions">
            <button id="coop-create" class="btn">Crear sala</button>
            <button id="coop-solo" class="btn">Jugar en solitario</button>
            <button id="coop-offline" class="btn">Jugar sin conexión</button>
            <button id="coop-test" class="btn">Sala de pruebas 0-0</button>
            <button id="coop-copy" class="btn" disabled>Copiar invitación</button>
        </div>
        <div id="coop-status" role="status" aria-live="polite">Conectando con el servidor local…</div>
        <a id="coop-invite" class="coop-invite" hidden></a>
        <ol id="coop-players" class="coop-players"></ol>
        <p id="coop-stage-note" class="coop-stage-note">Hasta tres jugadores comparten la mazmorra.</p>`;
    const menu = screen.querySelector('.start-menu') || screen;
    menu.insertBefore(panel, menu.querySelector('.controls-info'));

    const name = panel.querySelector('#coop-name');
    const character = panel.querySelector('#coop-character');
    const heartNote = panel.querySelector('#coop-heart-note');
    const status = panel.querySelector('#coop-status');
    const inviteLink = panel.querySelector('#coop-invite');
    const players = panel.querySelector('#coop-players');
    const createButton = panel.querySelector('#coop-create');
    const soloButton = panel.querySelector('#coop-solo');
    const offlineButton = panel.querySelector('#coop-offline');
    const testButton = panel.querySelector('#coop-test');

    function updateRoleHeartNote() {
        const count = Math.max(0, Math.floor(CHARACTER_ROLES[character.value]?.grayHearts || 0));
        if (heartNote) heartNote.textContent = count
            ? `Corazones grises: ${count} (${count === 1 ? 'no recuperable' : 'no recuperables'}).`
            : 'Corazones grises: ninguno.';
    }
    character.addEventListener('change', updateRoleHeartNote);
    updateRoleHeartNote();
    const copyButton = panel.querySelector('#coop-copy');
    const startButton = document.getElementById('start-btn');
    startButton.textContent = 'Iniciar expedición';
    startButton.disabled = true;
    startButton.title = 'Invita a otra persona o elige jugar en solitario.';
    createButton.disabled = true;
    soloButton.disabled = true;
    offlineButton.disabled = false;

    const client = window.coopClient = {
        gameEnabled: false,
        phase: 'disconnected',
        roomId: null,
        playerId: null,
        hostId: null,
        selectedCharacter: 'pistolero',
        socket: null,
        send(data) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data)); },
        requestStart() {
            this.starting = true;
            window.abyssGame?.ui.showLoading();
            this.send({ type: 'start' });
        },
        starting: false
    };

    function connect() {
        if (location.protocol === 'file:') {
            status.textContent = 'Sin conexión al servidor: puedes jugar en solitario o iniciar el servidor para crear grupos.';
            return;
        }
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = client.socket = new WebSocket(`${scheme}//${location.host}/session`);
        socket.addEventListener('open', () => {
            status.textContent = 'Conectado. Crea una sala o abre un enlace de invitación.';
            createButton.disabled = false;
            soloButton.disabled = false;
            const roomId = new URLSearchParams(location.search).get('room');
            if (roomId) socket.send(JSON.stringify({ type: 'join', roomId, name: name.value, character: client.selectedCharacter }));
        });
        socket.addEventListener('message', event => {
            let message;
            try { message = JSON.parse(event.data); } catch (_) { return; }
            if (message.type === 'error') {
                status.textContent = message.message;
                if (client.starting && client.gameEnabled) window.abyssGame?.ui.showLoadingError(message.message);
                else window.abyssGame?.ui.hideLoading();
                client.starting = false;
                return;
            }
            if (message.type === 'welcome') { client.playerId = message.playerId; return; }
            if (message.type === 'game_start') {
                client.gameEnabled = true;
                client.phase = 'playing';
                client.starting = false;
                screen.classList.add('hidden');
                document.getElementById('net-game-status').textContent = 'Conectado';
                window.abyssGame?.ui.showLoading();
                window.coopGame.start(message.snapshot);
                return;
            }
            if (message.type === 'game_snapshot') {
                window.coopGame.applySnapshot(message.snapshot);
                return;
            }
            if (message.type !== 'snapshot') return;
            client.roomId = message.roomId;
            client.phase = message.phase;
            client.hostId = message.hostId;
            const self = message.players.find(p => p.id === client.playerId);
            if (!client.playerId && message.players.length) {
                // The first newly observed player is the local player on create/join.
                const remembered = sessionStorage.getItem(`abyss-player:${message.roomId}`);
                if (remembered && message.players.some(p => p.id === remembered)) client.playerId = remembered;
                else {
                    const mine = message.players.find(p => p.name === name.value) || message.players[message.players.length - 1];
                    if (mine) { client.playerId = mine.id; sessionStorage.setItem(`abyss-player:${message.roomId}`, mine.id); }
                }
            }
            character.value = (message.players.find(p => p.id === client.playerId) || {}).character || character.value;
            const labels = { pistolero: 'Pistolero', tirador: 'Tirador', perdigonero: 'Perdigonero', invocador: 'Invocador', piromano: 'Piromano', bastion: 'Bastión' };
            players.replaceChildren(...message.players.map(p => {
                const li = document.createElement('li');
                li.textContent = `${p.name} — ${labels[p.character] || p.character}${p.id === message.hostId ? ' · anfitrión' : ''}`;
                return li;
            }));
            const invite = new URL(location.href);
            invite.searchParams.set('room', message.roomId);
            inviteLink.href = invite.href;
            inviteLink.textContent = `Invitación: ${invite.href}`;
            inviteLink.hidden = false;
            copyButton.disabled = false;
            status.textContent = `Sala ${message.roomId.slice(0, 8)} · ${message.players.length}/3 jugadores`;
            const isHost = client.playerId === message.hostId;
            startButton.disabled = message.phase !== 'lobby' || !isHost || message.players.length < 2;
            startButton.title = message.players.length < 2 ? 'Invita a otra persona o juega en solitario.' : (!isHost ? 'Solo el anfitrión puede iniciar.' : 'Iniciar la expedición compartida.');
            startButton.dataset.invite = invite.href;
            createButton.disabled = true;
            soloButton.disabled = true;
            soloButton.disabled = true;
        });
        socket.addEventListener('close', () => {
            window.abyssGame?.player?.cancelSniperAim?.();
            status.textContent = 'Se perdió la conexión con el servidor. Recarga para volver al lobby.';
            if (client.gameEnabled) document.getElementById('net-game-status').textContent = 'Conexión perdida';
            createButton.disabled = true;
            soloButton.disabled = true;
        });
        socket.addEventListener('error', () => { status.textContent = 'No se pudo conectar. Ejecuta el servidor local y recarga.'; });
    }

    createButton.addEventListener('click', () => client.send({ type: 'create', name: name.value, character: client.selectedCharacter }));
    soloButton.addEventListener('click', () => client.send({ type: 'create', name: name.value, character: client.selectedCharacter, solo: true }));
    testButton.addEventListener('click', () => {
        client.gameEnabled = false;
        screen.classList.add('hidden');
        window.startTestRoom(client.selectedCharacter);
    });
    offlineButton.addEventListener('click', () => {
        client.gameEnabled = false;
        screen.classList.add('hidden');
        window.startOfflineGame(client.selectedCharacter);
    });
    character.addEventListener('change', () => {
        client.selectedCharacter = character.value;
        if (client.roomId) client.send({ type: 'select', character: character.value });
    });
    copyButton.addEventListener('click', async () => {
        if (!startButton.dataset.invite) return;
        try { await navigator.clipboard.writeText(startButton.dataset.invite); status.textContent = 'Enlace de invitación copiado.'; }
        catch (_) { status.textContent = `Copia este enlace: ${startButton.dataset.invite}`; }
    });
    startButton.addEventListener('click', event => {
        if (!client.gameEnabled) { event.preventDefault(); event.stopImmediatePropagation(); client.requestStart(); }
    }, true);
    connect();
}());

