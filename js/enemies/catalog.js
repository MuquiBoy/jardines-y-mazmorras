/**
 * Enemy taxonomy and construction.
 *
 * Template folders still call ordinary rooms "combat"; that name is the
 * generator's existing equivalent of "combat-simple".
 */
const ENEMY_CATEGORY = Object.freeze({
    MINIONS: 'esbirros',
    MINI_BOSSES: 'mini-jefes'
});

const ENEMY_TYPES_BY_CATEGORY = Object.freeze({
    [ENEMY_CATEGORY.MINIONS]: Object.freeze(['esbirro_miedoso', 'mosca_tirador', 'esbirro_tirador', 'spiral']),
    [ENEMY_CATEGORY.MINI_BOSSES]: Object.freeze(['cochinilla-esquinero', 'babosa_persecucion'])
});

const ENEMY_CATEGORIES_BY_ROOM = Object.freeze({
    combat: Object.freeze([ENEMY_CATEGORY.MINIONS]),
    'combat-simple': Object.freeze([ENEMY_CATEGORY.MINIONS]),
    'combat-hard': Object.freeze([ENEMY_CATEGORY.MINIONS, ENEMY_CATEGORY.MINI_BOSSES])
});

// Conventional floor bosses use their dedicated boss room, outside ordinary
// minion/miniboss pools.
const ENEMY_CLASSES = Object.freeze({
    esbirro_miedoso: EsbirroMiedoso,
    mosca_tirador: MoscaTirador,
    esbirro_tirador: EsbirroTirador,
    spiral: SpiralEnemy,
    boss: BossEnemy,
    'cochinilla-esquinero': CochinillaEsquinero,
    'corner-cochinilla': CochinillaEsquinero,
    cochinilla_esquinero: CochinillaEsquinero,
    babosa_persecucion: BabosaPersecucion
});

/** Load authored enemy art once before either solo or co-op gameplay is shown. */
async function loadEnemyArtwork() {
    // Esbirro Tirador shares Mosca Tirador's current animation and decoded frames.
    const [mosca, babosa, cochinilla] = await Promise.all([
        MoscaTirador.loadAnimation(),
        BabosaPersecucion.loadAnimation(),
        CochinillaEsquinero.loadSprite()
    ]);
    if (!mosca?.frames?.length || !babosa?.frames?.length || !cochinilla?.naturalWidth) {
        throw new Error('No se pudieron cargar todas las texturas de los enemigos.');
    }
}

const MINION_WEIGHTS = Object.freeze(['esbirro_miedoso', 'esbirro_miedoso', 'esbirro_miedoso', 'mosca_tirador', 'esbirro_tirador', 'spiral']);
const HARD_MINION_WEIGHTS = Object.freeze(['esbirro_miedoso', 'mosca_tirador', 'spiral', 'esbirro_tirador', 'spiral']);

function enemyCategoriesForRoom(roomType) {
    return ENEMY_CATEGORIES_BY_ROOM[roomType] || [];
}

function enemyCategoryForType(type) {
    for (const [category, types] of Object.entries(ENEMY_TYPES_BY_CATEGORY)) {
        if (types.includes(type)) return category;
    }
    return null;
}

function enemyTypeAllowedInRoom(type, roomType) {
    const category = enemyCategoryForType(type);
    return !!category && enemyCategoriesForRoom(roomType).includes(category);
}

function chooseEnemyType(types) {
    return types[Math.floor(Math.random() * types.length)];
}

function createEnemy(type, x, y, ...args) {
    const normalizedType = type === 'corner-cochinilla' || type === 'cochinilla_esquinero'
        ? 'cochinilla-esquinero' : type;
    const EnemyClass = ENEMY_CLASSES[normalizedType] || EsbirroMiedoso;
    if (EnemyClass === CochinillaEsquinero) {
        return new EnemyClass(x, y, args[0] || null, args[1] || 'top-left');
    }
    if (EnemyClass === BabosaPersecucion) return new EnemyClass(x, y, args[0] || null);
    return new EnemyClass(x, y);
}

/** Weighted ordinary-room pool; never returns minibosses or the floor boss. */
function randomEnemyType(category = ENEMY_CATEGORY.MINIONS) {
    if (category === ENEMY_CATEGORY.MINIONS) return chooseEnemyType(MINION_WEIGHTS);
    const pool = ENEMY_TYPES_BY_CATEGORY[category] || [];
    return pool.length ? chooseEnemyType(pool) : null;
}

/** Hard rooms use a denser mix of the same esbirros, plus a miniboss spawn. */
function hardEnemyType() {
    return chooseEnemyType(HARD_MINION_WEIGHTS);
}

function randomMiniBossType(excludeType = null) {
    // Per-room weighted roll: 50% Cochinilla Esquinero, 50% Babosa Persecución.
    if (excludeType) {
        const alternatives = (ENEMY_TYPES_BY_CATEGORY[ENEMY_CATEGORY.MINI_BOSSES] || [])
            .filter(type => type !== excludeType);
        return alternatives.length ? chooseEnemyType(alternatives) : null;
    }
    return Math.random() < 0.50 ? 'cochinilla-esquinero' : 'babosa_persecucion';
}
