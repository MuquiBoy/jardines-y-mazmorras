# Jardines y Mazmorras

*A procedural bullet hell that runs in the browser.*

A top-down bullet hell roguelite. Descend a procedurally generated dungeon,
find the boss holding each floor, and kill it to open the way down. No game
engine, no build step, no dependencies — just HTML, CSS and vanilla JavaScript
drawing to a single `<canvas>`.

**▶ [Play it](https://jorge-erdb.com/abyss-engine/)** &nbsp;·&nbsp; *(live once GitHub Pages is enabled — see [Deployment](#deployment))*

---

## What it does

Each run drops you into a procedurally generated dungeon. Rooms populate with
enemies the first time you enter them, killing enemies drops XP orbs, and
collecting enough XP opens an upgrade draft.

There is **no exit** when a floor begins. One room holds a boss, and the way
down only opens once it is dead — so a floor has to be explored rather than
walked past. Descend to regenerate a fresh dungeon and keep your build. Die and
the run ends.

| | |
|---|---|
| **Procedural maps** | 6–9 rooms grown outward from a start room, spacing-checked, then typed (combat, hard combat, treasure, empty, exit) and connected by corridors you walk down |
| **Roguelite upgrades** | 10 upgrades drafted 3-at-a-time on level-up — health, damage, speed, multi-shot, pierce, fire rate, bullet speed, pickup magnet |
| **Enemy variety** | Esbirro Miedoso chasers, the kiting Mosca Tirador, and spiral emitters, each with its own movement and firing pattern |
| **Floor composition** | Encounter types and group sizes can vary by floor; each enemy keeps its authored statistics |
| **Boss gate** | Each floor's exit is locked behind a multi-phase boss, and opens where you kill it |
| **Sound** | Effects synthesized live via Web Audio — no samples to download — over a three-track soundtrack that advances each floor |
| **Feel** | Screen shake and damage flash on hit, low-health pulse, invincibility blink, particle bursts, magnet-pull on XP orbs, live minimap with threats |
| **Presentation** | Loose modern retro on a chunky pixel grid, DOOM-register palette — rust and dried blood, hot amber for anything urgent |

## Controls

**Keyboard and mouse**

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Shoot |
| `Space` | Pause / resume |

**Touch — twin-stick, landscape only**

| Input | Action |
|---|---|
| Left half of screen | Move |
| Right half of screen | Aim, and fire while held |
| Pause button, top right | Pause |

Both sticks *float*: they appear wherever the thumb lands rather than at a
fixed spot, which is what makes them usable without looking down. A portrait
viewport shows a rotate prompt instead — a bullet hell needs simultaneous
movement and aim, and portrait puts both thumbs over the play area.

## Ejecutar la versión cooperativa local

Para jugar cooperativo requiere Node.js; no hay paquetes de terceros que instalar.

```bash
node server.js
```

En Windows también puedes iniciar el servidor haciendo doble clic en
`INICIAR-JUEGO.bat`; deja abierta la ventana mientras juegas.

Abre `http://localhost:8080`, crea una sala y comparte el enlace con hasta dos
amigos. El servidor conserva la autoridad del movimiento, mazmorra y combate.
Para jugar sin conexión, abre `index.html` y elige **Jugar sin conexión**; esa
ruta usa la campaña individual original y no requiere que el servidor esté activo.

La sala es local al proceso y se pierde cuando se detiene el servidor. Un enlace
con `localhost` solo sirve en esa máquina; jugar por Internet requiere desplegar
el servidor con WebSocket seguro y compartir una dirección pública.

## Documentación del proyecto

- [Visión del juego](docs/PROJECT_VISION.md)
- [Auditoría de la base y licencias](docs/BASE_CODE_AUDIT.md)
- [Arquitectura multijugador](docs/MULTIPLAYER_ARCHITECTURE.md)
- [Plan de desarrollo y avance](docs/DEVELOPMENT_PLAN.md)

## Ejecutar la versión individual original

There is no build step for the original single-player game. Any static file server works:

```bash
git clone https://github.com/jorge-erdb/abyss-engine.git
cd abyss-engine
python3 -m http.server 8000
# open http://localhost:8000
```

Para multijugador, siempre entra por la dirección local del servidor; `file://`
no puede abrir conexiones de grupo.

## Publicación web

`render.yaml` configura un único servicio web para servir el juego y su conexión
WebSocket cooperativa desde el mismo dominio. Al enlazar el repositorio a Render,
cada actualización de `main` vuelve a publicar la demo. Las partidas guardadas en
memoria se reinician si el servicio se reinicia o se despliega una actualización.
No incluir los MP3 en el repositorio público hasta confirmar su licencia.

## Architecture

Seven scripts load in dependency order and communicate through plain globals —
deliberately kept flat so the whole engine is readable end to end.

```
index.html          Canvas, HUD, and the four overlay screens (start / level-up / game over / pause)
css/styles.css      All presentation; overlays toggle via a .hidden class
js/
  player.js         Player state, movement, aim, shooting, XP curve, rendering
  bullet.js         Shared collision helpers and off-map cleanup
  enemy.js          Enemy base class; Esbirro and boss classes live in js/enemies/
  map.js            DungeonMap: procedural generation, room typing, spawn tables, world drawing
  palette.js        Colour identity and the pixel-grid constants + draw helpers
  touch.js          Twin-stick touch controls, landscape only
  ui.js             DOM HUD updates, minimap, overlay show/hide, canvas notifications
  game.js           The engine: state machine, game loop, collisions, camera, orchestration
  main.js           Bootstrap — builds the objects and wires up the buttons
```

### The game loop

`Game` runs an explicit state machine, and the loop branches on it:

```
START ──▶ PLAYING ⇄ PAUSED
             │  ⇄ LEVEL_UP
             │  ⇄ TRANSITIONING
             └──▶ GAME_OVER ──▶ PLAYING (restart)
```

A single `requestAnimationFrame` chain drives everything. `PAUSED`, `LEVEL_UP`
and `TRANSITIONING` keep **rendering** but skip **updating**, so the last frame
stays visible behind an overlay while the chain stays alive. Only `GAME_OVER`
returns without re-scheduling, which is what actually stops the loop.

That distinction matters: a `loopRunning` flag guards `startLoop()` against
scheduling a second chain. Two concurrent chains would advance timers at double
speed and draw twice per frame — the cause of a long-lived flickering bug during
development (see [BUGS.md](BUGS.md)).

### The pixel grid

The canvas backing store is the window divided by `PIXEL_SIZE`, stretched back
to full size by CSS with `image-rendering: pixelated` and
`imageSmoothingEnabled = false`. Everything therefore lands on a visible grid,
and the upscale is what produces the chunky look — there is no sprite work.

World drawing happens inside `ctx.scale(1 / PIXEL_SIZE, …)`, so entity code
keeps using world units. The consequence to remember: **canvas dimensions are
not world dimensions**. Camera maths and view culling use `viewWidth` /
`viewHeight`, which multiply back up.

This also settles the HiDPI question. Integer upscaling is exactly what a pixel
look wants, where a devicePixelRatio-smoothed canvas would fight it.

Entities are drawn as pixel-snapped rectangles rather than circles — at this
resolution a small circle turns to mush. `pixelRect()` and `pixelFrame()` in
`palette.js` are the two primitives everything is built from.

Floors are filled by `Map.fillFloor()`, whose checkerboard phase comes from
*global* tile coordinates rather than each rectangle's own origin. That is what
lets rooms and corridors be filled independently and still seam invisibly —
necessary because corridors run centre-to-centre and so cross room interiors.

### Input abstraction

Touch writes analogue `moveX/moveY` and `aimX/aimY` into the same `input`
object the keyboard and mouse use, so the rest of the engine never learns that
touch exists. `Player.update()` prefers the stick when it is deflected and
falls back to keys otherwise; aim takes a direction outright from a stick,
where the mouse supplies a screen point that must be converted to world space.

One naming trap worth knowing: the dungeon class is `DungeonMap`, not `Map`. A
top-level `class Map` in a classic script shadows the built-in `Map` for every
other script on the page, so an innocent `new Map()` anywhere in the project
silently returns a dungeon with no `.get`/`.set`/`.clear`.

### Simulation timing

The engine steps at a fixed logical rate (`FIXED_STEP_MS`, 60 Hz) rather than
once per rendered frame, with an accumulator draining real elapsed time into
whole steps. Rendering still happens once per animation frame, so a 144 Hz
display shows a 60 Hz simulation smoothly.

A fixed step rather than a `dt` multiplier is deliberate. Every gameplay value
here is expressed in frames — movement per tick, `fireRate`, `invincibleTimer`,
`shootCooldown`, particle `life` — so a fixed step
preserves all of them exactly, where scaling by `dt` would mean correctly
rescaling each one and silently changing the tuning.

`MAX_CATCHUP_STEPS` caps steps per frame. Without it a long stall (tab
restored, laptop woken) hands the loop a huge elapsed time, which costs more
than a frame to simulate, which grows the next elapsed time — the spiral of
death. Past the cap the extra time is dropped.

### Coordinate spaces

The world is 7000×7000 px; the canvas is a window onto it. The camera follows
the player, clamped to the map bounds, and rendering happens inside a
`ctx.translate(-camera.x, -camera.y)`. Mouse input arrives in **screen** space,
so aim converts it to **world** space (`camera.x + mouseX`) before computing a
direction — mixing the two was the project's original critical bug.

### Walls and room scale

The walkable area is the **union** of room and corridor rectangles. Movement is
resolved one axis at a time, so running diagonally into a wall slides along it
rather than stopping dead, and `canOccupy()` samples a circle's centre plus its
four cardinal extremes against that union. Enemies use the same test, which is
what keeps them in the room they spawned in — they have no pathfinding, so
without it a chaser would walk through walls and the kiting Mosca Tirador would reverse
straight out of the level.

Room size is dictated by enemy AI ranges rather than taste. `MoscaTirador` holds
a 180–250 px standoff and `SpiralEnemy` closes to 140 px, so a room has to
comfortably exceed twice the standoff. Rooms are 640–1024 px for that reason;
at the original 128–256 px those enemies were pushed through the walls the
moment the player walked in.

### Enemy statistics and floor composition

Each enemy keeps the movement multiplier, health, damage, cadence, and
projectile speeds authored in its own configuration on every floor. Enemy
movement uses the player's universal reference: `1.00` equals `2.5` world
pixels per simulation frame (150 px/s); an enemy multiplier of `0.70` therefore
moves at `1.75` px/frame. Floor number does not modify those statistics.

Room composition can still make later encounters denser. The map generator can
add one minion per room every four floors after floor 10, and it retains its
procedural encounter and miniboss rules. These changes affect how many enemies
appear, not the stats of an individual enemy. The first shot also starts after
a randomized fraction (0.6–1.2×) of the configured cooldown; later shots use
the exact fixed interval.

### Sound

Effects are generated rather than sampled. A bullet hell fires constantly, so
per-shot files would mean either a large download or audible repetition;
synthesis keeps the project dependency-free and lets pitch jitter per shot,
which is most of what stops sustained fire becoming a machine-gun of identical
clicks. Two primitives — a pitch-swept tone and filtered noise — build every
effect, and a voice cap keeps a busy room from summing dozens of oscillators
into clipping mush.

Music loops only the musical body of each track, skipping any fade-out, with
loop points detected from an RMS profile and snapped to zero crossings. See
[audio/README.md](audio/README.md).

### The boss gate

`setBossRoom()` marks the room farthest from the start — never the start room
itself. No exit exists at generation: `map.exit` is `null` until
`onBossDefeated()` calls `openExit()`.

The exit is placed as far from the player as the room allows, from a set of
corner and centre candidates. That is not cosmetic: dropping it underfoot would
trigger the descent the instant the boss died, with no agency — and spawning a
player onto a live exit is exactly the bug that once locked the game into an
endless transition loop.

Because there is nothing to walk toward early on, the on-screen chevron points
at the boss room (red) until the exit exists, then at the exit (green). The
minimap does the same.

### Bullets and walls

Enemy bullets pop on room and corridor walls, which stops enemies shooting the
player through geometry neither of them can cross. Player bullets deliberately
do not — the asymmetry is in the player's favour.

### Level-ups

There is no level cap. The authored `xpTable` covers the early curve and the
requirement continues geometrically past it at `Player.XP_GROWTH`. The encounter
mix can grow on deeper floors, while each enemy retains its configured stats.



`Player.gainXP()` performs the level itself (subtracting the cost and raising
the threshold), so the number of *pending* level-ups is tracked separately in a
`pendingLevelUps` counter and drained one screen at a time. A single large orb
that grants two levels therefore shows two upgrade drafts, not one.

## Deployment

The repo is a static site — the root is publishable as-is. To serve it from
GitHub Pages: **Settings → Pages → Source: `main` / root**. A `.nojekyll` file
is included so Pages serves every file verbatim instead of running Jekyll.

Because a custom domain is set on the account's user site, project pages
inherit it: this repo publishes to `jorge-erdb.com/abyss-engine/`. The repo
name *is* the URL path, so renaming the repo moves the site.

Note that music needs to be served over HTTP. Opening `index.html` from disk
works, but `fetch` is blocked on `file://`, so playback falls back to a plain
audio element and loses its loop points.

## Project status

Fully playable. Verified end to end in a headless browser: single RAF chain at
~60 fps, movement, aiming, shooting, pause/resume and room transitions all
behave, with no console errors. Remaining known issues — and the full debugging
history of the ones already fixed — are tracked in [BUGS.md](BUGS.md).

## License

MIT — see [LICENSE](LICENSE).

