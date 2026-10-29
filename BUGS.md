# Bug Tracker — Abyss Engine

Engineering log for the project. Fixed entries are kept deliberately: the
debugging path is part of the record, not noise.

**Last verified:** 2026-08-20, against a headless Chromium run of `index.html`.

---

## Open

### A. `ensureConnectivity()` is a no-op
- **File:** `js/map.js` — `ensureConnectivity()`
- **Symptom:** None observable; the function does not do what its name claims.
- **Cause:** It performs a BFS and fills a `visited` set, then returns without
  ever acting on the result — no corridor is added for an unreachable room.
- **Verified:** calling it leaves room and corridor counts unchanged.
- **Why it doesn't bite:** every room is placed adjacent to a parent and gets a
  corridor at placement time, so the graph is already connected by construction.
- **Fix:** either add corridors for unvisited rooms, or delete the function and
  document that placement guarantees connectivity. It is also `O(rooms² ×
  corridors)` as written.
- **Severity:** 🟢 Dead logic.

---

## Fixed

### 1. Player aim used mismatched coordinate spaces 🔴
- **File:** `js/player.js` — `update()`
- **Symptom:** Bullets fired in the wrong direction whenever the camera was
  away from the origin.
- **Cause:** The aim vector subtracted the player's **world**-space position
  from the mouse's **screen**-space position.
- **Fix:** `player.update()` now takes the camera and converts the mouse to
  world space (`camera.x + input.mouseX`) before computing the direction.
  `game.js` updates the camera *before* the player so the conversion uses the
  current frame's camera.
- **Status:** ✅ Fixed.

### 2. Start room could also be the exit room 🔴
- **File:** `js/map.js` — `setExitRoom()`
- **Symptom:** The headline bug of the project. On pressing **Start**, the
  screen fell into an endless fade-out/fade-in cycle and the player could not
  be moved.
- **Cause:** The exit could be assigned to the start room, so the player spawned
  on top of the exit trigger. `checkRoomTransition()` fired immediately, entered
  `TRANSITIONING`, regenerated the map, dropped the player on the exit again —
  and looped forever. Because `update()` is skipped while `TRANSITIONING`, WASD
  did nothing, and the ~640 ms fade cycle read as the player "flashing".
- **Fix:** `setExitRoom()` now filters the start room out of the exit candidates
  and picks the farthest remaining room.
- **Verified:** across 300 generated maps — 0 spawns inside the exit room,
  0 spawns within the 30 px trigger radius.
- **Status:** ✅ Fixed. *(Earlier notes blamed a double RAF chain; that was a
  real but separate issue — see 3.)*

### 3. Double `requestAnimationFrame` chain 🔴
- **File:** `js/game.js` — `startLoop()` / `loop()`
- **Symptom:** Doubled update speed and frames drawn twice per tick.
- **Cause:** `startLoop()` could be called while a RAF chain was already alive,
  spawning a second independent chain.
- **Fix:** a `loopRunning` flag guards `startLoop()`. Crucially, it is only
  cleared where the chain actually stops (`GAME_OVER` and `start()`) — not on
  unpause or upgrade, since those states keep re-scheduling RAF.
- **Verified:** `frameCount` advanced 61 frames per second with `loop()` called
  exactly 61 times — a 1:1 ratio, so a single chain.
- **Status:** ✅ Fixed.

### 4. Corridors rendered as hairlines instead of floors 🟡
- **File:** `js/map.js` — `createCorridor()`, `calculatePositions()`,
  `corridorSegments()`, `draw()`
- **Symptom:** Corridors appeared as thin grey lines, so the dungeon read as a
  scatter of disconnected boxes rather than a connected floor plan.
- **Cause:** Two defects compounding. `corridorSegments()` returned segments of
  zero thickness (`y1 === y2` horizontally, `x1 === x2` vertically), so the
  `fillRect()` in `draw()` was handed a height or width of `0` and painted
  nothing — only the `0.5px` stroke showed. Separately, `createCorridor()`
  connected room **top-left corners** rather than centres, because it runs
  during `generate()` before `calculatePositions()` has computed `cx`/`cy`.
