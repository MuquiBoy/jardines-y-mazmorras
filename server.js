'use strict';

// Dependency-free WebSocket host for three-player parties and shared runs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Simulation = require('./server/simulation');
const { listRoomTemplateFiles } = require('./server/template-catalog');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = 3;
const rooms = new Map();
const sockets = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/room-templates') {
        try {
            const catalog = listRoomTemplateFiles(path.join(ROOT, 'assets', 'plantillas-salas'));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(catalog));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'No se pudo leer la carpeta de plantillas.' }));
        }
        return;
    }
    const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    const file = path.resolve(ROOT, `.${requested}`);
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
        res.writeHead(403).end('Forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    });
});

server.on('upgrade', (req, socket) => {
    if (req.url !== '/session' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) {
        socket.destroy(); return;
    }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket._buffer = Buffer.alloc(0);
    socket._player = null;
    socket._room = null;
    sockets.add(socket);
    socket.on('data', data => readFrames(socket, data));
    socket.on('close', () => detach(socket));
    socket.on('error', () => detach(socket));
});

function send(socket, value) {
    if (!socket || socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify(value));
    let header;
    if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else return;
    socket.write(Buffer.concat([header, payload]));
}

function readFrames(socket, data) {
    socket._buffer = Buffer.concat([socket._buffer, data]);
    while (socket._buffer.length >= 2) {
        const b0 = socket._buffer[0], b1 = socket._buffer[1];
        if ((b0 & 0x0f) === 8) { socket.end(); return; }
        if ((b0 & 0x0f) !== 1 || !(b1 & 0x80)) { socket.destroy(); return; }
        let length = b1 & 0x7f, offset = 2;
        if (length === 126) { if (socket._buffer.length < 4) return; length = socket._buffer.readUInt16BE(2); offset = 4; }
        else if (length === 127) { socket.destroy(); return; }
        if (length > 4096) { socket.destroy(); return; }
        if (socket._buffer.length < offset + 4 + length) return;
        const mask = socket._buffer.subarray(offset, offset + 4); offset += 4;
        const payload = Buffer.from(socket._buffer.subarray(offset, offset + length));
        for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
        socket._buffer = socket._buffer.subarray(offset + length);
        try { handle(socket, JSON.parse(payload.toString('utf8'))); } catch (_) { send(socket, { type: 'error', message: 'Mensaje inválido.' }); }
    }
}

function snapshot(room) {
    return { type: 'snapshot', roomId: room.id, phase: room.phase, hostId: room.hostId,
        players: [...room.players.values()].map(({ id, name, character }) => ({ id, name, character })) };
}
function broadcast(room) {
    const state = snapshot(room);
    for (const player of room.players.values()) send(player.socket, state);
}

function startSharedRun(room) {
    room.run = Simulation.createRun([...room.players.values()]);
    room.phase = 'playing';
    const initial = { type: 'game_start', snapshot: Simulation.snapshot(room.run) };
    for (const player of room.players.values()) send(player.socket, initial);
}

setInterval(() => {
    for (const room of rooms.values()) {
        if (room.phase !== 'playing' || !room.run) continue;
        Simulation.stepRun(room.run, new Map([...room.players.values()].map(p => [p.id, p.input])));
        if (room.run.phase === 'ended') {
            room.phase = 'ended';
            const finalUpdate = { type: 'game_snapshot', snapshot: Simulation.snapshot(room.run) };
            for (const player of room.players.values()) send(player.socket, finalUpdate);
        }
    }
}, 1000 / 60).unref();

setInterval(() => {
    for (const room of rooms.values()) {
        if (room.phase === 'playing' && room.run) {
            const update = { type: 'game_snapshot', snapshot: Simulation.snapshot(room.run) };
            for (const player of room.players.values()) send(player.socket, update);
        }
    }
}, 50).unref();

