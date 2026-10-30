'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Simulation = require('../server/simulation');
const { loadTemplateCatalog, listRoomTemplateFiles, readTemplate } = require('../server/template-catalog');

const root = path.resolve(__dirname, '..');
const templateRoot = path.join(root, 'assets', 'plantillas-salas');
const minionTypes = new Set(['esbirro_miedoso', 'mosca_tirador', 'esbirro_tirador', 'spiral']);

test('current PNG masks expose enough distinct magenta cells for their named category', () => {
    const catalog = loadTemplateCatalog(templateRoot);
    assert.deepEqual(catalog.diagnostics, []);
    for (const type of ['combat', 'combat-hard']) {
        assert.ok(catalog.byType.get(type).length);
        for (const template of catalog.byType.get(type)) {
            assert.ok([3, 4, 5].includes(template.minionCount), template.path);
            assert.ok(template.enemySpawns.length >= template.minionCount, template.path);
            assert.equal(new Set(template.enemySpawns.map(cell => `${cell.x},${cell.y}`)).size,
                template.enemySpawns.length, template.path);
            for (const cell of template.enemySpawns) {
                assert.equal(template.mask[cell.y * template.widthTiles + cell.x], 1, template.path);
            }
        }
    }
    const giant = catalog.byType.get('combat').find(template =>
        template.path.endsWith('sala gigante_3 puertas_combat.png'));
    assert.equal(giant?.minionCount, 5);
    const manifest = JSON.parse(fs.readFileSync(path.join(templateRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, listRoomTemplateFiles(templateRoot));

    const hubPath = listRoomTemplateFiles(templateRoot).templates.hub[0];
    const hubBuffer = fs.readFileSync(path.join(templateRoot, ...hubPath.split('/')));
    assert.throws(() => readTemplate(hubBuffer, 'combat', 'combat/sala pequena_sin marcas.png'),
        /requiere 3 casillas #FF00FF/);
    assert.throws(() => readTemplate(hubBuffer, 'combat', 'combat/sala desconocida.png'),
        /nombre sin categoría/);
    assert.throws(() => readTemplate(hubBuffer, 'combat', 'combat/sala grande 01.png'),
        /nombre sin categoría/);
});

test('browser template reader preserves the same magenta slots and counts as the server', () => {
    const catalog = loadTemplateCatalog(templateRoot);
    const templates = [catalog.byType.get('combat')[0], catalog.byType.get('combat-hard')[0]];
    for (const template of templates) {
        const width = template.widthTiles * 40, height = template.heightTiles * 40;
        const pixels = new Uint8ClampedArray(width * height * 4);
        const markers = new Set(template.enemySpawns.map(cell => `${cell.x},${cell.y}`));
        for (let y = 0; y < template.heightTiles; y++) for (let x = 0; x < template.widthTiles; x++) {
            const kind = template.mask[y * template.widthTiles + x];
            const color = markers.has(`${x},${y}`) ? [255, 0, 255] :
                kind === 1 ? [0, 255, 0] : kind === 2 ? [255, 255, 0] :
                    kind === 3 ? [0, 0, 255] : [255, 0, 0];
            const p = ((y * 40 + 20) * width + x * 40 + 20) * 4;
            pixels.set([...color, 255], p);
        }
        const context = vm.createContext({ document: { createElement: () => ({
            width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) })
        }) } });
        vm.runInContext(fs.readFileSync(path.join(root, 'js/room-templates.js'), 'utf8'), context);
        const Library = vm.runInContext('RoomTemplateLibrary', context);
        const browser = Library.readImage({ naturalWidth: width, naturalHeight: height }, template.type, template.path);
        assert.equal(browser.minionCount, template.minionCount);
        assert.deepEqual(Array.from(browser.mask), Array.from(template.mask));
        assert.deepEqual(JSON.parse(JSON.stringify(browser.enemySpawns)), template.enemySpawns);
    }
});

test('each esbirro is drawn independently using the configured relative floor weights', () => {
    const Stub = class {};
    let random = 0;
    const math = Object.create(Math);
    math.random = () => random;
    const context = vm.createContext({ Math: math, EsbirroMiedoso: Stub, MoscaTirador: Stub,
        EsbirroTirador: Stub, SpiralEnemy: Stub, BossEnemy: Stub,
        CochinillaEsquinero: Stub, BabosaPersecucion: Stub });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/enemies/catalog.js'), 'utf8'), context);
    const pick = vm.runInContext('randomEnemyType', context);
    const counts = Object.fromEntries([...minionTypes].map(type => [type, 0]));
    for (let i = 0; i < 75; i++) {
        random = (i + 0.5) / 75;
        counts[pick('esbirros', 1)]++;
    }
    assert.deepEqual(counts, { esbirro_miedoso: 25, mosca_tirador: 10,
        esbirro_tirador: 20, spiral: 20 });
    random = 0.5;
    assert.equal(pick('esbirros', 2), pick('esbirros', 1));
});

function inspectPreparedFloor(run) {
    for (const [index, enemies] of run.preparedEnemiesByRoom) {
        const room = run.map.rooms[index];
        if (!['combat', 'combat-hard'].includes(room.type) || !room.template) continue;
        const minions = enemies.filter(enemy => minionTypes.has(enemy.type));
        assert.equal(minions.length, room.template.minionCount, room.template.path);
        assert.equal(new Set(minions.map(enemy => `${enemy.spawnMarker.x},${enemy.spawnMarker.y}`)).size,
            minions.length, room.template.path);
        for (const enemy of minions) {
            const markerX = room.x + (enemy.spawnMarker.x + 0.5) * run.map.tileSize;
            const markerY = room.y + (enemy.spawnMarker.y + 0.5) * run.map.tileSize;
            assert.ok(Math.hypot(enemy.x - markerX, enemy.y - markerY) <= 16.001, room.template.path);
            assert.equal(Math.floor((enemy.x - room.x) / run.map.tileSize), enemy.spawnMarker.x);
            assert.equal(Math.floor((enemy.y - room.y) / run.map.tileSize), enemy.spawnMarker.y);
            for (let i = 0; i < 32; i++) {
                const angle = i * Math.PI / 16;
                const x = enemy.x + Math.cos(angle) * enemy.radius;
                const y = enemy.y + Math.sin(angle) * enemy.radius;
                assert.equal(run.map.isWalkable(x, y), true, `${room.template.path}: hitbox intersects solid tile`);
            }
            for (const other of enemies) {
                if (enemy === other) continue;
                assert.ok(Math.hypot(enemy.x - other.x, enemy.y - other.y) >=
                    enemy.radius + other.radius + 2, `${room.template.path}: enemy overlap`);
            }
        }
        if (room.type === 'combat-hard') {
            assert.ok(enemies.filter(enemy => !minionTypes.has(enemy.type)).length <= 1);
        }
        assert.equal(room.spawned, false);
    }
    assert.equal(run.enemies.length, 0, 'prepared enemies remain dormant');
}

test('two-player server prepares unique safe spawns on each floor before activation', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
        const run = Simulation.createRun([
            { id: 'one', name: 'Uno', character: 'pistolero' },
            { id: 'two', name: 'Dos', character: 'tirador' }
        ]);
        assert.equal(run.map.generationFallback, false);
        inspectPreparedFloor(run);
        run.phase = 'loading';
        run.nextFloorPending = true;
        assert.equal(Simulation.completeFloorTransition(run), true);
        assert.equal(run.floor, 2);
        inspectPreparedFloor(run);
    }
});
