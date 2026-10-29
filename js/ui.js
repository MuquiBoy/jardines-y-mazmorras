/**
 * UI rendering — HUD, minimap, level-up screen, game over.
 */

/**
 * UI class — handles all on-screen UI rendering and DOM updates.
 */
class UI {
    constructor(canvas, minimapCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.minimapCanvas = minimapCanvas;
        this.minimapCtx = minimapCanvas.getContext('2d');

        // DOM elements
        this.hpHearts = document.getElementById('hp-hearts');
        this.hpText = document.getElementById('hp-text');
        this.xpBar = document.getElementById('xp-bar');
        this.xpText = document.getElementById('xp-text');
        this.statsDisplay = document.getElementById('stats-display');
        this.ammoText = document.getElementById('ammo-text');
        this.loadingScreen = document.getElementById('loading-screen');
        this.loadingMessage = document.getElementById('loading-message');
        this.loadingError = document.getElementById('loading-error');
        this.loadingRetry = document.getElementById('loading-retry');
    }

    /** Update HUD bars from player data. */
    updateHUD(player, floor = 1) {
        // One heart contains 12 HP; each visible half represents 6 HP.
        if (this.hpHearts) {
            const heartCount = Math.ceil(player.maxHealth / 12);
            const filledHalfHearts = Math.ceil(Math.max(0, player.health) / 6);
            const layout = `${heartCount}:${filledHalfHearts}`;
            if (layout !== this._heartLayout) {
                this._heartLayout = layout;
                this.hpHearts.innerHTML = Array.from({ length: heartCount }, (_, i) => {
                    const halves = Math.max(0, Math.min(2, filledHalfHearts - i * 2));
                    const state = halves === 2 ? 'full' : halves === 1 ? 'half' : 'empty';
                    const gradientId = `hp-heart-half-${i}`;
                    const fill = state === 'full' ? '#e74756' : state === 'half' ? `url(#${gradientId})` : '#35252a';
                    const gradient = state === 'half'
                        ? `<defs><linearGradient id="${gradientId}"><stop offset="50%" stop-color="#e74756"/><stop offset="50%" stop-color="#35252a"/></linearGradient></defs>`
                        : '';
                    return `<svg class="health-heart ${state}" viewBox="0 0 16 15" aria-hidden="true" shape-rendering="crispEdges">${gradient}<path d="M1 1h4v1h2v1h2V2h2V1h4v1h1v4h-1v2h-1v2h-2v2h-2v1H6v-1H4v-2H3V9H2V7H1V5H0V2h1z" fill="${fill}" stroke="#170e12" stroke-width="0.8"/></svg>`;
                }).join('');
                this.hpHearts.setAttribute('aria-label', `${filledHalfHearts} medios corazones de ${heartCount * 2}`);
            }
        }
        this.hpText.textContent = `${Math.ceil(player.health)} / ${player.maxHealth}`;

        // XP bar
        const xpNeeded = player.xpToNext();
        const xpPercent = xpNeeded > 0 ? (player.xp / xpNeeded) * 100 : 100;
        this.xpBar.style.width = `${xpPercent}%`;
        this.xpText.textContent = `Lv ${player.level} — ${player.xp} / ${xpNeeded}`;

        // Role ammo and reload state
        if (this.ammoText) this.ammoText.textContent = player.reloadTimer > 0
            ? `RECARGANDO ${Math.ceil(player.reloadTimer / 60)}s`
            : `CARGADOR ${player.ammo} / ${player.ammoCapacity}`;
        this.statsDisplay.textContent = `${player.getStatsString()} | PISO: ${floor}`;
    }

    /** Draw minimap. */
    drawMinimap(map, camera, player, width = 150, height = 150) {
        const ctx = this.minimapCtx;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = '#0a0709';
        ctx.fillRect(0, 0, width, height);

        const scale = Math.min(width / map.width, height / map.height);

        // Corridors under the rooms
        ctx.fillStyle = '#2a211d';
        for (const r of map.corridorRects || []) {
            ctx.fillRect(Math.floor(r.x * scale), Math.floor(r.y * scale),
                         Math.max(1, Math.floor(r.w * scale)),
                         Math.max(1, Math.floor(r.h * scale)));
        }

        for (const room of map.rooms) {
            ctx.fillStyle = room.type === 'treasure'
                ? (room.cleared ? '#8a6a1a' : '#ffb000')
                : (room.cleared ? '#3a2e28' : '#5c4638');
            ctx.fillRect(Math.floor(room.x * scale), Math.floor(room.y * scale),
                         Math.max(1, Math.floor(room.w * scale)),
                         Math.max(1, Math.floor(room.h * scale)));
        }

        // Boss room until it is cleared, then the exit that replaces it.
        if (map.bossRoom && !map.exit) {
            ctx.fillStyle = PALETTE.danger;
            ctx.fillRect(Math.floor(map.bossRoom.cx * scale) - 2,
                         Math.floor(map.bossRoom.cy * scale) - 2, 5, 5);
        }
        if (map.exit) {
            ctx.fillStyle = PALETTE.exit;
            ctx.fillRect(Math.floor(map.exit.x * scale) - 2, Math.floor(map.exit.y * scale) - 2, 5, 5);
        }

        // Enemies — previously a TODO, so the minimap never showed threats
        if (this.enemies) {
            ctx.fillStyle = PALETTE.danger;
            for (const e of this.enemies) {
                if (!e.alive) continue;
                ctx.fillRect(Math.floor(e.x * scale) - 1, Math.floor(e.y * scale) - 1, 2, 2);
            }
        }

        ctx.fillStyle = PALETTE.hud;
        ctx.fillRect(Math.floor(player.x * scale) - 2, Math.floor(player.y * scale) - 2, 4, 4);
    }

