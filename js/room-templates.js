/**
 * Reads designer-authored room masks. The Node server discovers files from
 * their category folders, so adding/removing a PNG needs no code or manifest
 * edits. The manifest remains a fallback for static hosts.
 */
class RoomTemplateLibrary {
    static root = 'assets/plantillas-salas/';
    static categories = ['entry', 'hub', 'combat', 'combat-hard', 'treasure', 'boss'];
    static catalogTimeoutMs = 3500;
    static imageTimeoutMs = 2500;
    static imageConcurrency = 4;
    static byType = new Map();
    static byId = new Map();
    static orientedById = new Map();
    static diagnostics = [];
    static loaded = false;
    static loading = null;

    static async load({ force = false } = {}) {
        if (this.loading && !force) return this.loading;
        if (this.loaded && !force) return this.byType;
        this.loaded = false;
        this.loading = this.loadFresh();
        try { return await this.loading; }
        finally { this.loading = null; }
    }

    static async loadFresh() {
        this.byType = new Map(this.categories.map(type => [type, []]));
        this.byId = new Map();
        this.orientedById = new Map();
        this.diagnostics = [];
        try {
            const manifest = await this.fetchCatalog();
            const entries = Object.entries(manifest.templates || {}).flatMap(([type, paths]) =>
                this.categories.includes(type) && Array.isArray(paths)
                    ? paths.map(path => ({ type, path })) : []);
            // A missing/stalled image must not keep the start screen open forever.
            // Load a few at a time so slow assets do not serialize the whole catalog.
            const results = new Array(entries.length);
            let next = 0;
            const worker = async () => {
                while (next < entries.length) {
                    const index = next++;
                    const { type, path } = entries[index];
                    if (!this.safePath(type, path)) {
                        results[index] = { type, path, error: new Error('ruta inválida') };
                        continue;
                    }
                    try {
                        const image = await this.loadImage(path, manifest.revision);
                        try {
                            results[index] = { type, path, template: this.readImage(image, type, path) };
                        } finally {
                            image.src = '';
                        }
                    } catch (error) {
                        results[index] = { type, path, error };
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(this.imageConcurrency, entries.length) }, worker));
            for (const result of results) {
                if (result.error) {
                    const message = `${result.type}/${result.path}: ${result.error?.message || 'no se pudo leer'}`;
                    this.diagnostics.push(message);
                    console.warn(`Plantilla ignorada: ${message}`);
                    continue;
                }
                if (!result.template) continue;
                this.byType.get(result.type).push(result.template);
                this.byId.set(result.template.id, result.template);
            }
        } catch (error) {
            this.diagnostics.push(`No se pudo leer el catálogo de salas: ${error?.message || error}`);
            console.warn('Se usará el generador de respaldo; no se pudo leer el catálogo de salas.', error);
        }
        this.loaded = true;
        return this.byType;
    }

    static async fetchCatalog() {
        try {
            return await this.fetchJson('/api/room-templates');
        } catch (_) { /* static-host fallback below */ }
        return this.fetchJson(`${this.root}manifest.json`);
    }