- **Fix:** `createCorridor()` now stores room references only, and
  `calculatePositions()` resolves endpoints to room centres once they exist.
  `corridorSegments()` returns rectangles of real width (`corridorWidth`, 2
  tiles), each extended by a half width at its ends so the elbow joins cleanly.
  The rectangle stroke was dropped — corridors draw over rooms, so their floor
  now punches a doorway through the room wall, and an outline would streak
  across it.
- **Verified:** across 200 generated maps, 0 degenerate segments and a minimum
  thickness of 64 px. The minimap benefits too, since it now traces
  centre-to-centre.
- **Status:** ✅ Fixed.

### 5. Rooms were smaller than the enemy AI ranges they had to contain 🔴
- **File:** `js/map.js`, `js/enemy.js`, `js/player.js`, `js/game.js`
- **Symptom:** Enemies were on top of the player the instant a room was entered,
  and repeatedly left the room entirely.
- **Cause:** A geometry contradiction, not a tuning problem. `MoscaTirador`
  holds a 180–250 px standoff and `SpiralEnemy` closes to 140 px, but rooms
  were 128–256 px across. The Mosca Tirador could not satisfy its standoff without
  walking out through a wall. Enemies also spawned blind at the room centre,
  which in a 256 px room is ~128 px from whoever triggered the spawn.
- **Fix:** rooms scaled to 640–1024 px (map 2000² → 7000², room count 8–12 →
  6–9, corridors 2 → 4 tiles wide). `spawnPointInRoom()` now retries placement
  to keep a 280 px minimum from the player, falling back to the best candidate
  rather than looping. Player speed 3.0 → 4.5 and magnet 60 → 100 to suit the
  larger space; enemy speeds scaled to match.
- **Verified:** across 565 sampled combat rooms entered at the doorway, the
  nearest enemy spawn is never closer than 280 px (median 337 px).
- **Status:** ✅ Fixed.

### 6. No wall collision 🟡
- **File:** `js/map.js` (`isWalkable`, `canOccupy`), `js/player.js`,
  `js/enemy.js` (`moveBy`)
- **Symptom:** The player could walk across the whole map, including the void
  between rooms, ignoring all room and corridor boundaries.
- **Cause:** Movement was clamped only to map bounds; room geometry was never
  consulted.
- **Fix:** the walkable area is the union of room and corridor rectangles.
  Movement resolves per axis so walls are slid along rather than stuck on.
  Enemies share the test via `Enemy.moveBy()`, which confines them to their
  room — necessary because they have no pathfinding.
- **Verified:** 614 live frames with 0 positions inside a wall; flood-fill
  reachability across 100 maps confirms every room and exit is still reachable
  on foot, so collision cannot make a level unwinnable.
- **Status:** ✅ Fixed.

### 7. Room geometry used two different conventions 🔴
- **File:** `js/map.js` — `overlapsAny()`, `tryPlaceRoom()`, `placeRoom()`
- **Symptom:** Rooms overlapping on screen. **This was previously logged as a
  latent issue that never manifested — scaling the rooms up made it active.**
- **Cause:** `overlapsAny()` treated `(tx, ty)` as the room's **centre** while
  `calculatePositions()` treated it as the **top-left**, so the rectangle being
  collision-checked sat half a room away from the one drawn. That offset is
  half the room size: 64–128 px at the old scale, which the 3-tile gap
  absorbed, but 320–512 px at the new one, which it could not.
- **Impact:** serious rather than cosmetic. Overlapping rooms make
  `pointInRoom()` return whichever room is first in the array, which is the
  same machinery behind bug 2 — the exit room's rect could cover the player's
  spawn and resurrect the infinite-transition bug.
- **Fix:** `(tx, ty)` is now the top-left tile everywhere. `tryPlaceRoom()`
  butts each room against its parent's edge with the gap, centred on the
  perpendicular axis so corridors run straight.
- **Verified:** overlapping maps went 112/200 → **0/200** after the fix.
- **Status:** ✅ Fixed.

### 8. Every enemy fired on its first frame 🟡
- **File:** `js/enemy.js` — `Enemy` constructor / `applyDifficulty()`
- **Symptom:** Walking into a room drew an instant volley from every enemy in
  it, with no time to read the layout.
- **Cause:** `shootTimer` was initialised to `0`, so the first `shootTimer--`
  in `update()` put it below the fire threshold immediately — and identically
  for every enemy, so their shots were synchronised rather than staggered.
