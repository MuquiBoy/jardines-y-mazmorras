'use strict';

// Dependency-free PNG room-template reader shared by the authoritative server
// and its catalog endpoint. It scans category folders on every floor start.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const TILE_PIXELS = 40;
const CATEGORIES = ['entry', 'hub', 'combat', 'combat-hard', 'treasure', 'boss'];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function minionCountFromName(type, relativePath) {
    if (type !== 'combat' && type !== 'combat-hard') return null;
    const name = path.basename(relativePath, '.png').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const size = /^sala[\s_-]+(pequena|media|mediana|gigante)(?=[\s_-]|$)/.exec(name)?.[1];
    const count = { pequena: 3, media: 4, mediana: 4, gigante: 5 }[size];
    if (!count) throw new Error('nombre sin categoría: usa sala pequeña, mediana o gigante');
    return count;
}

function listRoomTemplateFiles(root) {
    const templates = Object.fromEntries(CATEGORIES.map(type => [type, []]));
    const revisionParts = [];
    for (const type of CATEGORIES) {
        const folder = path.join(root, type);
        if (!fs.existsSync(folder)) continue;
        walk(folder, file => {
            if (path.extname(file).toLowerCase() !== '.png') return;
            const relative = `${type}/${path.relative(folder, file).split(path.sep).join('/')}`;
            templates[type].push(relative);
            revisionParts.push(`${relative}:${crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')}`);
        });
        templates[type].sort((a, b) => a.localeCompare(b, 'es'));
    }
    const revision = crypto.createHash('sha1').update(revisionParts.join('|')).digest('hex').slice(0, 16);
    return { version: 2, revision, cellWorldSize: TILE_PIXELS, sourcePixelsPerCell: TILE_PIXELS, templates };
}

function walk(folder, visit) {
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full, visit);
        else if (entry.isFile()) visit(full);
    }
}

function loadTemplateCatalog(root) {
    const manifest = listRoomTemplateFiles(root);
    const byType = new Map(CATEGORIES.map(type => [type, []]));
    const diagnostics = [];
    for (const [type, paths] of Object.entries(manifest.templates)) {
        for (const relativePath of paths) {
            try {
                const absolutePath = path.join(root, ...relativePath.split('/'));
                const template = readTemplate(fs.readFileSync(absolutePath), type, relativePath);
                byType.get(type).push(template);
            } catch (error) {
                const message = `${relativePath}: ${error.message || error}`;
                diagnostics.push(message);
                console.warn(`Plantilla ignorada: ${message}`);
            }
        }
    }
    const pick = type => {
        const options = byType.get(type);
        return options?.length ? options[Math.floor(Math.random() * options.length)] : null;
    };
    return { byType, diagnostics, manifest, pick };
}