    static async fetchJson(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.catalogTimeoutMs);
        try {
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    static loadImage(path, revision) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                image.onload = null;
                image.onerror = null;
                if (error) {
                    image.src = '';
                    reject(error);
                } else resolve(image);
            };
            const timer = setTimeout(() => finish(new Error('tiempo de espera agotado')), this.imageTimeoutMs);
            image.onload = () => finish();
            image.onerror = () => finish(new Error('no se pudo cargar la imagen'));
            const cacheKey = revision ? `?rev=${encodeURIComponent(revision)}` : '';
            image.src = this.root + path + cacheKey;
            if (image.complete && image.naturalWidth) finish();
        });
    }

    static safePath(type, value) {
        if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/')) return false;
        const parts = value.split('/');
        return parts[0] === type && parts.every(part => part && part !== '.' && part !== '..');
    }

    static readImage(image, type, path) {
        const cellPixels = 40;
        if (image.naturalWidth % cellPixels || image.naturalHeight % cellPixels) {
            throw new Error(`dimensiones ${image.naturalWidth}x${image.naturalHeight}; deben ser múltiplos de 40 px`);
        }
        const width = image.naturalWidth / cellPixels, height = image.naturalHeight / cellPixels;
        if (width < 3 || height < 3 || width > 64 || height > 64) throw new Error('tamaño de cuadrícula fuera del rango 3–64 losas');
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('canvas no disponible');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const mask = new Uint8Array(width * height), enemySpawns = [];
        let playerSpawn = null;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const p = ((y * cellPixels + Math.floor(cellPixels / 2)) * canvas.width + x * cellPixels + Math.floor(cellPixels / 2)) * 4;
            const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2], a = pixels[p + 3];
            const i = y * width + x;
            if (a === 0) mask[i] = 0;
            else if (r === 0 && g === 255 && b === 0) mask[i] = 1;
            else if (r === 255 && g === 255 && b === 0) mask[i] = 2;
            else if (r === 0 && g === 255 && b === 255) { mask[i] = 1; playerSpawn = { x, y }; }
            else if (r === 255 && g === 0 && b === 255) { mask[i] = 1; enemySpawns.push({ x, y }); }
            else if (r === 0 && g === 0 && b === 255) mask[i] = 3;
            else mask[i] = 0;
        }
        markExteriorBlue(mask, width, height);
        const doors = collectDoors(mask, width, height);
        validateDoorWidths(doors);
        const reachable = collectReachable(mask, width, height);
        const walkableCells = [];
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            if (mask[i] === 1) walkableCells.push({ x, y });
        }
        if (!walkableCells.length) throw new Error('no contiene suelo transitable interior');
        const doorCells = doors.reduce((total, door) => total + door.length, 0);
        const walkableTotal = mask.reduce((total, cell) => total + (cell === 1 || cell === 2 ? 1 : 0), 0);
        if (reachable !== walkableTotal) throw new Error('contiene suelo o puertas aislados');
        return { id: path, path, type, widthTiles: width, heightTiles: height, mask, doors,
            walkableCells, enemySpawns, playerSpawn, doorCells };
    }

    static getById(id) {
        if (!id) return null;
        const match = /^(.*)#r([0-3])$/.exec(id);
        const base = this.byId.get(match ? match[1] : id);
        if (!base) return null;
        if (!match) return base;
        if (!this.orientedById.has(id)) this.orientedById.set(id, rotateTemplate(base, Number(match[2])));
        return this.orientedById.get(id);
    }

    static pick(type) {
        const options = this.byType.get(type);
        return options?.length ? options[Math.floor(Math.random() * options.length)] : null;
    }
}

function collectDoors(mask, width, height) {
    const doors = [];
    const edges = [
        ['N', width, i => i, i => i],
        ['S', width, i => (height - 1) * width + i, i => i],
        ['W', height, i => i * width, i => i],
        ['E', height, i => i * width + width - 1, i => i]
    ];
    for (const [side, length, indexAt, offsetAt] of edges) {
        let start = -1;
        for (let i = 0; i <= length; i++) {
            const marked = i < length && mask[indexAt(i)] === 2;
            if (marked && start < 0) start = i;
            if (!marked && start >= 0) { doors.push({ side, offset: offsetAt(start), length: i - start }); start = -1; }
        }
    }
    return doors;
}

function validateDoorWidths(doors) {
    for (const door of doors) if (door.length !== 2) throw new Error(`puerta ${door.side} de ${door.length} losas; cada puerta debe medir 2`);
}

function markExteriorBlue(mask, width, height) {
    const queue = new Int32Array(mask.length);
    let head = 0, tail = 0;
    const add = index => { if (mask[index] === 3) { mask[index] = 0; queue[tail++] = index; } };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        if (x) add(i - 1); if (x + 1 < width) add(i + 1);
        if (y) add(i - width); if (y + 1 < height) add(i + width);
    }
}

function collectReachable(mask, width, height) {
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

function rotateTemplate(template, turns) {
    let current = template;
    for (let turn = 0; turn < turns; turn++) {
        const width = current.heightTiles, height = current.widthTiles, mask = new Uint8Array(width * height);
        const point = p => ({ x: current.heightTiles - 1 - p.y, y: p.x });
        for (let y = 0; y < current.heightTiles; y++) for (let x = 0; x < current.widthTiles; x++) {
            const next = point({ x, y }); mask[next.y * width + next.x] = current.mask[y * current.widthTiles + x];
        }
        current = { ...current, id: `${template.path}#r${turn + 1}`, widthTiles: width, heightTiles: height,
            mask, doors: collectDoors(mask, width, height), walkableCells: current.walkableCells.map(point),
            playerSpawn: current.playerSpawn ? point(current.playerSpawn) : null,
            enemySpawns: current.enemySpawns.map(point) };
    }
    return { ...current, id: `${template.path}#r${turns}`, path: template.path, type: template.type };
}
