'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Simulation = require('../server/simulation');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('boss direction and room reveal markers are absent from the player view and minimap', () => {
    const game = source('js/game.js');
    const renderStart = game.indexOf('// Player bullets');
    const worldRenderEnd = game.indexOf('ctx.restore();', renderStart);
    assert.notEqual(renderStart, -1);
    assert.notEqual(worldRenderEnd, -1);
    const gameplayOverlay = game.slice(renderStart, worldRenderEnd);
    assert.doesNotMatch(gameplayOverlay, /Objective chevron|bossRoom|Math\.atan2|cameraFocus\.x \+/);

    const ui = source('js/ui.js');
    const minimapStart = ui.indexOf('drawMinimap(');
    const minimapEnd = ui.indexOf('showLevelUp(', minimapStart);
    assert.notEqual(minimapStart, -1);
    assert.notEqual(minimapEnd, -1);
    const minimap = ui.slice(minimapStart, minimapEnd);
    assert.doesNotMatch(minimap, /bossRoom/);
    assert.match(minimap, /if \(map\.exit\)/, 'the exit remains visible after the boss fight');

    const map = source('js/map.js');
    assert.doesNotMatch(map, /markerPoint/);
});

for (const playerCount of [1, 2]) {
    test(`${playerCount === 1 ? 'solo' : 'coop'} keeps boss-room generation after compass removal`, () => {
        const members = Array.from({ length: playerCount }, (_, index) => ({
            id: `boss-room-${playerCount}-${index}`, name: `Test ${index + 1}`, character: 'pistolero'
        }));
        const run = Simulation.createRun(members);
        const bossRoom = run.map.bossRoom;
        assert.ok(bossRoom);
        assert.equal(bossRoom.type, 'boss');
        const enemies = run.map.getEnemiesForRoom(bossRoom, null, 0, run.floor);
        assert.equal(enemies.filter(enemy => enemy.type === 'boss').length, 1);
    });
}