function readTemplate(buffer, type, relativePath) {
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG inválido');
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, palette = null, transparency = null;
    const compressed = [];
    for (let offset = 8; offset + 12 <= buffer.length;) {
        const length = buffer.readUInt32BE(offset);
        if (length > 8 * 1024 * 1024 || offset + 12 + length > buffer.length) throw new Error('bloque PNG truncado o demasiado grande');
        const name = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (name === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            bitDepth = data[8]; colorType = data[9]; interlace = data[12];
        } else if (name === 'PLTE') palette = data;
        else if (name === 'tRNS') transparency = data;
        else if (name === 'IDAT') compressed.push(data);
        else if (name === 'IEND') break;
        offset += 12 + length;
    }
    if (!width || !height || width % TILE_PIXELS || height % TILE_PIXELS) throw new Error('ancho y alto deben ser múltiplos de 40 px');
    const widthTiles = width / TILE_PIXELS, heightTiles = height / TILE_PIXELS;
    if (widthTiles < 3 || heightTiles < 3 || widthTiles > 64 || heightTiles > 64) throw new Error('tamaño de cuadrícula fuera del rango 3–64 losas');
    if (bitDepth !== 8 || ![2, 3, 6].includes(colorType) || interlace !== 0) throw new Error('formato requerido: PNG RGB/RGBA o indexado de 8 bits, sin entrelazado');
    const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    if (colorType === 3 && (!palette || palette.length % 3)) throw new Error('paleta PNG inválida');
    const rowBytes = width * bytesPerPixel;
    const raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: (rowBytes + 1) * height + 1 });
    if (raw.length < (rowBytes + 1) * height) throw new Error('datos de píxel incompletos');
    unfilter(raw, width, height, bytesPerPixel, rowBytes);

    const mask = new Uint8Array(widthTiles * heightTiles), enemySpawns = [];
    let playerSpawn = null;
    for (let y = 0; y < heightTiles; y++) for (let x = 0; x < widthTiles; x++) {
        const sourceX = x * TILE_PIXELS + TILE_PIXELS / 2;
        const sourceY = y * TILE_PIXELS + TILE_PIXELS / 2;
        const pixel = sourceY * (rowBytes + 1) + 1 + sourceX * bytesPerPixel;
        let r, g, b, a = 255;
        if (colorType === 3) {
            const color = raw[pixel], p = color * 3;
            if (p + 2 >= palette.length) throw new Error('índice de paleta inválido');
            r = palette[p]; g = palette[p + 1]; b = palette[p + 2];
            if (transparency && color < transparency.length) a = transparency[color];
        } else {
            r = raw[pixel]; g = raw[pixel + 1]; b = raw[pixel + 2];
            if (colorType === 6) a = raw[pixel + 3];
        }
        const i = y * widthTiles + x;
        if (a === 0) mask[i] = 0;
        else if (r === 0 && g === 255 && b === 0) mask[i] = 1;
        else if (r === 255 && g === 255 && b === 0) mask[i] = 2;
        else if (r === 0 && g === 255 && b === 255) { mask[i] = 1; playerSpawn = { x, y }; }
        else if (r === 255 && g === 0 && b === 255) { mask[i] = 1; enemySpawns.push({ x, y }); }
        else if (r === 0 && g === 0 && b === 255) mask[i] = 3;
        else mask[i] = 0;
    }

    floodExteriorBlue(mask, widthTiles, heightTiles);
    const minionCount = minionCountFromName(type, relativePath);
    // A marker on the outer border cannot safely host even the smallest
    // minion while the room doors are sealed. All other marker centres have
    // at least 20 px of their own floor tile around them (max minion radius 16).
    const validEnemySpawns = enemySpawns.filter(cell => cell.x > 0 && cell.y > 0 &&
        cell.x < widthTiles - 1 && cell.y < heightTiles - 1);
    if (minionCount !== null && validEnemySpawns.length < minionCount) {
        throw new Error(`requiere ${minionCount} casillas #FF00FF interiores; tiene ${validEnemySpawns.length} utilizables (${enemySpawns.length} detectadas)`);
    }
    const doors = collectDoors(mask, widthTiles, heightTiles);
    for (const door of doors) if (door.length !== 2) throw new Error(`puerta ${door.side} de ${door.length} losas; cada puerta debe medir 2`);
    const walkableCells = [];
    for (let y = 1; y < heightTiles - 1; y++) for (let x = 1; x < widthTiles - 1; x++) {
        if (mask[y * widthTiles + x] === 1) walkableCells.push({ x, y });
    }
    if (!walkableCells.length) throw new Error('no contiene suelo transitable interior');
    const reachable = countReachable(mask, widthTiles, heightTiles);
    let totalWalkable = 0;
    for (const cell of mask) if (cell === 1 || cell === 2) totalWalkable++;
    if (reachable !== totalWalkable) throw new Error('contiene suelo o puertas aislados');
    return { id: relativePath, path: relativePath, type, widthTiles, heightTiles, mask, doors,
        walkableCells, enemySpawns: validEnemySpawns, minionCount, playerSpawn };
}

function unfilter(data, width, height, bpp, rowBytes) {
    let previous = Buffer.alloc(rowBytes), offset = 0;
    for (let y = 0; y < height; y++) {
        const filter = data[offset++], row = data.subarray(offset, offset + rowBytes);
        if (filter > 4) throw new Error(`filtro PNG ${filter} no compatible`);
        for (let i = 0; i < rowBytes; i++) {
            const left = i >= bpp ? row[i - bpp] : 0;
            const up = previous[i];
            const upLeft = i >= bpp ? previous[i - bpp] : 0;
            let predictor = 0;
            if (filter === 1) predictor = left;
            else if (filter === 2) predictor = up;
            else if (filter === 3) predictor = Math.floor((left + up) / 2);
            else if (filter === 4) predictor = paeth(left, up, upLeft);
            row[i] = (row[i] + predictor) & 255;
        }
        previous = Buffer.from(row);
        offset += rowBytes;
    }
}

function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function floodExteriorBlue(mask, width, height) {
    const queue = new Int32Array(mask.length);
    let head = 0, tail = 0;
    const add = i => { if (mask[i] === 3) { mask[i] = 0; queue[tail++] = i; } };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        if (x) add(i - 1); if (x + 1 < width) add(i + 1);
        if (y) add(i - width); if (y + 1 < height) add(i + width);
    }
}

function collectDoors(mask, width, height) {
    const doors = [];
    const edges = [
        ['N', width, i => i, i => i], ['S', width, i => (height - 1) * width + i, i => i],
        ['W', height, i => i * width, i => i], ['E', height, i => i * width + width - 1, i => i]
    ];
    for (const [side, length, indexAt] of edges) {
        let start = -1;
        for (let i = 0; i <= length; i++) {
            const marked = i < length && mask[indexAt(i)] === 2;
            if (marked && start < 0) start = i;
            if (!marked && start >= 0) { doors.push({ side, offset: start, length: i - start }); start = -1; }
        }
    }
    return doors;
}

function countReachable(mask, width, height) {
    const start = mask.findIndex(cell => cell === 1 || cell === 2);
    if (start < 0) return 0;
    const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
    let head = 0, tail = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        const neighbors = [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1];
        for (const next of neighbors) if (next >= 0 && !seen[next] && (mask[next] === 1 || mask[next] === 2)) { seen[next] = 1; queue[tail++] = next; }
    }
    return tail;
}

module.exports = { CATEGORIES, listRoomTemplateFiles, loadTemplateCatalog, readTemplate };
