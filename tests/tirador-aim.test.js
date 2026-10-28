'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console });
for (const file of ['js/characters/roles.js', 'js/player.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const createPlayer = vm.runInContext('(character) => { const p = new Player(100, 100); p.setCharacter(character); return p; }', context);
const update = (player, events = {}) => player.update({
  keys: {}, moveX: 0, moveY: 0, aimActive: true, aimX: 1, aimY: 0,
  mouseDown: false, mousePressed: false, mouseReleased: false, ...events
}, null, null);

test('Tirador apunta al presionar y dispara una sola vez al soltar', () => {
  const player = createPlayer('tirador');
  assert.equal(update(player, { mousePressed: true }), false);
  assert.equal(player.sniperAiming, true);
  assert.equal(player.ammo, 3);
  assert.equal(player.fireTimer, 0);
  assert.equal(update(player, { mouseDown: true }), false);
  assert.equal(player.ammo, 3);
  assert.equal(update(player, { mouseDown: true }), false);
  assert.equal(update(player, { mouseReleased: true }), true);
  assert.equal(player.sniperAiming, false);
  assert.equal(player.ammo, 2);
  assert.equal(player.fireTimer, 72);
  assert.equal(update(player, { mouseReleased: true }), false);
  assert.equal(player.ammo, 2);
});

test('mantener presionado durante la cadencia no arma un disparo pendiente', () => {
  const player = createPlayer('tirador');
  update(player, { mousePressed: true });
  assert.equal(update(player, { mouseReleased: true }), true);
  update(player, { mousePressed: true, mouseDown: true });
  assert.equal(player.sniperAiming, false);
  for (let i = 0; i < 75; i++) update(player, { mouseDown: true });
  assert.equal(player.sniperAiming, false);
  assert.equal(player.ammo, 2);
  assert.equal(update(player, { mouseReleased: true }), false);
  assert.equal(player.ammo, 2);
});

test('sin munición, recargando o cancelado no conserva el apuntado', () => {
  const player = createPlayer('tirador');
  player.ammo = 0;
  player.reloadTimer = 10;
  assert.equal(update(player, { mousePressed: true }), false);
  assert.equal(player.sniperAiming, false);
  player.reloadTimer = 0;
  player.ammo = 1;
  update(player, { mousePressed: true });
  assert.equal(player.sniperAiming, true);
  assert.equal(update(player, { cancelAim: true, mouseReleased: true }), false);
  assert.equal(player.sniperAiming, false);
  assert.equal(player.ammo, 1);
});

test('Tirador crea un proyectil incluso si una mejora cambia bulletCount', () => {
  const player = createPlayer('tirador');
  player.bulletCount = 5;
  assert.equal(player.shoot().length, 1);
});

test('los demás roles mantienen el disparo sostenido existente', () => {
  const player = createPlayer('pistolero');
  assert.equal(update(player, { mouseDown: true }), true);
  assert.equal(player.ammo, 9);
  assert.equal(player.sniperAiming, false);
});