- **Fix:** `applyDifficulty()` seeds `shootTimer` to a randomised fraction
  (0.6–1.2×) of the cooldown.
- **Status:** ✅ Fixed.

### 9. Enemy bullets passed through walls 🟢
- **File:** `js/game.js` — `updateEnemyBullets()`
- **Symptom:** Enemy fire crossed room and corridor walls, hitting the player
  through geometry neither could walk through.
- **Cause:** Enemy bullets were only tested against the player and the map
  bounds, never against walkable geometry.
- **Fix:** bullets are tested against `map.isWalkable()` after moving and burst
  into particles when they leave the floor. Checked *before* the player test,
  so a bullet entering a wall bursts rather than landing a hit. Player bullets
  are deliberately exempt — the asymmetry favours the player.
- **Verified:** a bullet fired at a wall 200 px away survived 33 frames of open
  floor, then popped 2 px short of the wall with no overshoot and no damage
  dealt; a bullet on open floor is not removed spuriously.
- **Status:** ✅ Fixed.

### 10. Game speed was tied to the display's refresh rate 🔴
- **File:** `js/game.js` — `loop()` / `update()`
- **Symptom:** The game ran faster on higher-refresh displays. Everything
  scaled together — movement, fire rate, bullet speed, invincibility windows,
  the difficulty ramp — so it read as "the pacing is too fast" rather than as
  a bug.
- **Cause:** `loop()` computed `dt` and passed it to `update(dt)`, which never
  used it. Every value was applied per rendered frame, so the simulation rate
  *was* the refresh rate.
- **Measured before the fix:** 272 px/s at 60 Hz, 540 at 120 Hz, 704 at 144 Hz
  — a 2.6× spread.
- **Fix:** a fixed-timestep accumulator. The simulation steps at a constant
  60 Hz while rendering stays once per animation frame. A fixed step was chosen
  over a `dt` multiplier because every gameplay value in this project is a
  frame count; scaling by `dt` would have required rescaling each one and would
  have silently changed the existing tuning.
- **Verified after the fix:** 270 px/s at 30, 60, 90, 120, 144 and 240 Hz — an
  8× refresh range at one speed (±2%, a single step landing across the sample
  boundary). Frames rendered still scale 16 → 122, so high-refresh displays stay
  smooth. Difficulty-ramp values are unchanged, confirming tuning was preserved.
- **Status:** ✅ Fixed.

### 11. Input stuck on lost focus 🟡
- **File:** `js/game.js` — `bindInput()`
- **Symptom:** Holding a movement key and switching windows left the player
  walking on their own after returning. Releasing the mouse button after moving
  the cursor off the canvas left the player firing indefinitely.
- **Cause:** `keyup` only arrives if the window has focus when the key is
  released, and `mouseup` was bound to the canvas, so a release anywhere else
  was never seen.
- **Fix:** `mouseup` moved to the window, plus a `blur` handler that clears all
  held keys and the mouse state.
- **Verified:** a key held across a `blur` event is cleared with 0 px of drift;
  a button released off-canvas clears `mouseDown`.
- **Status:** ✅ Fixed.

### 12. `class Map` shadowed the built-in `Map` 🟡
- **File:** `js/map.js`
- **Symptom:** `new Map()` in `js/touch.js` produced an object with no
  `.clear()`, crashing the touch controls with
  `this.pointers.clear is not a function`.
- **Cause:** a top-level `class Map` in a classic script creates a global
  lexical binding that shadows the built-in `Map` for *every* script on the
  page. Any `new Map()` anywhere in the project silently returned a dungeon.
  (`globalThis.Map` still resolved to the native constructor, which is what
  made the failure so confusing.)
- **Fix:** renamed the class to `DungeonMap`. Only two call sites existed, so
  the rename was cheap — and left in place it would have kept producing this
  bug, since `new Map()` is such ordinary code.
- **Status:** ✅ Fixed.

### 13. Boss enemy was unreachable content 🟢
- **File:** `js/enemy.js` (`BossEnemy`), `js/map.js` (`setBossRoom()`)
- **Symptom:** A complete multi-phase boss — phase indicator, wide health bar,
  three distinct attack patterns — never appeared in play.
