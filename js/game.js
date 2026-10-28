/**
 * Game class — main engine: state machine, entity management, rendering, collision.
 */

/**
 * Simulation timing.
 *
 * The engine steps at a fixed logical rate rather than once per rendered frame.
 * Every gameplay value in this project is expressed in frames — movement per
 * tick, fireRate, invincibleTimer, shootCooldown, particle life, the floor
 * difficulty ramp — so a fixed step preserves all of them exactly while making
 * real elapsed time, not the display's refresh rate, decide how fast the game
 * runs. Rendering still happens once per animation frame, so a 144 Hz display
 * renders a 60 Hz simulation smoothly.
 */
const FIXED_STEP_MS = 1000 / 60;

/**
 * Cap on simulation steps per rendered frame. Without it, a long stall (tab
 * restored, laptop woken, debugger resumed) hands the loop a huge elapsed time,
 * which costs more than a frame to simulate, which grows the next elapsed time
 * — the classic spiral of death. Past this cap the extra time is dropped: the
 * game skips ahead rather than locking up.
 */
const MAX_CATCHUP_STEPS = 5;

class Game {
    constructor(canvas, ui, audio) {
        this.canvas = canvas;
        this.ui = ui;
        // Optional: a null-object fallback keeps every call site free of guards
        // and lets the engine run headless in tests.
        this.audio = audio || AudioSystem.silent();
        this.ctx = canvas.getContext('2d');

        // Game state
        this.state = 'START'; // START, PLAYING, LEVEL_UP, PAUSED, TRANSITIONING, GAME_OVER
        this.lastTime = 0;
        this.frameCount = 0;

        // Unspent real time owed to the simulation, in ms.
        this.accumulator = 0;

        // Input
        this.input = {
            keys: {},
            mouseX: 0,
            mouseY: 0,
            mouseDown: false,
            mousePressed: false,
            mouseReleased: false,
            cancelAim: false,
            // Analogue touch state. moveX/moveY are a clamped vector; aimX/aimY
            // are a unit direction that only counts while aimActive.
            moveX: 0,
            moveY: 0,
            aimX: 0,
            aimY: -1,
            aimActive: false
        };

        // Camera
        this.camera = { x: 0, y: 0 };
        // Online spectators focus their camera on a living teammate.
        this.spectatorTarget = null;

        // Impact feedback: frames of screen shake and of red damage flash left.
        this.shake = 0;
        this.damageFlash = 0;

        // Entities
        this.player = null;
        this.enemies = [];
        this.bullets = [];         // player bullets
        this.enemyBullets = [];    // enemy bullets
        // Created only for an offline authoritative game. Online clients render
        // the server's projectile snapshots and do not allocate their own pool.
        this.enemyProjectilePool = null;
        this.xpOrbs = [];
        this.particles = [];
        this.summons = [];

        // Map
        this.map = null;

        // Stats tracking
        this.enemiesKilled = 0;
        this.roomsCleared = 0;

        // Current floor, 1-based. Drives the early-game difficulty ramp.
        this.floor = 1;

        // Room transition
        this.transitionAlpha = 0;
        this.transitioning = false;

        // Room tracking
        this.currentRoom = null;

        // XP orb collection
        this.selectedUpgrade = null;

        // Level-ups earned but not yet spent on an upgrade. Player.gainXP()
        // performs the level itself, so this queue is what drives the screen.
        this.pendingLevelUps = 0;

        // Loop control
        this.loopRunning = false;

        // Bind input handlers
        this.bindInput();

        // Upgrade definitions are shared with the authoritative server.
        this.upgrades = UPGRADE_DEFS;
    }