function handle(socket, message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'create') {
        if (socket._room) return;
        const id = crypto.randomBytes(12).toString('base64url');
        const player = { id: crypto.randomUUID(), name: cleanName(message.name), character: validCharacter(message.character), socket, input: neutralInput() };
        const room = { id, hostId: player.id, phase: 'lobby', players: new Map([[player.id, player]]), run: null, solo: message.solo === true };
        rooms.set(id, room); socket._room = id; socket._player = player.id;
        send(socket, { type: 'welcome', playerId: player.id });
        if (room.solo) startSharedRun(room); else broadcast(room);
        return;
    }
    if (message.type === 'join') {
        if (socket._room) return;
        const id = String(message.roomId || '');
        const room = rooms.get(id);
        if (!room || room.phase !== 'lobby') { send(socket, { type: 'error', message: 'La sala no existe o ya inició.' }); return; }
        if (room.players.size >= MAX_PLAYERS) { send(socket, { type: 'error', message: 'La sala está completa.' }); return; }
        const player = { id: crypto.randomUUID(), name: cleanName(message.name), character: validCharacter(message.character), socket, input: neutralInput() };
        room.players.set(player.id, player); socket._room = id; socket._player = player.id;
        send(socket, { type: 'welcome', playerId: player.id });
        broadcast(room); return;
    }
    const room = rooms.get(socket._room);
    const player = room?.players.get(socket._player);
    if (!room || !player) return;
    if (message.type === 'input' && room.phase === 'playing') {
        const moveX = clampNumber(message.moveX, -1, 1);
        const moveY = clampNumber(message.moveY, -1, 1);
        const moveLength = Math.hypot(moveX, moveY);
        const aimX = clampNumber(message.aimX, -1, 1);
        const aimY = clampNumber(message.aimY, -1, 1);
        const aimLength = Math.hypot(aimX, aimY) || 1;
        player.input = { moveX: moveLength > 1 ? moveX / moveLength : moveX, moveY: moveLength > 1 ? moveY / moveLength : moveY,
            aimX: aimX / aimLength, aimY: aimY / aimLength, fire: message.fire === true, reload: message.reload === true };
    } else if (message.type === 'select' && room.phase === 'lobby') {
        if (!['pistolero', 'tirador', 'perdigonero', 'invocador', 'piromano', 'bastion'].includes(message.character)) return;
        player.character = message.character;
        broadcast(room);
    } else if (message.type === 'start') {
        if (player.id !== room.hostId) { send(socket, { type: 'error', message: 'Solo el anfitrión puede iniciar.' }); return; }
        if (room.players.size < 2 && !room.solo) { send(socket, { type: 'error', message: 'Invita al menos a otra persona o elige jugar en solitario.' }); return; }
        startSharedRun(room);
    } else if (message.type === 'upgrade' && room.phase === 'playing' && room.run) {
        // The client picked one of the shared cards. Apply it here so stats
        // stay authoritative; the next snapshot carries the new numbers and
        // the remaining queued levels.
        Simulation.applyUpgrade(room.run, player.id, message.upgradeId);
    } else if (message.type === 'restart' && room.phase === 'ended' && player.id === room.hostId) {
        startSharedRun(room);
    }
}

function cleanName(value) {
    return String(value || 'Jugador').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20) || 'Jugador';
}
function validCharacter(value) {
    return ['pistolero', 'tirador', 'perdigonero', 'invocador', 'piromano', 'bastion'].includes(value) ? value : 'pistolero';
}
function clampNumber(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : 0;
}
function neutralInput() { return { moveX: 0, moveY: 0, aimX: 0, aimY: -1, fire: false, reload: false }; }
function detach(socket) {
    sockets.delete(socket);
    const room = rooms.get(socket._room);
    if (!room) return;
    room.players.delete(socket._player);
    room.run?.players.delete(socket._player);
    if (!room.players.size) rooms.delete(room.id);
    else {
        if (room.hostId === socket._player) room.hostId = room.players.keys().next().value;
        if (room.phase === 'lobby') broadcast(room);
    }
    socket._room = null; socket._player = null;
}

server.listen(PORT, () => console.log(`Abyss Engine local server: http://localhost:${PORT}`));