    /** Show level-up screen with upgrade cards. */
    showLevelUp(upgrades, onSelect) {
        const container = document.getElementById('upgrade-cards');
        container.innerHTML = '';

        for (const upgrade of upgrades) {
            const card = document.createElement('div');
            card.className = 'upgrade-card';
            card.innerHTML = `
                <div class="card-name">${upgrade.name}</div>
                <div class="card-desc">${upgrade.description}</div>
                <div class="card-rarity ${upgrade.rarity || ''}">${upgrade.rarity || 'common'}</div>
            `;
            card.addEventListener('click', () => {
                // Remove previous selection
                container.querySelectorAll('.upgrade-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                onSelect(upgrade);
            });
            container.appendChild(card);
        }

        // Show confirm button
        document.getElementById('confirm-upgrade').classList.remove('hidden');

        // Show screen
        document.getElementById('levelup-screen').classList.remove('hidden');
    }

    /** Hide level-up screen. */
    hideLevelUp() {
        document.getElementById('levelup-screen').classList.add('hidden');
        document.getElementById('confirm-upgrade').classList.add('hidden');
    }

    /** Show game over screen with stats. */
    showGameOver(level, rooms, enemies, floor = 1) {
        document.getElementById('go-floor').textContent = floor;
        document.getElementById('go-level').textContent = level;
        document.getElementById('go-rooms').textContent = rooms;
        document.getElementById('go-enemies').textContent = enemies;
        document.getElementById('gameover-screen').classList.remove('hidden');
    }

    /** Hide game over screen. */
    hideGameOver() {
        document.getElementById('gameover-screen').classList.add('hidden');
    }

    /** Show start screen. */
    showStart() {
        document.getElementById('start-screen').classList.remove('hidden');
    }

    /** Hide start screen. */
    hideStart() {
        document.getElementById('start-screen').classList.add('hidden');
    }

    /** Cover the game while startup resources are prepared. */
    showLoading(message = 'Preparando mazmorra…') {
        if (!this.loadingScreen) return;
        this.loadingScreen.classList.remove('hidden');
        this.loadingScreen.classList.remove('has-error');
        this.loadingScreen.setAttribute('aria-busy', 'true');
        if (this.loadingMessage) this.loadingMessage.textContent = message;
        if (this.loadingError) { this.loadingError.textContent = ''; this.loadingError.classList.add('hidden'); }
        if (this.loadingRetry) this.loadingRetry.classList.add('hidden');
    }

    /** End the startup cover once the run is ready. */
    hideLoading() {
        if (!this.loadingScreen) return;
        this.loadingScreen.classList.add('hidden');
        this.loadingScreen.classList.remove('has-error');
        this.loadingScreen.setAttribute('aria-busy', 'false');
    }

    /** Show a recoverable startup error instead of leaving a permanent spinner. */
    showLoadingError(message = 'No se pudo preparar la mazmorra.') {
        if (!this.loadingScreen) return;
        this.loadingScreen.classList.remove('hidden');
        this.loadingScreen.classList.add('has-error');
        this.loadingScreen.setAttribute('aria-busy', 'false');
        if (this.loadingMessage) this.loadingMessage.textContent = 'No se pudo iniciar la partida';
        if (this.loadingError) { this.loadingError.textContent = message; this.loadingError.classList.remove('hidden'); }
        if (this.loadingRetry) {
            this.loadingRetry.classList.remove('hidden');
            this.loadingRetry.focus();
        }
    }

    /** Show pause overlay. */
    showPause() {
        document.getElementById('pause-overlay').classList.remove('hidden');
    }

    /** Hide pause overlay. */
    hidePause() {
        document.getElementById('pause-overlay').classList.add('hidden');
    }

    /** Reflect mute state on the sound button. */
    setMuted(muted) {
        const btn = document.getElementById('mute-btn');
        if (!btn) return;
        btn.textContent = muted ? 'OFF' : 'SND';
        btn.classList.toggle('muted', muted);
    }

    /** Show/hide HUD. */
    showHUD(show) {
        const hud = document.getElementById('hud');
        if (show) {
            hud.classList.remove('hidden');
        } else {
            hud.classList.add('hidden');
        }
    }

    /** Draw a message on the game canvas. */
    drawMessage(ctx, text, x, y, color = '#fff', fontSize = 16) {
        ctx.fillStyle = color;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(text, x, y);
    }

    /** Draw a room notification (e.g., "Treasure Room!"). */
    drawNotification(ctx, text, duration = 120) {
        // Store for rendering in game loop
        this._notification = { text, duration, maxDuration: duration };
    }

    /** Render the current notification. */
    renderNotification(ctx) {
        if (!this._notification || this._notification.duration <= 0) {
            this._notification = null;
            return;
        }

        const { text, duration, maxDuration } = this._notification;
        const alpha = Math.min(1, duration / 30);

        ctx.save();
        ctx.globalAlpha = alpha;
        // Canvas space is PIXEL_SIZE times smaller than the screen, so an 8px
        // font here renders at 24px to the player.
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        const cx = Math.floor(ctx.canvas.width / 2);
        const cy = Math.floor(ctx.canvas.height / 3);
        ctx.fillStyle = PALETTE.void;
        ctx.fillText(text, cx + 1, cy + 1);
        ctx.fillStyle = PALETTE.hud;
        ctx.fillText(text, cx, cy);
        ctx.restore();

        this._notification.duration--;
    }
}
