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
    const [miedoso, mosca, esbirroTirador, babosa, cochinilla] = await Promise.all([
        EsbirroMiedoso.loadAnimation(),
        MoscaTirador.loadAnimation(),
        EsbirroTirador.loadAnimation(),
        BabosaPersecucion.loadAnimation(),
        CochinillaEsquinero.loadArtwork()
    ]);
    if (!miedoso?.frames?.length || !mosca?.frames?.length || !esbirroTirador?.frames?.length ||
        !babosa?.frames?.length ||
        !cochinilla?.idle?.frames?.length || !cochinilla?.charge?.naturalWidth ||
        !cochinilla?.attack?.naturalWidth) {
        throw new Error('No se pudieron cargar todas las texturas de los enemigos.');
    }
}

// Weights are relative: the four current values total 75, so each roll is
// normalized over the enabled types. Add a floor key to change its pool later.
const MINION_WEIGHTS_BY_FLOOR = Object.freeze({
    1: Object.freeze({ esbirro_miedoso: 25, mosca_tirador: 10,
        esbirro_tirador: 20, spiral: 20 })
});

function minionWeightsForFloor(floor = 1) {
    const selectedFloor = Object.keys(MINION_WEIGHTS_BY_FLOOR)
        .map(Number).filter(value => value <= floor).sort((a, b) => b - a)[0] || 1;
    const weights = MINION_WEIGHTS_BY_FLOOR[selectedFloor];
    const allowed = ENEMY_TYPES_BY_CATEGORY[ENEMY_CATEGORY.MINIONS];
    let total = 0;
    for (const [type, weight] of Object.entries(weights)) {
        if (!allowed.includes(type) || !Number.isFinite(weight) || weight < 0) {
            throw new Error(`Peso de esbirro inválido en piso ${selectedFloor}: ${type}=${weight}`);
        }
        total += weight;
    }
    if (!(total > 0)) throw new Error(`El piso ${selectedFloor} no tiene esbirros habilitados.`);
    return { weights, total };
}

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
function randomEnemyType(category = ENEMY_CATEGORY.MINIONS, floor = 1) {
    if (category === ENEMY_CATEGORY.MINIONS) {
        const { weights, total } = minionWeightsForFloor(floor);
        let roll = Math.random() * total;
        for (const [type, weight] of Object.entries(weights)) {
            roll -= weight;
            if (roll < 0) return type;
        }
        return Object.keys(weights).find(type => weights[type] > 0);
    }
    const pool = ENEMY_TYPES_BY_CATEGORY[category] || [];
    return pool.length ? chooseEnemyType(pool) : null;
}

/** Hard rooms use the same floor pool; their separate miniboss rule remains. */
function hardEnemyType(floor = 1) {
    return randomEnemyType(ENEMY_CATEGORY.MINIONS, floor);
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