- **Cause:** nothing ever assigned the `boss` room type, so that branch of
  `getEnemiesForRoom()` and `createEnemy('boss', …)` were unreachable.
- **Fix:** `setBossRoom()` marks the room farthest from the start as the boss
  room on every floor, and the floor's exit is gated behind killing it.
- **Verified:** 300 generated maps all produced a boss room, never the start
  room, always adjacent to a corridor — so no floor can softlock.
- **Status:** ✅ Fixed.

### 14. Levelling capped at 10 while enemy scaling continued forever 🔴
- **File:** `js/player.js` — `xpToNext()`
- **Symptom:** the HUD read `Lv 10 — 907 / 0`. Past level 10 XP orbs did
  nothing, no further upgrades were offered, and a run met steadily harder
  floors with a permanently fixed build.
- **Cause:** two faults in one guard. `if (this.level >= this.xpTable.length)`
  returned 0 as "max level", which both capped progression *and* was off by
  one — the table's final entry (2400) was unreachable. The zero then surfaced
  in the HUD as a `/ 0` denominator.
- **Impact:** the endgame scaling added earlier made this decisive rather than
  cosmetic. Enemy health grows without limit, so a capped player is guaranteed
  to hit a wall they cannot build against. Reported from a real run: floor 14,
  level 10, 907 XP banked into nothing.
- **Fix:** past the authored table the requirement continues geometrically at
  `XP_GROWTH`, so there is no cap. 1.20 rather than the table's own ≈1.30,
  which compounds too hard against XP income that only grows about 10% per
  floor.
- **Verified:** levels 1–10 unchanged; level 11 reachable; the curve settles at
  roughly one level every 4–6 floors, stretching to 7 by level 22.
- **Status:** ✅ Fixed.

### 15. `gameOver()` left the level-up screen visible 🟡
- **Fix:** `gameOver()` now calls `hideLevelUp()` first, so dying mid-draft no
  longer stacks two overlays and blocks restart. **Status:** ✅ Fixed.

### 16. Game loop never stopped after game over 🟡
- **Fix:** the `GAME_OVER` branch of `loop()` returns without re-scheduling.
  **Status:** ✅ Fixed.

### 17. Player could act during room transitions 🟡
- **Fix:** added a `TRANSITIONING` state that renders but skips updates, plus a
  re-entry guard so an in-flight transition can't start another.
  **Status:** ✅ Fixed.

### 18. Confirm button worked with no upgrade selected 🟢
- **Fix:** `applyUpgrade()` returns early and shows a "No upgrade selected!"
  notification. **Status:** ✅ Fixed.

### 19. Only one upgrade shown for a multi-level XP gain 🟢
- **Cause:** `gainXP()` performs the level itself, so re-deriving pending levels
  from `xp >= xpToNext()` always read false.
- **Fix:** a `pendingLevelUps` counter is incremented per level and drained one
  upgrade screen per frame. **Status:** ✅ Fixed.

### 20. Redundant `Game.level` 🟢
- **Fix:** removed; `player.level` is the single source of truth.
  **Status:** ✅ Fixed.

### 21. Over-generous bullet cleanup margin 🟢
- **Fix:** call sites pass a margin of `50` instead of the `100` default.
  **Status:** ✅ Fixed.

### 22. Confusing "Full Heal" upgrade 🟢
- **Fix:** `p.health = p.maxHealth` instead of `p.heal(p.maxHealth)`.
  **Status:** ✅ Fixed.

### 23. Debug scaffolding shipped in the build 🟢
- **Symptom:** A yellow monospace `DEBUG` readout in the HUD showing invincibility
  timers and bullet counts.
- **Fix:** removed the `#debug-info` element, the per-60-frame debug writer in
  `updateEnemyBullets()`, the debug string threaded through `ui.updateHUD()`, the
  never-read `totalDamageAttempts` counter, the uncalled `bulletHitsEnemy()`
  helper, and four committed `.bak` / `.debug_backup` files.
  **Status:** ✅ Fixed.

---

## Summary

| Severity | Open | Fixed |
|---|---|---|
| 🔴 Critical | 0 | 7 |
| 🟡 Moderate | 0 | 8 |
| 🟢 Minor | 2 | 8 |