    /**
     * Pause or resume. Shared by the Space key and the on-screen touch button.
     *
     * loopRunning is deliberately left alone: loop() keeps calling
     * requestAnimationFrame while PAUSED, so the chain is still alive, and
     * clearing the flag would let startLoop() spawn a second one.
     */
    togglePause() {
        if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            this.ui.showPause();
        } else if (this.state === 'PAUSED') {
            this.state = 'PLAYING';
            this.ui.hidePause();
        }
    }

    /**
     * Visible world size, in world units.
     *
     * The backing store is PIXEL_SIZE times smaller than the window and the
     * camera is zoomed by CAMERA_ZOOM, so canvas dimensions are not world
     * dimensions — camera maths must use these.
     */
    get cameraZoom() { return this.player?.character === 'tirador' && this.player.sniperAiming ? 2.0 : CAMERA_ZOOM; }
    get viewWidth()  { return this.canvas.width * PIXEL_SIZE / this.cameraZoom; }
    get viewHeight() { return this.canvas.height * PIXEL_SIZE / this.cameraZoom; }

    updatePointerWorld() {
        if (this.pointerClientX === undefined) return;
        const rect = this.canvas.getBoundingClientRect();
        const scale = (this.canvas.width / rect.width) * PIXEL_SIZE / this.cameraZoom;
        this.input.mouseX = (this.pointerClientX - rect.left) * scale;
        this.input.mouseY = (this.pointerClientY - rect.top) * scale;
    }

    /** Kick the camera and flash the screen — called on player damage. */
    addImpact(shakeFrames, flashFrames) {
        this.shake = Math.max(this.shake, shakeFrames);
        this.damageFlash = Math.max(this.damageFlash, flashFrames);
    }

    /** Set up input event listeners. */
    bindInput() {
        window.addEventListener('keydown', (e) => {
            this.input.keys[e.code] = true;
            if (e.code === 'Space' && !this.coopMode) this.togglePause();
            if (e.code === 'KeyM') this.ui.setMuted(this.audio.toggleMute());
            if (e.code === 'F3' && this.map) { this.map.debugLayout = !this.map.debugLayout; e.preventDefault(); }
        });

        window.addEventListener('keyup', (e) => {
            this.input.keys[e.code] = false;
        });

        window.addEventListener('mousemove', (e) => {
            this.pointerClientX = e.clientX; this.pointerClientY = e.clientY;
            this.updatePointerWorld();
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { this.audio.unlock(); this.pointerClientX = e.clientX; this.pointerClientY = e.clientY; this.updatePointerWorld(); this.input.mouseDown = true; this.input.mousePressed = true; }
        });

        // Bound to the window, not the canvas: releasing the button after the
        // cursor has left the canvas otherwise never clears mouseDown, and the
        // player keeps firing.
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) { this.pointerClientX = e.clientX; this.pointerClientY = e.clientY; this.updatePointerWorld(); this.input.mouseDown = false; this.input.mouseReleased = true; }
        });

        // A key held while the window loses focus never receives its keyup, so
        // the player walks off on their own after alt-tab. Drop all input.
        window.addEventListener('blur', () => {
            this.input.keys = {};
            this.input.mouseDown = false;
            this.input.mousePressed = false; this.input.mouseReleased = false; this.input.cancelAim = true;
            this.player?.cancelSniperAim?.();
            this.input.moveX = 0;
            this.input.moveY = 0;
            this.input.aimActive = false;
        });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Canvas resizing lives in main.js, which owns the pixel-grid sizing.
    }

    /** Start a new game. */
    start(characterId = 'pistolero', testRoom = false) {
        this.prepareForNewRun();
        this.testRoom = testRoom;
        this.enemiesKilled = 0;
        this.roomsCleared = 0;
        this.floor = 1;

        // Create player at map center
        this.player = new Player(0, 0);
        this.player.setCharacter(characterId);
        if (this.testRoom) this.generateTestRoom();
        else this.generateMap();

        // Do not carry inputs pressed during the loading cover into frame one.
        this.input.keys = {};
        this.input.mouseDown = false;
        this.input.moveX = 0;
        this.input.moveY = 0;
        this.input.aimActive = false;

        // Show HUD
        this.ui.showHUD(true);
        this.ui.hideStart();
        this.ui.hideGameOver();
        this.ui.hideLevelUp();

        this.state = 'PLAYING';
        this.loopRunning = false;
        this.pendingLevelUps = 0;
    }

    /** Prepare and reuse enemy projectile storage before a new offline run. */
    prepareForNewRun() {
        if (!this.enemyProjectilePool) this.enemyProjectilePool = new EnemyProjectilePool();
        this.enemyProjectilePool.ensureCapacity(EnemyProjectilePool.INITIAL_CAPACITY);
        this.enemyProjectilePool.releaseAll(this.enemyBullets);
        this.enemyProjectilePool.resetRunStats();
        return this.enemyProjectilePool.getStats();
    }

    /** Developer diagnostics; the pool is owned by this solo simulation. */
    getEnemyProjectilePoolStats() {
        return this.enemyProjectilePool ? this.enemyProjectilePool.getStats() : null;
    }

    /** Cancel active enemy shots without discarding the pool's allocated capacity. */
    clearEnemyProjectiles() {
        if (this.enemyProjectilePool) this.enemyProjectilePool.releaseAll(this.enemyBullets);
        else this.enemyBullets.length = 0;
    }

    /**
     * Ease freshly spawned enemies to the current floor's difficulty.
     * Applied at the two places enemies enter the world so no spawn path
     * can bypass the ramp.
     */
    scaleToFloor(enemies) {
        const t = difficultyForFloor(this.floor);
        for (const enemy of enemies) enemy.applyDifficulty(t, this.floor);
        return enemies;
    }

    /** Generate a new map and populate it. */
    generateMap() {
        this.map = new DungeonMap(14000, 14000);
        this.map.generate(this.floor);

        // Place player at start
        this.player.x = this.map.playerStart.x;
        this.player.y = this.map.playerStart.y;

        // Spawn enemies for the starting room
        this.enemies = [];
        this.currentRoom = null; // Reset room tracking for new map
        const startRoom = this.map.rooms[0];
        const enemies = this.scaleToFloor(
            this.map.getEnemiesForRoom(startRoom, null, 280, this.floor));
        this.enemies.push(...enemies);

        // Clear other entities
        this.bullets = [];
        this.clearEnemyProjectiles();
        this.xpOrbs = [];
        this.particles = [];
        this.summons = [];
    }

    /** Build a deterministic isolated arena for enemy behavior checks. */
    generateTestRoom() {
        this.map = new DungeonMap(2400, 1800);
        this.map.roomCount = 1;
        this.map.rooms = [{ tx: 5, ty: 5, tw: 64, th: 48, type: 'empty', parent: null, cleared: true, spawned: true }];
        this.map.corridors = [];
        this.map.calculatePositions();
        this.map.totalRooms = 1;
        this.player.x = this.map.playerStart.x;
        this.player.y = this.map.playerStart.y + 420;
        this.currentRoom = this.map.rooms[0];
        const room = this.map.rooms[0], enemies = [];
        for (const wall of ['top', 'right', 'bottom', 'left']) {
            for (const t of [1 / 3, 2 / 3]) {
                const x = wall === 'left' ? room.x + 8 : wall === 'right' ? room.x + room.w - 8 : room.x + room.w * t;
                const y = wall === 'top' ? room.y + 8 : wall === 'bottom' ? room.y + room.h - 8 : room.y + room.h * t;
                const enemy = new CochinillaPerforamuros(x, y, room, wall);
                enemies.push(enemy);
            }
        }
        // One corner cochinilla per corner, on the exact 3x3 spawn block taken
        // from the art (block centre = 2.5 cells from the corner). Handy to
        // check all four mirrored poses and their laser origins at once.
        const ts = this.map.tileSize;
        const corners = [
            { corner: 'top-left', bx: 1, by: 1 },
            { corner: 'top-right', bx: room.tw - 4, by: 1 },
            { corner: 'bottom-left', bx: 1, by: room.th - 4 },
            { corner: 'bottom-right', bx: room.tw - 4, by: room.th - 4 }
        ];
        for (const spot of corners) {
            const x = room.x + (spot.bx + 1.5) * ts;
            const y = room.y + (spot.by + 1.5) * ts;
            enemies.push(new CochinillaEsquinero(x, y, room, spot.corner));
        }
        this.enemies = enemies;
        this.bullets = []; this.clearEnemyProjectiles(); this.xpOrbs = []; this.particles = []; this.summons = [];
    }
    /** Spawn enemies for a new room. */
    spawnRoomEnemies(room) {
        if (this.testRoom) return;
        // Keep spawns clear of the doorway the player just walked through.
        const enemies = this.scaleToFloor(
            this.map.getEnemiesForRoom(room, this.player, 280, this.floor));
        const roomIndex = this.map.rooms.indexOf(room);
        for (const enemy of enemies) enemy.roomIndex = roomIndex;
        this.enemies.push(...enemies);

        // Treasure room bonus
        const treasure = this.map.getTreasureForRoom(room);
        if (treasure) {
            this.player.heal(treasure.heal);
            this.awardXP(treasure.xp);
            this.ui.drawNotification(this.ctx, `Treasure Room! +${treasure.heal} HP, +${treasure.xp} XP`);
        }
    }

    /** Start the game loop. */
    startLoop() {
        this.lastTime = performance.now();
        this.accumulator = 0;
        if (this.loopRunning) return;
        this.loopRunning = true;
        this.loop(this.lastTime);
    }

    /** Main game loop. */
    loop(timestamp) {
        // Clamp to non-negative: a stale or differently-based timestamp would
        // otherwise drive the accumulator negative and stall the simulation
        // while rendering carried on, which looks like a total freeze.
        const elapsed = Math.max(0, timestamp - this.lastTime);
        this.lastTime = timestamp;
        this.frameCount++;

        if (this.state === 'PLAYING') {
            this.accumulator += elapsed;

            // Drain the owed time in fixed steps. update() can change state
            // mid-drain (level up, death, room transition), and continuing to
            // simulate 'PLAYING' after that would run frames the new state is
            // supposed to have paused — so stop as soon as it does.
            let steps = 0;
            while (this.accumulator >= FIXED_STEP_MS &&
                   this.state === 'PLAYING' &&
                   steps < MAX_CATCHUP_STEPS) {
                this.accumulator -= FIXED_STEP_MS;
                steps++;
                this.update();
            }

            // Discard anything left over the cap instead of banking it.
            if (this.accumulator > FIXED_STEP_MS * MAX_CATCHUP_STEPS) {
                this.accumulator = 0;
            }

            this.render();
        } else if (this.state === 'TRANSITIONING') {
            this.accumulator = 0; // don't bank time while not simulating
            this.render();        // Keep rendering, just don't update
        } else if (this.state === 'PAUSED') {
            this.accumulator = 0; // otherwise unpausing fast-forwards the pause
            this.render();        // Keep rendering, just don't update
        } else if (this.state === 'LEVEL_UP') {
            this.accumulator = 0;
            this.render(); // Keep last frame visible while player chooses upgrade
        } else if (this.state === 'GAME_OVER') {
            this.render(); // Keep last frame visible
            return; // Stop the loop
        }

        requestAnimationFrame((t) => this.loop(t));
    }

    /** Advance the simulation by exactly one fixed step. */
    update() {
        // Update camera to follow player (must be before player.update for correct aim)
        this.camera.x = this.player.x - this.viewWidth / 2;
        this.camera.y = this.player.y - this.viewHeight / 2;

        // Clamp camera to map bounds
        this.camera.x = Math.max(0, Math.min(this.camera.x, this.map.width - this.viewWidth));
        this.camera.y = Math.max(0, Math.min(this.camera.y, this.map.height - this.viewHeight));

        // Update player (includes its own bounds clamping).
        const wasAiming = this.player.sniperAiming;
        const shouldShoot = this.player.update(this.input, this.camera, this.map);
        this.input.mousePressed = false; this.input.mouseReleased = false; this.input.cancelAim = false;
        if (wasAiming !== this.player.sniperAiming) {
            this.updatePointerWorld();
            this.camera.x = Math.max(0, Math.min(this.player.x - this.viewWidth / 2, this.map.width - this.viewWidth));
            this.camera.y = Math.max(0, Math.min(this.player.y - this.viewHeight / 2, this.map.height - this.viewHeight));
            if (!wasAiming && this.player.sniperAiming && this.pointerClientX !== undefined) {
                const ax = this.camera.x + this.input.mouseX - this.player.x;
                const ay = this.camera.y + this.input.mouseY - this.player.y;
                const length = Math.hypot(ax, ay) || 1; this.player.aimX = ax / length; this.player.aimY = ay / length;
            }
        }

        // Role attack: invocations are world units; other roles fire projectiles.
        if (shouldShoot) {
            if (this.player.weaponKind === 'summoner') {
                const x = this.player.x + this.player.aimX * (this.player.radius + 15);
                const y = this.player.y + this.player.aimY * (this.player.radius + 15);
                const ownerSummons = this.summons.filter(summon => summon.ownerId === 'local' && summon.alive);
                const summonLimit = this.player.summon?.maxActive ?? 6;
                if (ownerSummons.length >= summonLimit) {
                    const oldestIndex = this.summons.indexOf(ownerSummons[0]);
                    if (oldestIndex >= 0) this.summons.splice(oldestIndex, 1);
                }
                this.summons.push(new SummonedUnit(`local-${this.frameCount}-${Math.random()}`, 'local', x, y, this.player.summon));
                this.audio.summonAttack();
            } else {
                this.bullets.push(...this.player.shoot());
                if (this.player.character === 'tirador') this.audio.sniperShot();
                else if (this.player.character === 'piromano') this.audio.flameShot();
                else this.audio.shoot();
            }
        }

        this.updateSummons();
        let burnSound = false;
        const targets = [this.player, ...this.summons].filter(target => target.health > 0 && target.alive !== false);
        for (const enemy of this.enemies) {
            if (!enemy.alive) continue;
            if (enemy.updateBurn()) {
                burnSound = true;
                if (!enemy.alive) { this.enemyKilled(enemy); continue; }
            }
            let target = this.player, nearest = Infinity;
            for (const candidate of targets) {
                const distance = Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y);
                if (distance < nearest) { target = candidate; nearest = distance; }
            }
            const updateResult = enemy.update ? enemy.update(target, this.enemies, this.map, targets, this.enemyProjectilePool) : null;
            const event = typeof updateResult === 'string' ? updateResult : null;
            const bullets = Array.isArray(updateResult) ? updateResult : null;
            if (enemy instanceof CochinillaPerforamuros) {
                if (event === 'warning') this.audio.cochinillaCharge();
            }
            if (enemy instanceof CochinillaEsquinero) {
                if (event === 'warning') this.audio.cochinillaCharge();
            }
            if (enemy instanceof CochinillaPerforamuros && enemy.touchesBeam && enemy.touchesBeam(this.player) && this.player.invincibleTimer <= 0) {
                const dmg = enemy.laserDamagePerTick || 6;
                this.player.health = Math.max(0, this.player.health - dmg);
                this.damageFlash = Math.max(this.damageFlash, 2);
            }
            if (enemy instanceof CochinillaEsquinero && enemy.touchesBeam && enemy.touchesBeam(this.player) && this.player.invincibleTimer <= 0) {
                // Universal rule: a laser tick is 6 HP, once per simulation tick.
                const dmg = enemy.laserDamageFor ? enemy.laserDamageFor(this.player) : 0;
                if (dmg > 0) {
                    this.player.health = Math.max(0, this.player.health - dmg);
                    this.damageFlash = Math.max(this.damageFlash, 2);
                }
            }
            if (bullets && bullets.length) {
                this.enemyBullets.push(...bullets);
                this.audio.enemyShoot();
            }
        }
        this.audio.setCochinillaBeam(this.enemies.some(enemy =>
            enemy.alive && ((enemy instanceof CochinillaPerforamuros && enemy.phase === 'beam') || (enemy instanceof CochinillaEsquinero && enemy.phase === 'active'))));
        if (burnSound) this.audio.burnTick();
        // Update player bullets
        this.updatePlayerBullets();

        // Update enemy bullets
        this.updateEnemyBullets();

        // Update XP orbs (may trigger level up → changes state)
        this.updateXPOrbs();
        if (this.state !== 'PLAYING') return; // Level up or game over triggered

        // Decay impact feedback
        if (this.shake > 0) this.shake--;
        if (this.damageFlash > 0) this.damageFlash--;

        // Update particles
        this.updateParticles();

        // Clean up dead enemies from the array
        this.enemies = this.enemies.filter(e => e.alive);

        // Check room transitions
        this.checkRoomTransition();

        // Check death
        if (this.player.health <= 0) {
            this.gameOver();
            return;
        }

        // Update HUD
        this.ui.updateHUD(this.player, this.floor);
    }

    /** Update summons: each unit retargets, seeks, attacks and can be killed. */
    updateSummons() {
        for (const summon of this.summons) {
            const hit = summon.update(this.enemies, this.map);
            if (hit) {
                this.audio.summonAttack();
                this.spawnParticles(hit.x, hit.y, summon.color, 2);
                if (!hit.alive) this.enemyKilled(hit);
            }
        }
        this.summons = this.summons.filter(summon => summon.alive && summon.lifetime > 0);
    }

    /** Update player bullets (movement + collision). */
    updatePlayerBullets() {
        const toRemove = new Set();

        for (const bullet of this.bullets) {
            bullet.x += bullet.vx;
            bullet.y += bullet.vy;
            bullet.travelled = (bullet.travelled || 0) + Math.hypot(bullet.vx, bullet.vy);
            if (bullet.range && bullet.travelled >= bullet.range) toRemove.add(bullet);

            // Stop at the same authored mask the player and enemies walk on:
            // red walls (0) and blue obstacles (3) are solid for shots too.
            if (bulletBlockedByMap(this.map, bullet)) {
                this.spawnParticles(bullet.x, bullet.y, bullet.color, 3);
                toRemove.add(bullet);
                continue;
            }

            // Check collision with enemies
            for (const enemy of this.enemies) {
                if (!enemy.alive || toRemove.has(bullet)) continue;
                if (circleCollision(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius)) {
                    enemy.takeDamage(bullet.damage);
                    if (bullet.burn) enemy.applyBurn(bullet.burn);
                    bullet.hits++;

                    // Spawn hit particles
                    this.spawnParticles(bullet.x, bullet.y, enemy.color, 3);
                    this.audio.enemyHit();

                    if (bullet.hits > bullet.pierce) {
                        toRemove.add(bullet);
                    }

                    if (!enemy.alive) {
                        this.enemyKilled(enemy);
                    }
                    break;
                }
            }
        }

        // Remove dead bullets and out-of-bounds
        this.bullets = this.bullets.filter(b => !toRemove.has(b));
        this.bullets = removeDead(this.bullets, 50, this.map.width, this.map.height);
    }

    /** Update enemy bullets (movement + collision with player). */
    updateEnemyBullets() {
        for (const bullet of this.enemyBullets) {
            bullet.x += bullet.vx;
            bullet.y += bullet.vy;
            if (bullet.ignoreFrames > 0) bullet.ignoreFrames--;

            // Pop against room and corridor walls, so enemies can't shoot the
            // player through geometry they can't themselves cross. Checked
            // before the player test: a bullet that just entered a wall should
            // burst rather than land a hit.
            if (!this.map.isWalkable(bullet.x, bullet.y)) {
                this.spawnParticles(bullet.x, bullet.y, bullet.color, 3);
                this.enemyProjectilePool.release(bullet);
                continue;
            }

            const summonedHit = this.summons.find(summon => summon.alive && circleCollision(bullet.x, bullet.y, bullet.radius, summon.x, summon.y, summon.radius));
            if (summonedHit) {
                summonedHit.takeDamage(bullet.damage);
                this.spawnParticles(summonedHit.x, summonedHit.y, summonedHit.color, 3);
                this.enemyProjectilePool.release(bullet);
                continue;
            }

            // Bastion absorbs part of the impact; some shots ricochet toward
            // another party member and remain hostile enemy fire.
            const ricochetChance = this.player.enemyProjectileRicochetChance ?? 0;
            const damageMultiplier = this.player.incomingDamageMultiplier ?? 1;
            const isProtectedFromThisBullet = bullet.ignorePlayerId === (this.player.id ?? 'local') && bullet.ignoreFrames > 0;
            if (!isProtectedFromThisBullet && bulletHitsPlayer(bullet, this.player)) {
                const before = this.player.health;
                this.player.takeDamage(bullet.damage * damageMultiplier);
                if (this.player.health < before) {
                    this.addImpact(8, 6);
                    this.audio.playerHurt();
                }
                this.spawnParticles(this.player.x, this.player.y, PALETTE.danger, 5);
                if (ricochetChance > 0 && Math.random() < ricochetChance) {
                    ricochetEnemyBulletTowardParty(bullet, this.player, [this.player]);
                    continue;
                }
                this.enemyProjectilePool.release(bullet);
            }
        }

        // Remove expired/offscreen bullets in place so the live list itself is
        // reused along with the projectile objects.
        this.enemyProjectilePool.compact(this.enemyBullets, bullet =>
            bullet.damage > 0 && bullet.x > -50 && bullet.x < this.map.width + 50 &&
            bullet.y > -50 && bullet.y < this.map.height + 50);
    }

    /** Update XP orbs (drift + magnet pull to player). */
    updateXPOrbs() {
        for (const orb of this.xpOrbs) {
            // Gentle drift
            orb.x += orb.vx;
            orb.y += orb.vy;
            orb.vx *= 0.98;
            orb.vy *= 0.98;

            // Magnet pull toward player
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < this.player.magnetRange) {
                const speed = 4 * (1 - dist / this.player.magnetRange);
                orb.x += (dx / dist) * speed;
                orb.y += (dy / dist) * speed;
            }

            // Collection
            if (dist < this.player.radius + orb.radius) {
                this.pendingLevelUps += this.player.gainXP(orb.value);
                this.spawnParticles(orb.x, orb.y, PALETTE.xp, 2);
                this.audio.pickup();
                orb.collected = true;
            }
        }

        // Remove collected orbs
        this.xpOrbs = this.xpOrbs.filter(o => !o.collected);

        // Handle level-ups (may be multiple from a single orb)
        // Show one upgrade screen per queued level. Don't re-derive this from
        // player.xp: gainXP() has already subtracted the cost and raised the
        // threshold, so `xp >= xpToNext()` is false and the screen never opens.
        // applyUpgrade() returns to PLAYING and the next frame drains one more.
        if (this.pendingLevelUps > 0) {
            this.pendingLevelUps--;
            this.handleLevelUp();
        }
    }

    /** Update particles. */
    updateParticles() {
        for (const p of this.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            p.radius *= 0.95;
        }

        this.particles = this.particles.filter(p => p.life > 0);
    }

    /** Handle enemy death. */
    enemyKilled(enemy) {
        this.enemiesKilled++;

        if (enemy.type === 'boss') this.onBossDefeated();

        // Spawn death particles
        this.spawnParticles(enemy.x, enemy.y, enemy.color, 8);
        this.addImpact(enemy.type === 'boss' ? 7 : 2, 0);
        this.audio.enemyDeath();

        // Enemy XP drops are disabled by Enemy.ENEMY_XP_REWARDS_ENABLED.
        if (Enemy.ENEMY_XP_REWARDS_ENABLED && enemy.xpValue > 0) {
            const orbCount = Math.max(1, Math.ceil(enemy.xpValue / 5));
            for (let i = 0; i < orbCount; i++) {
                this.xpOrbs.push({
                    x: enemy.x + (Math.random() - 0.5) * 20,
                    y: enemy.y + (Math.random() - 0.5) * 20,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    value: Math.ceil(enemy.xpValue / orbCount),
                    radius: 4,
                    color: PALETTE.xp,
                    collected: false
                });
            }
        }
    }

    /**
     * The boss is down — release its doors and open the way out.
     *
     * The boss hall seals like any combat room, so its doors are cleared here
     * instead of waiting for the generic room-clear sweep (which would also
     * wait for the minions). The exit opens in the boss hall, away from the
     * player: dropping it underfoot would trigger the descent instantly, with
     * no agency.
     */
    onBossDefeated() {
        const room = this.map.bossRoom ||
                     this.map.getCurrentRoom(this.player.x, this.player.y);
        if (!room) return;
        const newlyCleared = !room.cleared;
        this.map.clearRoom(room);
        if (newlyCleared) this.roomsCleared++;
        this.map.openExit(room, this.player);
        this.addImpact(10, 0);
        this.ui.drawNotification(this.ctx, 'THE WAY OUT IS OPEN', 180);
    }

    /** Spawn particles at a position. */
    spawnParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 20 + Math.random() * 15,
                maxLife: 35,
                color: color,
                radius: 2 + Math.random() * 3
            });
        }
    }

    /** Check for room transitions (exit, clearing rooms, room entry). */
    checkRoomTransition() {
        const newRoom = this.map.getCurrentRoom(this.player.x, this.player.y);

        // Detect room entry — spawn enemies for new rooms
        if (newRoom && newRoom !== this.currentRoom) {
            // Only spawn the first time the player enters this room.
            // Use `spawned`, not `cleared`: every room starts out empty, so
            // `cleared` is already true before the player has ever been there.
            if (!newRoom.spawned && newRoom.type !== 'entry' && newRoom.type !== 'start') {
                if (['combat', 'combat-simple', 'combat-hard', 'boss'].includes(newRoom.type) && !newRoom.cleared) {
                    // Arm the encounter. updateRoomLocks() closes the doors
                    // once the player is clear of the threshold and only then
                    // spawns the enemies, so nobody fights through a doorway.
                    // The boss hall seals exactly like a combat room; its
                    // doors reopen when the boss dies (onBossDefeated).
                    newRoom.lockPending = true;
                } else {
                    this.spawnRoomEnemies(newRoom);
                    newRoom.spawned = true;
                }
            }
            this.currentRoom = newRoom;
        }

        // Check if player is at exit
        if (this.map.exit) {
            const exit = this.map.exit;
            const dx = this.player.x - exit.x;
            const dy = this.player.y - exit.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 50) {
                // The exit only exists once the boss is dead, so reaching it is
                // proof enough — no room-type check needed (and the room it
                // opens in is whatever room the player was standing in).
                {
                    // Guard: skip new transitions while one is already in progress
                    if (this.transitioning) return;

                    this.transitioning = true;
                    this.transitionAlpha = 0;
                    this.state = 'TRANSITIONING';

                    // Animate fade
                    const fadeInterval = setInterval(() => {
                        this.transitionAlpha += 0.05;
                        if (this.transitionAlpha >= 1) {
                            clearInterval(fadeInterval);
                            this.floor++;
                            this.audio.descend();
                            this.audio.nextTrack();
                            this.generateMap();
                            this.ui.drawNotification(this.ctx, `FLOOR ${this.floor}`);
                            this.transitionAlpha = 1;

                            const fadeBack = setInterval(() => {
                                this.transitionAlpha -= 0.05;
                                if (this.transitionAlpha <= 0) {
                                    this.transitioning = false;
                                    this.transitionAlpha = 0;
                                    this.state = 'PLAYING';
                                    clearInterval(fadeBack);
                                    // Restart the game loop so player can continue playing
                                    this.startLoop();
                                }
                            }, 16);
                        }
                    }, 16);
                }
            }
        }
        // Track cleared rooms
        for (const room of this.map.rooms) {
            // A room the player has never entered isn't "cleared" — it's unvisited.
            if (room.spawned && !room.cleared && this.isRoomCleared(room)) {
                this.map.clearRoom(room);
                this.roomsCleared++;
            }
        }
        this.updateRoomLocks();
    }

    /** Close combat-room doors once the player is safely inside. */
    updateRoomLocks() {
        const blockers = this.enemies.filter(enemy => enemy.alive);
        for (const room of this.map.rooms) {
            if (!room.lockPending || room.locked || room.cleared) continue;
            if (!this.map.canLockRoom(room, [this.player], blockers)) continue;
            this.map.lockRoom(room);
            // The room is sealed first; the encounter starts behind closed
            // doors. `spawned` also keeps the empty room from being counted
            // as cleared during the frames before the lock lands.
            if (!room.spawned) {
                this.spawnRoomEnemies(room);
                room.spawned = true;
            }
        }
    }

    /** Check if all enemies in a room are dead. */
    isRoomCleared(room) {
        const roomIndex = this.map.rooms.indexOf(room);
        for (const enemy of this.enemies) {
            if (!enemy.alive) continue;
            if (enemy.roomIndex !== undefined) {
                if (enemy.roomIndex === roomIndex) return false;
                continue;
            }
            if (enemy.x >= room.x && enemy.x < room.x + room.w &&
                enemy.y >= room.y && enemy.y < room.y + room.h) {
                return false;
            }
        }
        return true;
    }

    /** Add XP and queue every level crossed, not only the first. */
    awardXP(amount) {
        if (!(amount > 0)) return 0;
        const levels = this.player.gainXP(amount);
        this.pendingLevelUps += levels;
        return levels;
    }

    /** Handle level up — show upgrade selection. */
    handleLevelUp() {
        this.state = 'LEVEL_UP';
        this.audio.levelUp();

        // Pick 3 random upgrades
        const shuffled = [...this.upgrades].sort(() => Math.random() - 0.5);
        const choices = shuffled.slice(0, 3);

        this.selectedUpgrade = null;

        this.ui.showLevelUp(choices, (upgrade) => {
            this.selectedUpgrade = upgrade;
        });
    }

    /** Apply the selected upgrade. */
    applyUpgrade() {
        if (!this.selectedUpgrade) {
            // Show a brief notification that no upgrade was selected
            this.ui.drawNotification(this.ctx, 'No upgrade selected!');
            return;
        }

        if (this.coopMode) {
            // The server owns the player's stats in co-op. Send the chosen id
            // and let the authoritative run apply it; the next snapshot shows
            // the new numbers and clears the next queued level.
            window.coopGame?.noteUpgradeSent();
            window.coopClient?.send({ type: 'upgrade', upgradeId: this.selectedUpgrade.id });
            this.selectedUpgrade = null;
            this.ui.hideLevelUp();
            this.state = 'PLAYING';
            return;
        }

        this.selectedUpgrade.apply(this.player);
        this.ui.hideLevelUp();
        // Same as unpause: the LEVEL_UP branch of loop() never stopped the RAF
        // chain, so loopRunning must stay true.
        this.state = 'PLAYING';
    }

    /** Handle game over. */
    gameOver() {
        this.player?.cancelSniperAim?.();
        this.state = 'GAME_OVER';
        this.audio.gameOver();
        this.ui.hideLevelUp();
        this.ui.showHUD(false);
        this.ui.showGameOver(this.player.level, this.roomsCleared, this.enemiesKilled, this.floor);
        this.loopRunning = false;
    }

    drawSniperAim(ctx) {
        const aimingPlayers = [this.player, ...(this.remotePlayers || [])]
            .filter(p => p?.health > 0 && p.character === 'tirador' && p.sniperAiming);
        for (const player of aimingPlayers) {
            const maxRange = Math.min(player.range || 960, 960);
            let endX = player.x + player.aimX * maxRange;
            let endY = player.y + player.aimY * maxRange;
            if (this.map?.isWalkable) {
                let lastX = player.x, lastY = player.y;
                for (let distance = 4; distance <= maxRange; distance += 4) {
                    const x = player.x + player.aimX * distance;
                    const y = player.y + player.aimY * distance;
                    if (!this.map.isWalkable(x, y)) break;
                    lastX = x; lastY = y;
                }
                endX = lastX; endY = lastY;
            }
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#221e94';
            ctx.lineWidth = 4 / this.cameraZoom;
            ctx.lineCap = 'butt';
            ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(endX, endY); ctx.stroke();
            ctx.restore();
        }
    }

    /** Render the game. */
    render() {
        const ctx = this.ctx;
        const CW = this.canvas.width;   // canvas (game-pixel) space
        const CH = this.canvas.height;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;

        // Clear to the void colour
        ctx.fillStyle = PALETTE.void;
        ctx.fillRect(0, 0, CW, CH);

        // Screen shake, in world units, quantised to the grid so the whole
        // image jumps by whole pixels rather than smearing.
        let sx = 0, sy = 0;
        if (this.shake > 0) {
            const mag = this.shake;
            sx = Math.round((Math.random() - 0.5) * mag * 2);
            sy = Math.round((Math.random() - 0.5) * mag * 2);
        }

        // Enter world space: 1 unit = 1 world pixel, drawn onto the small
        // backing store at the camera zoom, so everything is multiplied by
        // CAMERA_ZOOM / PIXEL_SIZE. The integer factor keeps the art crisp.
        ctx.save();
        ctx.scale(this.cameraZoom / PIXEL_SIZE, this.cameraZoom / PIXEL_SIZE);
        ctx.translate(-Math.round(this.camera.x) + sx, -Math.round(this.camera.y) + sy);

        if (this.map) this.map.draw(ctx, this.camera, this.viewWidth, this.viewHeight);
        this.drawSniperAim(ctx);

        // XP orbs — squares with a dim halo
        for (const orb of this.xpOrbs) {
            pixelRect(ctx, orb.x, orb.y, orb.radius * 3, orb.radius * 3, PALETTE.xpGlow);
            pixelRect(ctx, orb.x, orb.y, orb.radius * 1.6, orb.radius * 1.6, PALETTE.xp);
        }

        // Particles — chunky embers that shrink as they die
        for (const p of this.particles) {
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
            pixelRect(ctx, p.x, p.y, p.radius * 2, p.radius * 2, p.color);
        }
        ctx.globalAlpha = 1;

        for (const enemy of this.enemies) {
            if (enemy.alive) enemy.draw(ctx);
        }

        // Summons show their own health and remain independent from the Invocador.
        for (const summon of this.summons || []) {
            if (!summon.alive) continue;
            pixelRect(ctx, summon.x, summon.y, 28, 28, '#39164d');
            pixelRect(ctx, summon.x, summon.y, summon.radius * 1.8, summon.radius * 1.8, summon.color);
            pixelRect(ctx, summon.x, summon.y, 6, 6, '#f0d8ff');
            ctx.fillStyle = '#1a0d20';
            ctx.fillRect(snap(summon.x - 12), snap(summon.y - summon.radius - 8), 24, 3);
            ctx.fillStyle = summon.color || '#ae64e8';
            ctx.fillRect(snap(summon.x - 12), snap(summon.y - summon.radius - 8), 24 * Math.max(0, summon.health / summon.maxHealth), 3);
        }

        // Player bullets
        for (const b of this.bullets) {
            pixelRect(ctx, b.x, b.y, b.radius * 2.4, b.radius * 2.4, b.color || PALETTE.playerShot);
            pixelRect(ctx, b.x, b.y, b.radius, b.radius, PALETTE.bone);
        }

        // Enemy bullets — hotter, with a bright core so they read against floor
        for (const b of this.enemyBullets) {
            pixelRect(ctx, b.x, b.y, b.radius * 2.4, b.radius * 2.4, PALETTE.blood);
            pixelRect(ctx, b.x, b.y, b.radius * 1.5, b.radius * 1.5, PALETTE.enemyShot);
            pixelRect(ctx, b.x, b.y, b.radius * 0.7, b.radius * 0.7, PALETTE.hud);
        }

        if (this.player && this.player.health > 0) this.player.draw(ctx);
        for (const player of this.remotePlayers || []) {
            if (player.health > 0) player.draw(ctx);
        }

        // During co-op spectating, contextual markers follow the camera target.
        const cameraFocus = this.spectatorTarget || this.player;
        // Objective chevron. Without an exit to head for, a player would be
        // hunting a boss room blind across a 7000px map, so the marker points
        // at the boss first and the exit only once it has opened.
        if (this.map && cameraFocus) {
            const target = this.map.exit ||
                (this.map.bossRoom ? { x: this.map.bossRoom.cx, y: this.map.bossRoom.cy } : null);
            if (target) {
                const dx = target.x - cameraFocus.x;
                const dy = target.y - cameraFocus.y;
                if (Math.hypot(dx, dy) > 140) {
                    const a = Math.atan2(dy, dx);
                    const px = cameraFocus.x + Math.cos(a) * 46;
                    const py = cameraFocus.y + Math.sin(a) * 46;
                    const col = this.map.exit ? PALETTE.exit : PALETTE.danger;
                    pixelRect(ctx, px, py, 9, 9, col);
                    pixelRect(ctx, px, py, 4, 4, PALETTE.void);
                }
            }
        }

        ctx.restore();

        // ---- screen-space passes, in canvas pixels ----

        this.drawVignette(ctx, CW, CH);

        // Damage flash: a red wash that fades over its remaining frames
        if (this.damageFlash > 0) {
            ctx.globalAlpha = Math.min(0.5, this.damageFlash / 12);
            ctx.fillStyle = PALETTE.danger;
            ctx.fillRect(0, 0, CW, CH);
            ctx.globalAlpha = 1;
        }

        // Low-health pulse
        if (this.player && this.player.health > 0 &&
            this.player.health / this.player.maxHealth < 0.3) {
            const pulse = 0.12 + 0.08 * Math.sin(this.frameCount * 0.15);
            ctx.globalAlpha = pulse;
            ctx.fillStyle = PALETTE.blood;
            ctx.fillRect(0, 0, CW, CH);
            ctx.globalAlpha = 1;
        }

        // Room transition fade
        if (this.transitioning) {
            ctx.globalAlpha = Math.max(0, Math.min(1, this.transitionAlpha));
            ctx.fillStyle = PALETTE.void;
            ctx.fillRect(0, 0, CW, CH);
            ctx.globalAlpha = 1;
        }

        this.ui.renderNotification(ctx);

        if (this.map && cameraFocus) {
            this.ui.enemies = this.enemies;
            this.ui.drawMinimap(this.map, this.camera, cameraFocus);
        }
    }

    /**
     * Darken the edges of the frame.
     *
     * Cached because building a gradient every frame is wasteful, and rebuilt
     * only when the canvas dimensions change.
     */
    drawVignette(ctx, w, h) {
        if (!this._vignette || this._vignetteW !== w || this._vignetteH !== h) {
            const g = ctx.createRadialGradient(
                w / 2, h / 2, Math.min(w, h) * 0.42,
                w / 2, h / 2, Math.max(w, h) * 0.72
            );
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,0.45)');
            this._vignette = g;
            this._vignetteW = w;
            this._vignetteH = h;
        }
        ctx.fillStyle = this._vignette;
        ctx.fillRect(0, 0, w, h);
    }
}
