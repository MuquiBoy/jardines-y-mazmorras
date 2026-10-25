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

        // Impact feedback: frames of screen shake and of red damage flash left.
        this.shake = 0;
        this.damageFlash = 0;

        // Entities
        this.player = null;
        this.enemies = [];
        this.bullets = [];         // player bullets
        this.enemyBullets = [];    // enemy bullets
        this.xpOrbs = [];
        this.particles = [];

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

        // Upgrade definitions
        this.upgrades = [
            { name: 'Vitality', description: '+20 Max Health, heal to full', apply: (p) => { p.maxHealth += 20; p.health = p.maxHealth; } },
            { name: 'Power', description: '+5 Damage', apply: (p) => { p.damage += 5; } },
            { name: 'Swiftness', description: '+0.5 Speed', apply: (p) => { p.speed += 0.5; } },
            { name: 'Multi-Shot', description: '+1 Bullet Count (max 7)', apply: (p) => { if (p.bulletCount < 7) p.bulletCount++; } },
            { name: 'Pierce', description: '+1 Bullet Pierce', apply: (p) => { p.bulletPierce++; } },
            { name: 'Rapid Fire', description: '+10% Fire Rate', apply: (p) => { p.fireRate = Math.max(4, Math.floor(p.fireRate * 0.9)); } },
            { name: 'Bullet Speed', description: '+1 Bullet Speed', apply: (p) => { p.bulletSpeed += 1; } },
            { name: 'Magnet', description: '+15 Magnet Range', apply: (p) => { p.magnetRange += 15; } },
            { name: 'Full Heal', description: 'Restore all health', apply: (p) => { p.health = p.maxHealth; } },
            { name: 'Power Surge', description: '+30% Damage (Rare)', apply: (p) => { p.damage = Math.floor(p.damage * 1.3); }, rarity: 'rare' }
        ];
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
     * The backing store is PIXEL_SIZE times smaller than the window, so canvas
     * dimensions are not world dimensions — camera maths must use these.
     */
    get viewWidth()  { return this.canvas.width * PIXEL_SIZE; }
    get viewHeight() { return this.canvas.height * PIXEL_SIZE; }

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
        });

        window.addEventListener('keyup', (e) => {
            this.input.keys[e.code] = false;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.input.mouseX = e.clientX - rect.left;
            this.input.mouseY = e.clientY - rect.top;
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) this.input.mouseDown = true;
        });

        // Bound to the window, not the canvas: releasing the button after the
        // cursor has left the canvas otherwise never clears mouseDown, and the
        // player keeps firing.
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.input.mouseDown = false;
        });

        // A key held while the window loses focus never receives its keyup, so
        // the player walks off on their own after alt-tab. Drop all input.
        window.addEventListener('blur', () => {
            this.input.keys = {};
            this.input.mouseDown = false;
            this.input.moveX = 0;
            this.input.moveY = 0;
            this.input.aimActive = false;
        });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Canvas resizing lives in main.js, which owns the pixel-grid sizing.
    }

    /** Start a new game. */
    start() {
        this.enemiesKilled = 0;
        this.roomsCleared = 0;
        this.floor = 1;

        // Create player at map center
        this.player = new Player(0, 0);
        this.generateMap();

        // Reset input
        this.input.mouseDown = false;

        // Show HUD
        this.ui.showHUD(true);
        this.ui.hideStart();
        this.ui.hideGameOver();
        this.ui.hideLevelUp();

        this.state = 'PLAYING';
        this.loopRunning = false;
        this.pendingLevelUps = 0;
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
        this.map = new DungeonMap(7000, 7000);
        this.map.generate();

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
        this.enemyBullets = [];
        this.xpOrbs = [];
        this.particles = [];
    }

    /** Spawn enemies for a new room. */
    spawnRoomEnemies(room) {
        // Keep spawns clear of the doorway the player just walked through.
        const enemies = this.scaleToFloor(
            this.map.getEnemiesForRoom(room, this.player, 280, this.floor));
        this.enemies.push(...enemies);

        // Treasure room bonus
        const treasure = this.map.getTreasureForRoom(room);
        if (treasure) {
            this.player.heal(treasure.heal);
            if (this.player.gainXP(treasure.xp)) this.pendingLevelUps++;
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

        // Update player (includes its own bounds clamping)
        const shouldShoot = this.player.update(this.input, this.camera, this.map);

        // Player shooting
        if (shouldShoot) {
            const newBullets = this.player.shoot();
            this.bullets.push(...newBullets);
            this.audio.shoot();
        }

        // Update enemies
        const newEnemyBullets = [];
        for (const enemy of this.enemies) {
            if (!enemy.alive) continue;
            const bullets = enemy.update(this.player, this.enemies, this.map);
            if (bullets && bullets.length) {
                newEnemyBullets.push(...bullets);
                this.audio.enemyShoot();
            }
        }
        this.enemyBullets.push(...newEnemyBullets);

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

    /** Update player bullets (movement + collision). */
    updatePlayerBullets() {
        const toRemove = new Set();

        for (const bullet of this.bullets) {
            bullet.x += bullet.vx;
            bullet.y += bullet.vy;

            // Check collision with enemies
            for (const enemy of this.enemies) {
                if (!enemy.alive || toRemove.has(bullet)) continue;
                if (circleCollision(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius)) {
                    enemy.takeDamage(bullet.damage);
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

            // Pop against room and corridor walls, so enemies can't shoot the
            // player through geometry they can't themselves cross. Checked
            // before the player test: a bullet that just entered a wall should
            // burst rather than land a hit.
            if (!this.map.isWalkable(bullet.x, bullet.y)) {
                this.spawnParticles(bullet.x, bullet.y, bullet.color, 3);
                bullet.damage = 0; // Mark as consumed
                continue;
            }

            // Check collision with player
            if (bulletHitsPlayer(bullet, this.player)) {
                const before = this.player.health;
                this.player.takeDamage(bullet.damage);
                // Only react to damage that actually landed — takeDamage() is a
                // no-op during invincibility frames.
                if (this.player.health < before) {
                    this.addImpact(8, 6);
                    this.audio.playerHurt();
                }
                this.spawnParticles(this.player.x, this.player.y, PALETTE.danger, 5);
                bullet.damage = 0; // Mark as consumed
            }
        }

        // Remove dead/offscreen bullets
        this.enemyBullets = this.enemyBullets.filter(b => b.damage > 0);
        this.enemyBullets = removeDead(this.enemyBullets, 50, this.map.width, this.map.height);
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
                if (this.player.gainXP(orb.value)) this.pendingLevelUps++;
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

        // Drop XP orbs
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

    /**
     * The boss is down — open the way out.
     *
     * The exit appears in the room the player is standing in, falling back to
     * the boss room if they landed the kill from a corridor. It is placed as
     * far from them as the room allows: dropping it underfoot would trigger
     * the descent instantly, with no agency.
     */
    onBossDefeated() {
        const room = this.map.getCurrentRoom(this.player.x, this.player.y) ||
                     this.map.bossRoom;
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
            if (!newRoom.spawned && newRoom.type !== 'start') {
                this.spawnRoomEnemies(newRoom);
            }
            newRoom.spawned = true;
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
    }

    /** Check if all enemies in a room are dead. */
    isRoomCleared(room) {
        for (const enemy of this.enemies) {
            if (!enemy.alive) continue;
            if (enemy.x >= room.x && enemy.x < room.x + room.w &&
                enemy.y >= room.y && enemy.y < room.y + room.h) {
                return false;
            }
        }
        return true;
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

        this.selectedUpgrade.apply(this.player);
        this.ui.hideLevelUp();
        // Same as unpause: the LEVEL_UP branch of loop() never stopped the RAF
        // chain, so loopRunning must stay true.
        this.state = 'PLAYING';
    }

    /** Handle game over. */
    gameOver() {
        this.state = 'GAME_OVER';
        this.audio.gameOver();
        this.ui.hideLevelUp();
        this.ui.showHUD(false);
        this.ui.showGameOver(this.player.level, this.roomsCleared, this.enemiesKilled, this.floor);
        this.loopRunning = false;
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
        // backing store, so everything is divided by PIXEL_SIZE.
        ctx.save();
        ctx.scale(1 / PIXEL_SIZE, 1 / PIXEL_SIZE);
        ctx.translate(-Math.round(this.camera.x) + sx, -Math.round(this.camera.y) + sy);

        if (this.map) this.map.draw(ctx, this.camera, this.viewWidth, this.viewHeight);

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

        // Player bullets
        for (const b of this.bullets) {
            pixelRect(ctx, b.x, b.y, b.radius * 2.4, b.radius * 2.4, PALETTE.playerShot);
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

        // Objective chevron. Without an exit to head for, a player would be
        // hunting a boss room blind across a 7000px map, so the marker points
        // at the boss first and the exit only once it has opened.
        if (this.map && this.player) {
            const target = this.map.exit ||
                (this.map.bossRoom ? { x: this.map.bossRoom.cx, y: this.map.bossRoom.cy } : null);
            if (target) {
                const dx = target.x - this.player.x;
                const dy = target.y - this.player.y;
                if (Math.hypot(dx, dy) > 140) {
                    const a = Math.atan2(dy, dx);
                    const px = this.player.x + Math.cos(a) * 46;
                    const py = this.player.y + Math.sin(a) * 46;
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

        if (this.map && this.player) {
            this.ui.enemies = this.enemies;
            this.ui.drawMinimap(this.map, this.camera, this.player);
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
