/**
 * Main bootstrap — initializes canvas, game, UI, and wires up buttons.
 */
(function() {
    'use strict';

    // Get canvas elements
    const canvas = document.getElementById('game');
    const minimapCanvas = document.getElementById('minimap');

    /**
     * Size the backing store to the window divided by PIXEL_SIZE, then let CSS
     * stretch it back to full size with smoothing off. Everything therefore
     * lands on a visible pixel grid, and the upscale is what gives the chunky
     * look rather than any per-sprite trickery.
     */
    function resizeCanvas() {
        canvas.width = Math.ceil(window.innerWidth / PIXEL_SIZE);
        canvas.height = Math.ceil(window.innerHeight / PIXEL_SIZE);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        // Resizing the backing store resets context state, so re-disable
        // smoothing every time.
        canvas.getContext('2d').imageSmoothingEnabled = false;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Declared before the button handlers below, which capture it.
    let touch = null;

    // Initialize systems
    const audio = new AudioSystem();
    const ui = new UI(canvas, minimapCanvas);
    const game = new Game(canvas, ui, audio);
    window.abyssGame = game;
    let retryLoadingAction = null;

    // Begin fetching authored enemy art in the lobby; startGame and co-op
    // await the same cached loads before any encounter can be shown.
    loadEnemyArtwork().catch(() => {});

    function focusGameCanvas() {
        if (game.state !== 'PLAYING' && game.state !== 'PAUSED') return;
        try { canvas.focus({ preventScroll: true }); }
        catch (_) { canvas.focus(); }
    }

    // Escape toggles browser fullscreen. Pointer lock keeps the system cursor
    // away from the browser's top-edge exit control while the game is active.
    // The game's own virtual cursor continues to receive relative movement.
    // Entering on keyup prevents the same Escape keydown from immediately
    // releasing fullscreen or pointer lock.
    // The requested action is captured on keydown so fullscreenchange during
    // that key press cannot turn an intended exit into a re-entry.
    const fullscreenRoot = document.documentElement;
    let escapeActionOnKeyup = null;
    let fullscreenExitPending = false;
    let fullscreenEntryPending = false;
    function isGameFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }
    function syncFullscreenCursor() {
        const active = isGameFullscreen();
        if (active) fullscreenEntryPending = false;
        fullscreenRoot.classList.toggle('game-fullscreen', active);
        fullscreenRoot.classList.toggle('game-menu-cursor', active &&
            (game.state === 'START' || game.state === 'PAUSED' ||
             game.state === 'LEVEL_UP' || game.state === 'GAME_OVER'));
        if (!active) {
            fullscreenExitPending = false;
            if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        }
        // Fullscreen transitions can return focus to the browser's prior UI
        // element instead of the game surface. Restore it after the transition.
        setTimeout(focusGameCanvas, 0);
    }
    document.addEventListener('fullscreenchange', syncFullscreenCursor);
    document.addEventListener('webkitfullscreenchange', syncFullscreenCursor);
    function captureGamePointer() {
        if (touch || game.state !== 'PLAYING' || document.pointerLockElement === canvas ||
            typeof canvas.requestPointerLock !== 'function') return;
        try {
            // requestFullscreen consumes the activation, so pointer lock must
            // be requested first and without awaiting its optional Promise.
            const request = canvas.requestPointerLock();
            if (request && typeof request.catch === 'function') request.catch(() => {});
        } catch (_) { /* Fullscreen remains usable if pointer lock is denied. */ }
    }
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas && !isGameFullscreen() && !fullscreenEntryPending) {
            document.exitPointerLock?.();
            return;
        }
        if (game.pointerLockReleaseForMenu && document.pointerLockElement !== canvas) {
            game.pointerLockReleaseForMenu = false;
            return;
        }
        // Escape can release pointer lock before its keyup reaches the page.
        // In that case also leave fullscreen, so one press still toggles it off.
        if (document.pointerLockElement !== canvas && isGameFullscreen() &&
            game.state === 'PLAYING' && !fullscreenExitPending) {
            fullscreenExitPending = true;
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            try { exit?.call(document); } catch (_) { fullscreenExitPending = false; }
        }
    });
    window.addEventListener('focus', focusGameCanvas);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) focusGameCanvas();
    });
    syncFullscreenCursor();

    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && isGameFullscreen() && game.state === 'PLAYING') captureGamePointer();
        if (event.code !== 'Escape' || event.repeat) return;
        event.preventDefault();
        escapeActionOnKeyup = isGameFullscreen() ? 'exit' : 'enter';
    }, true);

    window.addEventListener('keyup', (event) => {
        if (event.code !== 'Escape' || !escapeActionOnKeyup) return;
        event.preventDefault();
        const requestedAction = escapeActionOnKeyup;
        escapeActionOnKeyup = null;
        const active = isGameFullscreen();
        if ((requestedAction === 'enter' && active) ||
            (requestedAction === 'exit' && !active)) return;
        const action = requestedAction === 'exit'
            ? (document.exitFullscreen || document.webkitExitFullscreen)
            : (fullscreenRoot.requestFullscreen || fullscreenRoot.webkitRequestFullscreen);
        if (!action) return;
        try {
            if (requestedAction === 'enter') {
                fullscreenEntryPending = true;
                captureGamePointer();
            }
            else fullscreenExitPending = true;
            const result = requestedAction === 'exit'
                ? action.call(document)
                : action.call(fullscreenRoot, { navigationUI: 'hide' });
            if (result && typeof result.then === 'function') {
                result.then(() => {
                    fullscreenEntryPending = false;
                    syncFullscreenCursor();
                }, () => {
                    fullscreenEntryPending = false;
                    fullscreenExitPending = false;
                    syncFullscreenCursor();
                });
            } else {
                syncFullscreenCursor();
            }
        } catch (_) {
            fullscreenEntryPending = false;
            fullscreenExitPending = false;
            if (!isGameFullscreen() && document.pointerLockElement === canvas) document.exitPointerLock?.();
            // Fullscreen can be unavailable in embedded browsers; gameplay is unaffected.
        }
    }, true);

    // Clicking to resume or confirming an upgrade is a fresh user gesture,
    // so restore capture after those menus close. A canvas click also lets a
    // player grant pointer-lock permission after entering fullscreen.
    window.addEventListener('click', () => {
        if (isGameFullscreen() && game.state === 'PLAYING') captureGamePointer();
    });

    // Music tracks are optional: drop files in audio/ and they play, otherwise
    // the game runs with effects only.
    audio.setTracks([
        'audio/rins-theme_loop.ogg', // floor 1 — chiptune fantasy battle
        'audio/savage-engine',       // floor 2
        'audio/engine-of-the-abyss', // floor 3
        'audio/hydraulic-siege'      // floor 4 and onward
    ]);

    // Autoplay policies only allow audio after a gesture. Catch the first one
    // anywhere on the page so the lobby, the offline button and the online
    // game_start message all end up with music.
    const unlockAudio = () => { audio.unlock(); audio.ensureMusic(0); };
    window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

    async function startGame(characterId = 'pistolero', testRoom = false) {
        // Browsers start an AudioContext suspended; only a user gesture may
        // resume it, so this has to happen here rather than at load.
        audio.unlock();
        retryLoadingAction = () => startGame(characterId, testRoom);
        ui.showLoading();
        try {
            // Yield a task so the cover paints. requestAnimationFrame can be
            // paused indefinitely by a backgrounded or throttled tab.
            await new Promise(resolve => setTimeout(resolve, 0));
            await Promise.all([
                RoomTemplateLibrary.load(),
                loadEnemyArtwork(),
                Promise.resolve().then(() => game.prepareForNewRun())
            ]);
            audio.ensureMusic(0);
            requestFullscreenIfTouch();
            if (touch) touch.releaseAll();
            game.start(characterId, testRoom);
            game.startLoop();
            ui.hideLoading();
            retryLoadingAction = null;
        } catch (error) {
            console.error('No se pudo preparar la nueva partida.', error);
            ui.showLoadingError('No se pudieron preparar los recursos. Comprueba la conexión o inténtalo de nuevo.');
        }
        // Blur any focused element so keyboard events reach window listeners
        if (!ui.loadingScreen?.classList.contains('has-error')) {
            if (document.activeElement) document.activeElement.blur();
            // Also focus the now-focusable canvas so keyboard input has a stable target.
            focusGameCanvas();
        }
    }

    document.getElementById('loading-retry').addEventListener('click', () => {
        if (retryLoadingAction) retryLoadingAction();
        else if (window.coopGame?.retryStart) window.coopGame.retryStart();
    });

    // Wire up button handlers
    document.getElementById('start-btn').addEventListener('click', (e) => {
        e.preventDefault();
        startGame();
    });

    document.getElementById('restart-btn').addEventListener('click', (e) => {
        e.preventDefault();
        if (game.coopMode) {
            window.coopClient.starting = true;
            game.ui.showLoading();
            window.coopClient.send({ type: 'restart' });
        }
        else startGame(game.characterId || 'pistolero', game.testRoom);
    });

    document.getElementById('resume-btn').addEventListener('click', (e) => {
        e.preventDefault();
        // Go through togglePause() rather than setting state directly, so the
        // button and the Space key can never drift apart.
        game.togglePause();
        // The thumb that tapped Resume must not be left registered as held.
        if (touch) touch.releaseAll();
        if (document.activeElement) document.activeElement.blur();
        focusGameCanvas();
    });

    document.getElementById('confirm-upgrade').addEventListener('click', (e) => {
        e.preventDefault();
        game.applyUpgrade();
    });

    // ===== Touch =====
    const touchLayer = document.getElementById('touch-layer');
    const touchPause = document.getElementById('touch-pause');
    const touchReload = document.getElementById('touch-reload');

    if (TouchControls.isTouchDevice()) {
        document.body.classList.add('touch-device');
        touchLayer.classList.remove('hidden');
        touchPause.classList.remove('hidden');
        touchReload.classList.remove('hidden');
        touch = new TouchControls(game.input, touchLayer);
        touchLayer.addEventListener('pointerdown', () => audio.unlock(), { once: true });
        touchReload.addEventListener('click', (e) => {
            e.preventDefault();
            game.input.keys.KeyR = true;
            setTimeout(() => { game.input.keys.KeyR = false; }, 150);
        });

        touchPause.addEventListener('click', (e) => {
            e.preventDefault();
            game.togglePause();
            if (touch) touch.releaseAll();
        });

        // A backgrounded tab never delivers pointerup, so the thumb would stay
        // "down" on return. Drop everything when visibility is lost.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && touch) touch.releaseAll();
        });

        // Orientation changes report the new size late on some devices, so
        // resize again on the next frame as well as immediately.
        window.addEventListener('orientationchange', () => {
            resizeCanvas();
            requestAnimationFrame(resizeCanvas);
            setTimeout(resizeCanvas, 250);
        });
    }

    /**
     * Ask for fullscreen on a touch device. Must be called from inside a user
     * gesture, and is best-effort: iOS Safari does not implement it for
     * arbitrary elements, so a rejection is normal and not worth surfacing.
     */
    function requestFullscreenIfTouch() {
        if (!touch || document.fullscreenElement) return;
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (fn) { try { fn.call(el); } catch (_) { /* ignore */ } }
    }

    // Sound toggle — works with mouse and touch alike
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        audio.unlock();
        ui.setMuted(audio.toggleMute());
        if (document.activeElement) document.activeElement.blur();
        focusGameCanvas();
    });
    window.startOfflineGame = startGame;
    window.startTestRoom = (characterId) => startGame(characterId, true);
    ui.setMuted(audio.muted);

    // Show start screen
    ui.showStart();
})();
