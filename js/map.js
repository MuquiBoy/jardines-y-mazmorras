/**
 * Procedural map generation — rooms, corridors, enemy spawns.
 */

/**
 * DungeonMap — a procedurally generated dungeon floor.
 *
 * Named DungeonMap, not Map: a top-level `class Map` in a classic script
 * shadows the built-in Map for every other script on the page, so an innocent
 * `new Map()` anywhere in the project silently returns a dungeon with no
 * .get/.set/.clear. That is exactly how it bit the touch controls.
 */
const TEMPLATE_OPPOSITE_SIDE = { N: 'S', S: 'N', E: 'W', W: 'E' };

function rotateRoomTemplate(template, turns) {
    let current = template;
    for (let turn = 0; turn < turns; turn++) {
        const widthTiles = current.heightTiles, heightTiles = current.widthTiles;
        const mask = new Uint8Array(widthTiles * heightTiles);
        const rotatePoint = point => ({ x: current.heightTiles - 1 - point.y, y: point.x });
        for (let y = 0; y < current.heightTiles; y++) for (let x = 0; x < current.widthTiles; x++) {
            const point = rotatePoint({ x, y });
            mask[point.y * widthTiles + point.x] = current.mask[y * current.widthTiles + x];
        }
        current = { ...current, widthTiles, heightTiles, mask,
            doors: collectRoomTemplateDoors(mask, widthTiles, heightTiles),
            walkableCells: current.walkableCells.map(rotatePoint),
            playerSpawn: current.playerSpawn ? rotatePoint(current.playerSpawn) : null,
            enemySpawns: current.enemySpawns.map(rotatePoint) };
    }
    return { ...current, id: `${template.path}#r${turns}`, path: template.path, type: template.type, rotation: turns };
}

function roomTemplateOrientations(template) {
    return [0, 1, 2, 3].map(turns => turns === 0 ? { ...template, rotation: 0 } : rotateRoomTemplate(template, turns));
}

function collectRoomTemplateDoors(mask, width, height) {
    const doors = [];
    const edges = [
        ['N', width, i => i * 1, i => i],
        ['S', width, i => (height - 1) * width + i, i => i],
        ['W', height, i => i * width, i => i],
        ['E', height, i => i * width + width - 1, i => i]
    ];
    for (const [side, size, indexAt, offsetAt] of edges) {
        let start = -1;
        for (let i = 0; i <= size; i++) {
            const marked = i < size && mask[indexAt(i)] === 2;
            if (marked && start < 0) start = i;
            if (!marked && start >= 0) { doors.push({ side, offset: offsetAt(start), length: i - start }); start = -1; }
        }
    }
    return doors;
}

function shuffledCopy(values) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function roomDoorTouches(a, doorA, b, doorB) {
    if (TEMPLATE_OPPOSITE_SIDE[doorA.side] !== doorB.side || doorA.length !== doorB.length) return false;
    if (doorA.side === 'E') return a.tx + a.tw === b.tx && a.ty + doorA.offset === b.ty + doorB.offset;
    if (doorA.side === 'W') return a.tx === b.tx + b.tw && a.ty + doorA.offset === b.ty + doorB.offset;
    if (doorA.side === 'S') return a.ty + a.th === b.ty && a.tx + doorA.offset === b.tx + doorB.offset;
    return a.ty === b.ty + b.th && a.tx + doorA.offset === b.tx + doorB.offset;
}

function positionRoomAtDoor(parent, parentDoor, child, childDoor) {
    let tx, ty;
    if (parentDoor.side === 'N') {
        tx = parent.tx + parentDoor.offset - childDoor.offset;
        ty = parent.ty - child.th;
    } else if (parentDoor.side === 'S') {
        tx = parent.tx + parentDoor.offset - childDoor.offset;
        ty = parent.ty + parent.th;
    } else if (parentDoor.side === 'W') {
        tx = parent.tx - child.tw;
        ty = parent.ty + parentDoor.offset - childDoor.offset;
    } else {
        tx = parent.tx + parent.tw;
        ty = parent.ty + parentDoor.offset - childDoor.offset;
    }
    child.tx = tx;
    child.ty = ty;
}

/** Thin collision plane across one authored door, in world coordinates. */
function doorBarrierRect(room, door, thickness = 16) {
    const ts = room.tileSize || 40;
    const half = thickness / 2;
    const span = door.length * ts;
    if (door.side === 'N' || door.side === 'S') {
        const y = door.side === 'N' ? room.ty * ts : (room.ty + room.th) * ts;
        return { x: (room.tx + door.offset) * ts, y: y - half, w: span, h: thickness, side: door.side };
    }
    const x = door.side === 'W' ? room.tx * ts : (room.tx + room.tw) * ts;
    return { x: x - half, y: (room.ty + door.offset) * ts, w: thickness, h: span, side: door.side };
}

/** Circle vs axis-aligned rectangle, used to delay closing a door on someone. */
function circleOverlapsRect(x, y, radius, rect) {
    const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    return Math.hypot(x - closestX, y - closestY) < radius;
}

/** Binary min-heap used by DungeonMap.findPath to keep A* cheap. */
class PathMinHeap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(cx, cy, score) {
        const item = { cx, cy, score };
        let index = this.items.length;
        this.items.push(item);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.items[parent].score <= item.score) break;
            this.items[index] = this.items[parent];
            index = parent;
        }
        this.items[index] = item;
    }
    pop() {
        const top = this.items[0];
        const last = this.items.pop();
        if (this.items.length) {
            let index = 0;
            while (true) {
                const left = index * 2 + 1, right = left + 1;
                if (left >= this.items.length) break;
                const smallest = right < this.items.length && this.items[right].score < this.items[left].score ? right : left;
                if (this.items[smallest].score >= last.score) break;
                this.items[index] = this.items[smallest];
                index = smallest;
            }
            this.items[index] = last;
        }
        return top;
    }
}

class DungeonMap {
    constructor(width = 14000, height = 14000) {
        this.width = width;
        this.height = height;
        this.tileSize = 40; // authored floor tile: 40px against the 24px player sprite.
        this.corridorWidth = 128; // 4 tiles — wide enough to dodge in
        this.rooms = [];
        this.corridors = [];
        this.doorBlockers = []; // solid planes across locked gameplay doors
        this.exit = null;      // created by openExit() once the boss is dead
        this.bossRoom = null;
        this.playerStart = null;
        this.roomsCleared = 0;
        this.totalRooms = 0;
        // Fewer rooms than before, because each one is now several times larger
        // and carries proportionally more of the run.
        this.roomCount = 6 + Math.floor(Math.random() * 4); // 6-9 rooms
    }

    /** Build one floor from the available authored PNG room templates. */
    generate(floorNumber = 1) {
        this.rooms = [];
        this.corridors = [];
        this.doorBlockers = [];
        this.bossRoom = null;
        this.exit = null;
        this.generationFallback = false;
        this.generationDiagnostics = [];
        this.floorNumber = Math.max(1, Math.floor(Number(floorNumber) || 1));

        const catalog = typeof RoomTemplateLibrary !== 'undefined' ? RoomTemplateLibrary.byType : null;
        const templates = type => catalog?.get(type) || [];
        const orientedTemplates = new Map(['entry', 'hub', 'combat', 'combat-hard', 'treasure', 'boss'].map(type =>
            [type, templates(type).flatMap(template => roomTemplateOrientations(template))]));
        const variantsFor = (type, doors) => (orientedTemplates.get(type) || [])
            .filter(variant => variant.doors.length === doors);
        const has = (type, doors) => variantsFor(type, doors).length > 0;

        // A floor asks for 6–8 combat rooms and 1–2 hard rooms, all joined by
        // two-door hubs. Every gameplay room therefore has exactly one hub
        // between it and its neighbour, so every transition crosses an
        // authored passage instead of a painted corridor.
        const combatTarget = 6 + Math.floor(Math.random() * 3); // 6-8
        const hardChance = Math.min(0.9, 0.35 + (this.floorNumber - 1) * 0.08);
        const hardTarget = 1 + (Math.random() < hardChance ? 1 : 0); // 1-2
        const gameplayTarget = combatTarget + hardTarget;
        const interiorTarget = gameplayTarget - 3; // junction A, treasure junction, wing leaf
        // Hubs = gameplay rooms - 1: one per gameplay node except the root.
        const expectedHubs = gameplayTarget + 2;

        const hasLeaves = ['entry', 'treasure', 'boss'].every(type => has(type, 1));
        const threeDoor = has('combat', 3) ? 'combat' : has('combat-hard', 3) ? 'combat-hard' : null;
        const forkUsesHardJunctions = threeDoor === 'combat-hard';
        const canForkBranch = hasLeaves && has('hub', 2) && has('combat', 1) &&
            has('combat', 2) && has('combat-hard', 2) && !!threeDoor &&
            (!forkUsesHardJunctions || hardTarget >= 2) && interiorTarget >= 4;
        const canSpine = hasLeaves && has('hub', 2) && has('combat', 2) &&
            has('combat-hard', 2) && !!threeDoor;

        if (!canForkBranch && !canSpine) {
            this.generationDiagnostics.push('No hay plantillas con las puertas necesarias para un piso de 7 combate + 2 difíciles unidos por hubs.');
            console.warn('Catálogo de salas insuficiente; se conserva el generador seguro de respaldo.', this.generationDiagnostics[0]);
            this.generationFallback = true;
            this.generateLegacy();
            return this;
        }

        const mapTilesWide = Math.floor(this.width / this.tileSize);
        const mapTilesHigh = Math.floor(this.height / this.tileSize);

        // A hub is a real room node between two gameplay rooms. Building the
        // tree this way (instead of inventing corridors) guarantees that both
        // sides of every hub expose the same two-losa yellow door.
        const makeForkBranchGraph = () => {
            let nextId = 0;
            const make = type => ({ id: `room-${nextId++}`, type, children: [], parentNode: null });
            const link = (parent, child) => { parent.children.push(child); child.parentNode = parent; return child; };
            const pair = (parent, type) => link(link(parent, make('hub')), make(type));
            const root = make('entry');
            // The first junction forks into a side wing and the main route;
            // the second junction hangs the treasure off the main route.
            const junction = pair(root, threeDoor);
            const interiors = [];

            const maxWing = Math.min(3, gameplayTarget - 2);
            const wingCount = 1 + Math.floor(Math.random() * maxWing);
            const mainCount = gameplayTarget - 1 - wingCount;

            let cursor = junction;
            for (let i = 0; i < wingCount; i++) {
                const node = pair(cursor, 'combat');
                if (i < wingCount - 1) interiors.push(node); // 2 doors
                cursor = node; // final wing room is the 1-door leaf
            }

            const treasureIndex = Math.floor(Math.random() * mainCount);
            cursor = junction;
            for (let i = 0; i < mainCount; i++) {
                const isTreasure = i === treasureIndex;
                const node = pair(cursor, isTreasure ? threeDoor : 'combat');
                if (isTreasure) pair(node, 'treasure');
                else interiors.push(node); // 2 doors
                cursor = node;
            }
            pair(cursor, 'boss');

            // Hard rooms are interior rooms, so their templates only need two
            // doors. The junction type is decided by the catalog above.
            for (const node of shuffledCopy(interiors).slice(0, hardTarget)) node.type = 'combat-hard';
            return root;
        };

        // Fallback for a catalog without the 1-door combat leaf: a single
        // spine with the treasure hanging off one 3-door room.
        const makeSpineGraph = () => {
            let nextId = 0;
            const make = type => ({ id: `room-${nextId++}`, type, children: [], parentNode: null });
            const link = (parent, child) => { parent.children.push(child); child.parentNode = parent; return child; };
            const pair = (parent, type) => link(link(parent, make('hub')), make(type));
            const root = make('entry');
            let cursor = root;
            const nodes = [];
            for (let i = 0; i < gameplayTarget; i++) {
                cursor = pair(cursor, 'combat');
                nodes.push(cursor);
            }
            pair(cursor, 'boss');

            const junction = nodes[Math.floor(Math.random() * nodes.length)];
            const others = nodes.filter(node => node !== junction);
            const hardOthers = threeDoor === 'combat-hard' ? hardTarget - 1 : hardTarget;
            for (const node of shuffledCopy(others).slice(0, Math.max(0, hardOthers))) node.type = 'combat-hard';
            junction.type = threeDoor;
            pair(junction, 'treasure');
            return root;
        };

        const buildAttempt = (root, expectedHubs) => {
            let budget = 18000;
            const placementStats = { noVariant: 0, overlap: 0, bounds: 0, doorContact: 0 };
            const rectangleOverlaps = candidate => this.rooms.some(other =>
                candidate.tx < other.tx + other.tw && candidate.tx + candidate.tw > other.tx &&
                candidate.ty < other.ty + other.th && candidate.ty + candidate.th > other.ty);
            const layoutFitsBounds = candidate => {
                const all = [...this.rooms, candidate];
                const minX = Math.min(...all.map(room => room.tx));
                const minY = Math.min(...all.map(room => room.ty));
                const maxX = Math.max(...all.map(room => room.tx + room.tw));
                const maxY = Math.max(...all.map(room => room.ty + room.th));
                return maxX - minX <= mapTilesWide - 2 && maxY - minY <= mapTilesHigh - 2;
            };
            const createsUnlinkedDoorContact = (candidate, parentRoom, parentDoorIndex, childDoorIndex) => {
                for (const other of this.rooms) {
                    for (let newIndex = 0; newIndex < candidate.template.doors.length; newIndex++) {
                        for (let oldIndex = 0; oldIndex < other.template.doors.length; oldIndex++) {
                            if (!roomDoorTouches(candidate, candidate.template.doors[newIndex], other, other.template.doors[oldIndex])) continue;
                            const isSelectedConnection = other === parentRoom && oldIndex === parentDoorIndex && newIndex === childDoorIndex;
                            if (!isSelectedConnection) return true;
                        }
                    }
                }
                return false;
            };

            const placeNode = (node, parentRoom, continueAfterSubtree) => {
                const neededDoors = node.children.length + (parentRoom ? 1 : 0);
                const variants = shuffledCopy(variantsFor(node.type, neededDoors));
                if (!variants.length) { placementStats.noVariant++; return false; }
                const children = shuffledCopy(node.children);

                for (const variant of variants) {
                    const base = {
                        id: node.id, tx: 0, ty: 0, tw: variant.widthTiles, th: variant.heightTiles,
                        type: node.type, templateId: variant.id, template: variant, parent: parentRoom,
                        cleared: false, spawned: false, locked: false, lockPending: false,
                        _usedTemplateDoors: new Array(variant.doors.length).fill(false)
                    };
                    const incomingOptions = [];
                    if (parentRoom) {
                        for (let parentIndex = 0; parentIndex < parentRoom.template.doors.length; parentIndex++) {
                            if (parentRoom._usedTemplateDoors[parentIndex]) continue;
                            for (let childIndex = 0; childIndex < variant.doors.length; childIndex++) {
                                if (TEMPLATE_OPPOSITE_SIDE[parentRoom.template.doors[parentIndex].side] === variant.doors[childIndex].side)
                                    incomingOptions.push({ parentIndex, childIndex });
                            }
                        }
                        for (let i = incomingOptions.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [incomingOptions[i], incomingOptions[j]] = [incomingOptions[j], incomingOptions[i]];
                        }
                    } else incomingOptions.push(null);

                    for (const incoming of incomingOptions) {
                        if (--budget < 0) return false;
                        const room = { ...base };
                        let corridor = null;
                        if (incoming) {
                            const parentDoor = parentRoom.template.doors[incoming.parentIndex];
                            const childDoor = variant.doors[incoming.childIndex];
                            positionRoomAtDoor(parentRoom, parentDoor, room, childDoor);
                            if (rectangleOverlaps(room)) { placementStats.overlap++; continue; }
                            if (!layoutFitsBounds(room)) { placementStats.bounds++; continue; }
                            if (createsUnlinkedDoorContact(room, parentRoom, incoming.parentIndex, incoming.childIndex)) { placementStats.doorContact++; continue; }
                            parentRoom._usedTemplateDoors[incoming.parentIndex] = true;
                            room._usedTemplateDoors[incoming.childIndex] = true;
                            corridor = { a: parentRoom, b: room, doorA: incoming.parentIndex, doorB: incoming.childIndex, templateConnection: true };
                            this.corridors.push(corridor);
                        } else {
                            if (!layoutFitsBounds(room)) { placementStats.bounds++; continue; }
                        }
                        this.rooms.push(room);
                        node.room = room;

                        const placeChildren = (index, done) => {
                            if (index >= children.length) return done();
                            const child = children[index];
                            return placeNode(child, room, () => placeChildren(index + 1, done));
                        };
                        if (placeChildren(0, continueAfterSubtree)) return true;

                        this.rooms.pop();
                        if (corridor) {
                            this.corridors.pop();
                            parentRoom._usedTemplateDoors[incoming.parentIndex] = false;
                        }
                    }
                }
                return false;
            };

            if (!placeNode(root, null, () => true)) {
                this.generationDiagnostics.push(`placement budget=${budget}; partial=${this.rooms.length}; stats=${JSON.stringify(placementStats)}`);
                return false;
            }
            const placedHubs = this.rooms.filter(room => room.type === 'hub').length;
            if (placedHubs !== expectedHubs) {
                this.generationDiagnostics.push(`se esperaban ${expectedHubs} hubs y se colocaron ${placedHubs}`);
                return false;
            }
            const minX = Math.min(...this.rooms.map(room => room.tx));
            const minY = Math.min(...this.rooms.map(room => room.ty));
            const maxX = Math.max(...this.rooms.map(room => room.tx + room.tw));
            const maxY = Math.max(...this.rooms.map(room => room.ty + room.th));
            const shiftX = Math.floor((mapTilesWide - (maxX - minX)) / 2) - minX;
            const shiftY = Math.floor((mapTilesHigh - (maxY - minY)) / 2) - minY;
            for (const room of this.rooms) { room.tx += shiftX; room.ty += shiftY; }
            this.bossRoom = this.rooms.find(room => room.type === 'boss') || null;
            return true;
        };

        const composition = { combat: combatTarget, hard: hardTarget, hubs: expectedHubs };
        const layouts = [];
        if (canForkBranch) layouts.push({ name: 'fork-branch', make: makeForkBranchGraph });
        if (canSpine) layouts.push({ name: 'spine-treasure', make: makeSpineGraph });

        let attempts = 0;
        for (const layout of layouts) {
            for (let attempt = 0; attempt < 24; attempt++) {
                attempts++;
                this.rooms = [];
                this.corridors = [];
                const graph = layout.make();
                if (!buildAttempt(graph, composition.hubs)) continue;
                this.layoutMode = layout.name;
                this.calculatePositions();
                if (!this.ensureConnectivity() || !this.validateTemplateFloor(composition)) {
                    this.generationDiagnostics.push(`validation rejected ${layout.name} layout (${this.rooms.length} rooms)`);
                    continue;
                }
                this.roomCount = this.rooms.length;
                this.totalRooms = this.rooms.length;
                this.roomsCleared = 0;
                return this;
            }
        }

        this.generationDiagnostics.push(`No se encontró un diseño válido tras ${attempts} intentos; se usó el generador seguro de respaldo.`);
        console.warn(this.generationDiagnostics.at(-1));
        this.generationFallback = true;
        this.generateLegacy();
        return this;
    }

    /** Fixed-size safety fallback for an incomplete template catalog. */
    generateLegacy() {
        this.rooms = [];
        this.corridors = [];

        // Place start room at the centre of the map. Each tile is 40 world px;
        // the 32x32 room footprint stays at the established 1280x1280 size.
        const startSize = 1280;
        const startTiles = Math.ceil(startSize / this.tileSize);
        const startX = Math.floor((this.width / this.tileSize - startTiles) / 2);
        const startY = Math.floor((this.height / this.tileSize - startTiles) / 2);
        const startRoom = this.placeRoom(startX, startY, 'entry', startSize);
        if (!startRoom) return this; // finite fallback

        // Place additional rooms on one fixed footprint for authored layouts.
        let attempts = 0;
        while (this.rooms.length < this.roomCount && attempts < 200) {
            attempts++;
            // Pick a random existing room
            const parentIdx = Math.floor(Math.random() * this.rooms.length);
            const parent = this.rooms[parentIdx];

            // Pick a direction
            const dir = Math.floor(Math.random() * 4);
            const offsets = [
                { dx: 0, dy: -1 },  // up
                { dx: 0, dy: 1 },   // down
                { dx: -1, dy: 0 },  // left
                { dx: 1, dy: 0 }    // right
            ];
            const offset = offsets[dir];

            const newRoom = this.tryPlaceRoom(parent, offset);

            if (newRoom) {
                this.createCorridor(parent, newRoom);
            }
        }

        // Assign room types
        this.assignRoomTypes();

        // Mark the boss room. There is deliberately no exit yet — it only
        // opens once the boss is dead, which is what stops a player walking
        // straight past every fight to the stairs.
        this.setBossRoom();
        this.assignHubRooms();

        // Apply authored color-mask layouts when available; empty categories
        // safely fall back to the procedural floor already used by the game.
        for (const room of this.rooms) room.template = RoomTemplateLibrary.pick(room.type);

        for (const room of this.rooms) room.template = null;

        // Calculate pixel positions
        this.calculatePositions();

        // Ensure connectivity
        this.ensureConnectivity();

        this.totalRooms = this.rooms.length;
        this.roomsCleared = 0;
    }

    /** Place a room at tile grid position, return room object or null. */
    tryPlaceRoom(parent, offset) {
        // Random size
        // Room sizes are driven by enemy AI ranges, not aesthetics. ShooterEnemy
        // holds a 180-250px standoff and SpiralEnemy closes to 140px, so a room
        // has to comfortably exceed twice the standoff or those enemies are
        // forced out through the walls the moment the player walks in.
        const size = { w: 32, h: 32 }; // 1280x1280; consistent with a 32x32 template.

        // Butt the new room against the parent's edge, leaving the same gap
        // overlapsAny() enforces, and centre it on the perpendicular axis so
        // the connecting corridor runs straight rather than dog-legging.
        const gap = 3;
        let tileX, tileY;
        if (offset.dx !== 0) {
            tileX = offset.dx > 0 ? parent.tx + parent.tw + gap
                                  : parent.tx - size.w - gap;
            tileY = parent.ty + Math.round((parent.th - size.h) / 2);
        } else {
            tileY = offset.dy > 0 ? parent.ty + parent.th + gap
                                  : parent.ty - size.h - gap;
            tileX = parent.tx + Math.round((parent.tw - size.w) / 2);
        }

        // Check bounds (tx/ty are top-left)
        const maxTX = this.width / this.tileSize;
        const maxTY = this.height / this.tileSize;
        if (tileX < 2 || tileX + size.w > maxTX - 2) return null;
        if (tileY < 2 || tileY + size.h > maxTY - 2) return null;

        // Check overlap with existing rooms (min 3 tile gap)
        const newRoom = {
            tx: tileX,
            ty: tileY,
            tw: size.w,
            th: size.h,
            type: 'combat',
            parent: parent,
            cleared: false
        };

        if (this.overlapsAny(newRoom, 3)) return null;

        this.rooms.push(newRoom);
        return newRoom;
    }

    /** Place a room whose top-left tile is (tileX, tileY). `size` is in pixels. */
    placeRoom(tileX, tileY, type, size) {
        const newRoom = {
            tx: tileX,
            ty: tileY,
            tw: Math.ceil(size / this.tileSize),
            th: Math.ceil(size / this.tileSize),
            type: type,
            parent: null,
            cleared: false
        };

        if (this.overlapsAny(newRoom, 3)) return null;

        this.rooms.push(newRoom);
        return newRoom;
    }

    /**
     * Check if a room overlaps any existing room, allowing a minimum gap.
     *
     * (tx, ty) is the room's TOP-LEFT tile. This must stay consistent with
     * calculatePositions(), which derives room.x/room.y the same way — an
     * earlier version treated it as the room's centre here and as the top-left
     * there, so the rectangle being collision-checked sat half a room away
     * from the one actually drawn.
     */
    overlapsAny(room, minGap) {
        const ts = this.tileSize;
        const rx1 = room.tx * ts;
        const ry1 = room.ty * ts;
        const rx2 = rx1 + room.tw * ts;
        const ry2 = ry1 + room.th * ts;

        for (const other of this.rooms) {
            if (other === room) continue;
            const ox1 = other.tx * ts - minGap * ts;
            const oy1 = other.ty * ts - minGap * ts;
            const ox2 = other.tx * ts + other.tw * ts + minGap * ts;
            const oy2 = other.ty * ts + other.th * ts + minGap * ts;

            if (rx1 < ox2 && rx2 > ox1 && ry1 < oy2 && ry2 > oy1) {
                return true;
            }
        }
        return false;
    }

    /** Create a corridor connecting two rooms (L-shaped). */
    createCorridor(roomA, roomB) {
        // Only the room references are stored here. Pixel endpoints need room
        // centres, which don't exist until calculatePositions() runs, so they
        // are resolved there rather than guessed from tile coords.
        this.corridors.push({ a: roomA, b: roomB });
    }

    /** Assign room types. */
    assignRoomTypes() {
        if (this.rooms.length < 3) return;

        const weights = {
            'combat': 5,
            'combat-hard': 3,
            'treasure': 2
        };

        for (let i = 1; i < this.rooms.length; i++) { // skip start room
            const room = this.rooms[i];
            if (room.type === 'entry') continue;

            // Weighted random
            const r = Math.random();
            let cumulative = 0;
            for (const [type, weight] of Object.entries(weights)) {
                cumulative += weight;
                if (r < cumulative / Object.values(weights).reduce((a, b) => a + b, 0)) {
                    room.type = type;
                    break;
                }
            }
        }
    }

    /**
     * Mark the room farthest from the start as the boss room.
     *
     * Never the start room: the player would spawn on top of the boss.
     */
    setBossRoom() {
        const candidates = this.rooms.filter(r => r.type !== 'entry');
        if (candidates.length === 0) return;

        const start = this.rooms[0];
        let best = candidates[0];
        let bestDist = -1;
        for (const room of candidates) {
            const dx = room.tx - start.tx;
            const dy = room.ty - start.ty;
            const d = dx * dx + dy * dy;
            if (d > bestDist) { bestDist = d; best = room; }
        }
        best.type = 'boss';
        this.bossRoom = best;
    }

    /** Keep exactly two calm hub rooms on every generated floor when possible. */
    assignHubRooms() {
        const candidates = this.rooms.filter(room =>
            room.type === 'combat' || room.type === 'combat-hard' || room.type === 'treasure');
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        for (const room of candidates.slice(0, 2)) room.type = 'hub';
    }

    /** Open a reachable exit in the boss room after its encounter ends. */
    openExit(room, awayFrom) {
        if (!room) return null;
        const candidates = room.template?.walkableCells?.map(cell => ({
            x: room.x + (cell.x + 0.5) * this.tileSize,
            y: room.y + (cell.y + 0.5) * this.tileSize
        })) || [{ x: room.cx, y: room.cy }];
        let best = null, bestDistance = -1;
        for (const point of candidates) {
            if (!this.canOccupy(point.x, point.y, 8)) continue;
            const distance = awayFrom ? Math.hypot(point.x - awayFrom.x, point.y - awayFrom.y) : 0;
            if (distance > bestDistance) { best = point; bestDistance = distance; }
        }
        if (!best) best = { x: room.cx, y: room.cy };
        this.exit = { x: best.x, y: best.y, room };
        return this.exit;
    }

    /** Resolve pixel bounds, collision grids and safe spawn points. */
    calculatePositions() {
        for (const room of this.rooms) {
            room.x = room.tx * this.tileSize;
            room.y = room.ty * this.tileSize;
            room.w = room.tw * this.tileSize;
            room.h = room.th * this.tileSize;
            room.cx = room.x + room.w / 2;
            room.cy = room.y + room.h / 2;
        }

        this.corridorRects = [];
        for (const corridor of this.corridors) {
            corridor.x1 = corridor.a.cx;
            corridor.y1 = corridor.a.cy;
            corridor.x2 = corridor.b.cx;
            corridor.y2 = corridor.b.cy;
            if (corridor.templateConnection) continue;
            for (const segment of this.corridorSegments(corridor)) {
                this.corridorRects.push({ x: segment.x1, y: segment.y1,
                    w: segment.x2 - segment.x1, h: segment.y2 - segment.y1 });
            }
        }

        const startRoom = this.rooms[0];
        const marker = startRoom?.template?.playerSpawn;
        this.playerStart = null;
        if (startRoom?.template) {
            const centerX = (startRoom.tw - 1) / 2, centerY = (startRoom.th - 1) / 2;
            const candidates = [...(marker ? [marker] : []), ...startRoom.template.walkableCells]
                .slice().sort((a, b) => Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY));
            for (const cell of candidates) {
                const point = { x: startRoom.x + (cell.x + 0.5) * this.tileSize, y: startRoom.y + (cell.y + 0.5) * this.tileSize };
                if ([-30, 0, 30].every(offset => this.canOccupy(point.x + offset, point.y, 14))) {
                    this.playerStart = point;
                    break;
                }
            }
        }
        if (!this.playerStart && startRoom) this.playerStart = this.findPointInRoom(startRoom, null, 0, 14, marker ? [marker] : []) || { x: startRoom.cx, y: startRoom.cy };
        if (this.bossRoom) this.bossRoom.markerPoint = this.findPointInRoom(this.bossRoom, null, 0, 5) || { x: this.bossRoom.cx, y: this.bossRoom.cy };
        // Treasure rooms get a visible chest marker instead of looking like an
        // ordinary empty room.
        for (const room of this.rooms) {
            if (room.type !== 'treasure') continue;
            room.treasurePoint = this.findPointInRoom(room, null, 0, 18) || { x: room.cx, y: room.cy };
        }
        this.exit = null;
    }

    /** Check the physical and graph connectivity of the generated floor. */
    ensureConnectivity() {
        if (!this.rooms.length) return false;
        const adjacency = this.rooms.map(() => []);
        for (const corridor of this.corridors) {
            const a = this.rooms.indexOf(corridor.a), b = this.rooms.indexOf(corridor.b);
            if (a < 0 || b < 0 || a === b) return false;
            if (corridor.templateConnection) {
                const doorA = corridor.a.template?.doors?.[corridor.doorA];
                const doorB = corridor.b.template?.doors?.[corridor.doorB];
                if (!doorA || !doorB || !roomDoorTouches(corridor.a, doorA, corridor.b, doorB)) return false;
            }
            adjacency[a].push(b); adjacency[b].push(a);
        }
        const visited = new Set([0]), queue = [0];
        for (let head = 0; head < queue.length; head++) {
            const index = queue[head];
            for (const next of adjacency[index]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
        }
        if (visited.size !== this.rooms.length) return false;
        if (this.generationFallback) return true;
        for (const room of this.rooms) {
            if (room._usedTemplateDoors?.some(used => !used)) return false;
            if (!room.template || room.template.doors.length !== room._usedTemplateDoors.length) return false;
        }
        for (let i = 0; i < this.rooms.length; i++) for (let j = i + 1; j < this.rooms.length; j++) {
            const a = this.rooms[i], b = this.rooms[j];
            if (a.tx < b.tx + b.tw && a.tx + a.tw > b.tx && a.ty < b.ty + b.th && a.ty + a.th > b.ty) return false;
            for (const doorA of a.template.doors) for (const doorB of b.template.doors) {
                if (!roomDoorTouches(a, doorA, b, doorB)) continue;
                if (!this.corridors.some(c => (c.a === a && c.b === b || c.a === b && c.b === a) && c.templateConnection)) return false;
            }
        }
        return true;
    }

    /** Validate the requested composition and the hub-only transition graph. */
    validateTemplateFloor(expected) {
        const counts = this.rooms.reduce((result, room) => {
            result[room.type] = (result[room.type] || 0) + 1;
            return result;
        }, {});
        if (counts.entry !== 1 || counts.combat !== expected.combat ||
            counts['combat-hard'] !== expected.hard ||
            counts.hub !== expected.hubs || counts.treasure !== 1 || counts.boss !== 1) return false;
        const entry = this.rooms.find(room => room.type === 'entry');
        const hubs = this.rooms.filter(room => room.type === 'hub');
        if (hubs.length !== expected.hubs || hubs.some(hub => hub.template.doors.length !== 2)) return false;
        if (this.corridors.some(edge => edge.a.type === 'hub' && edge.b.type === 'hub')) return false;
        const firstConnection = this.corridors.find(edge => edge.a === entry || edge.b === entry);
        const firstRoom = firstConnection && (firstConnection.a === entry ? firstConnection.b : firstConnection.a);
        return !!entry && entry.template.doors.length === 1 && firstRoom?.type === 'hub' &&
            this.bossRoom?.type === 'boss' && this.ensureConnectivity();
    }

    /** Return a safe floor-tile centre, preferring authored spawn markers. */
    findPointInRoom(room, avoid = null, minDist = 0, radius = 14, preferred = []) {
        if (!room) return null;
        const template = room.template;
        let cells = [];
        let fallbackCells = [];
        if (template) {
            cells = [...shuffledCopy(preferred), ...shuffledCopy(template.enemySpawns)];
            fallbackCells = shuffledCopy(template.walkableCells);
        }
        let best = null, bestDistance = -1;
        for (const cell of [...cells, ...fallbackCells]) {
            const point = { x: room.x + (cell.x + 0.5) * this.tileSize, y: room.y + (cell.y + 0.5) * this.tileSize };
            if (!this.canOccupy(point.x, point.y, radius)) continue;
            const distance = avoid ? Math.hypot(point.x - avoid.x, point.y - avoid.y) : Infinity;
            if (distance >= minDist) return point;
            if (distance > bestDistance) { best = point; bestDistance = distance; }
        }
        if (best) return best;
        if (!template && this.canOccupy(room.cx, room.cy, radius)) return { x: room.cx, y: room.cy };
        return null;
    }

    /** Pick a bounded, collision-safe enemy position inside the room. */
    spawnPointInRoom(room, avoid, minDist) {
        const point = this.findPointInRoom(room, avoid, minDist, 14);
        if (point) return point;
        return { x: room.cx, y: room.cy };
    }

    /**
     * Boss spawn anchor for its 40px body.
     *
     * Generic spawn markers are calibrated for 14px enemies, so a boss placed
     * on one can start with half its body inside a wall. Prefer the room
     * centre (the new boss hall is authored around it), then fall back to any
     * free tile where the full circular footprint fits.
     */
    findBossSpawn(room, avoid, minDist, radius = 40) {
        const centre = { x: room.cx, y: room.cy };
        const farEnough = point => !avoid || Math.hypot(point.x - avoid.x, point.y - avoid.y) >= minDist;
        if (this.canOccupy(centre.x, centre.y, radius) && farEnough(centre)) return centre;

        const centreCell = { x: Math.floor(room.tw / 2), y: Math.floor(room.th / 2) };
        const point = this.findPointInRoom(room, avoid, minDist, radius, [centreCell]);
        if (point) return point;

        return this.findFreeSpotNear(centre.x, centre.y, radius, [], 900, room) || centre;
    }

    /**
     * Nearest point to (x, y) where a body of `radius` fits.
     *
     * Used in co-op to pull late players into a sealed combat room: their
     * partner's position is tried first, then tile centres ordered by
     * distance. `room` keeps every candidate inside the sealed room, and
     * `occupied` stops two teleported bodies from stacking on each other.
     */
    findFreeSpotNear(x, y, radius = 14, occupied = [], maxRadius = 800, room = null) {
        const fits = (px, py) => {
            if (room && this.pointInRoom(px, py) !== room) return false;
            if (!this.canOccupy(px, py, radius)) return false;
            return !occupied.some(body => {
                const otherRadius = body.radius || radius;
                return Math.hypot(px - body.x, py - body.y) < radius + otherRadius + 2;
            });
        };
        if (fits(x, y)) return { x, y };
        const ts = this.tileSize;
        const cx = Math.floor(x / ts), cy = Math.floor(y / ts);
        const span = Math.ceil(maxRadius / ts);
        const candidates = [];
        for (let dy = -span; dy <= span; dy++) {
            for (let dx = -span; dx <= span; dx++) {
                if (!dx && !dy) continue;
                const px = (cx + dx + 0.5) * ts;
                const py = (cy + dy + 0.5) * ts;
                const distance = Math.hypot(px - x, py - y);
                if (distance <= maxRadius) candidates.push({ px, py, distance });
            }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        for (const candidate of candidates) {
            if (fits(candidate.px, candidate.py)) return { x: candidate.px, y: candidate.py };
        }
        return null;
    }

    /**
     * Get enemies for a given room.
     * @param {Object} room
     * @param {Object|null} avoid - point to keep spawns away from (the player)
     * @param {number} minDist - how far away to keep them
     */
    getEnemiesForRoom(room, avoid = null, minDist = 280, floor = 1) {
        const enemies = [];
        const spawn = () => this.spawnPointInRoom(room, avoid, minDist);
        // Past the ramp, rooms get steadily busier as well as tougher.
        const extra = Math.floor(endgameFloors(floor) / ENDGAME.countEvery);

        switch (room.type) {
            case 'entry':
            case 'start': // compatibility with the isolated test room
            case 'hub':
                // Entry and hubs are safe rooms.
                break;

            case 'combat':
                // Try to spawn cochinilla_esquinero if valid corner exists (higher chance for testing)
                {
                    const isLarge = (room.tw >= 20 || room.th >= 20);
                    const maxCorners = isLarge ? 2 : 1;
                    const cornerList = this.findCornerCochinillaList(room, maxCorners);
                    if (cornerList.length && Math.random() < 0.8) {
                        for (const c of cornerList) {
                            enemies.push(createEnemy('cochinilla-esquinero', c.x, c.y, room, c.corner));
                        }
                    } else if (cornerList.length) {
                        // still try to spawn at least one sometimes
                        if (Math.random() < 0.5) {
                            enemies.push(createEnemy('cochinilla-esquinero', cornerList[0].x, cornerList[0].y, room, cornerList[0].corner));
                        }
                    }
                }
                const count = 2 + Math.floor(Math.random() * 3) + extra; // 2-4 (+endgame)
                for (let i = 0; i < count; i++) {
                    const p = spawn();
                    enemies.push(createEnemy(randomEnemyType(), p.x, p.y));
                }
                break;

            case 'combat-hard':
                // 100% chance in combat-hard if valid corner exists
                {
                    const isLarge = (room.tw >= 20 || room.th >= 20);
                    const maxCorners = isLarge ? 2 : 1;
                    const cornerList = this.findCornerCochinillaList(room, maxCorners);
                    if (cornerList.length) {
                        for (const c of cornerList) {
                            enemies.push(createEnemy('cochinilla-esquinero', c.x, c.y, room, c.corner));
                        }
                    }
                }
                const hCount = 4 + Math.floor(Math.random() * 3) + extra; // 4-6 (+endgame)
                for (let i = 0; i < hCount; i++) {
                    const p = spawn();
                    enemies.push(createEnemy(hardEnemyType(), p.x, p.y));
                }
                break;

            case 'treasure':
                // No enemies, but give bonus XP
                break;

            case 'boss':
                const bossSpawn = this.findBossSpawn(room, avoid, minDist);
                const boss = createEnemy('boss', bossSpawn.x, bossSpawn.y);
                boss.room = room; // keeps the drift inside its authored hall
                enemies.push(boss);
                // Minions, growing with depth
                for (let i = 0; i < 2 + extra; i++) {
                    const p = spawn();
                    enemies.push(createEnemy(randomEnemyType(), p.x, p.y));
                }
                break;

            case 'empty':
                // No enemies
                break;

            case 'exit':
                // No enemies in exit room
                break;
        }

        return enemies;
    }

    /**
     * Find a valid corner for the corner cochinilla.
     *
     * The authored spawn block is exactly the 3x3 floor square that starts one
     * cell inside the corner of the template, i.e. cells (1,1)-(3,3) of that
     * corner quadrant. That is the green block of
     * cochinilla_esquinero_generacion en salas.aseprite and the magenta block
     * ("punto de aparición") of cochinilla_esquinero_ejemplo punto de
     * spawn.aseprite and of the four corner variants.
     *
     * All nine cells must be plain floor (mask === 1). Doorway cells
     * (mask === 2) never qualify: a corner broken by a door is not an interior
     * corner any more.
     */
    findCornerCochinilla(room) {
        const list = this.findCornerCochinillaList(room, 1);
        return list[0] || null;
    }

    findCornerCochinillaList(room, maxCount = 1) {
        if (!room || !room.template || !room.template.mask) return [];
        const ts = this.tileSize;
        const tw = room.tw, th = room.th;
        const mask = room.template.mask;
        if (tw < 4 || th < 4) return [];
        const corners = [
            { name: 'top-left', bx: 1, by: 1 },
            { name: 'top-right', bx: tw - 4, by: 1 },
            { name: 'bottom-left', bx: 1, by: th - 4 },
            { name: 'bottom-right', bx: tw - 4, by: th - 4 }
        ];
        const results = [];
        for (const corner of corners) {
            if (results.length >= maxCount) break;
            let ok = true;
            // The whole 3x3 block, doors included, must be walkable floor.
            for (let y = 0; y < 3 && ok; y++) {
                for (let x = 0; x < 3; x++) {
                    const cellX = corner.bx + x;
                    const cellY = corner.by + y;
                    if (cellX < 0 || cellY < 0 || cellX >= tw || cellY >= th) { ok = false; break; }
                    if (mask[cellY * tw + cellX] !== 1) { ok = false; break; }
                }
            }
            if (!ok) continue;
            // Anchor = centre of that block: 2.5 cells from the corner, the
            // point the 120x120 body is centred on in the art files.
            const px = room.x + (corner.bx + 1.5) * ts;
            const py = room.y + (corner.by + 1.5) * ts;
            results.push({ x: px, y: py, corner: corner.name, blockX: corner.bx, blockY: corner.by });
        }
        return results;
    }

    /** Get treasure rewards for a room. */
    getTreasureForRoom(room) {
        if (room.type === 'treasure') {
            return {
                heal: 30,
                xp: 30
            };
        }
        return null;
    }

    /** True only on floor or a doorway cell from the authored collision mask. */
    isWalkable(x, y) {
        // Locked combat rooms close their authored doors with a thin plane;
        // the surrounding floor stays valid so nobody gets stuck in a wall.
        for (const rect of this.doorBlockers) {
            if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return false;
        }
        for (const room of this.rooms) {
            if (x < room.x || x > room.x + room.w || y < room.y || y > room.y + room.h) continue;
            if (!room.template) return true;
            const cellX = Math.floor((x - room.x) / this.tileSize);
            const cellY = Math.floor((y - room.y) / this.tileSize);
            if (cellX < 0 || cellY < 0 || cellX >= room.tw || cellY >= room.th) continue;
            const cell = room.template.mask[cellY * room.tw + cellX];
            if (cell === 1 || cell === 2) return true;
        }
        for (const rect of this.corridorRects || []) {
            if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return true;
        }
        return false;
    }

    /** Check a circular entity against the mask on its centre and four sides. */
    canOccupy(x, y, radius) {
        return this.isWalkable(x, y) && this.isWalkable(x - radius, y) && this.isWalkable(x + radius, y) &&
            this.isWalkable(x, y - radius) && this.isWalkable(x, y + radius);
    }

    /**
     * True when a circle can travel from A to B in a straight line without
     * touching a solid cell.
     *
     * Samples finer than a tile so a thin red wall cannot slip between two
     * checks. Used both for direct pursuit and to smooth A* waypoints.
     */
    hasLineOfSight(x1, y1, x2, y2, radius = 12) {
        const dx = x2 - x1, dy = y2 - y1;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.001) return this.canOccupy(x1, y1, radius);
        const step = Math.max(6, this.tileSize * 0.25);
        const samples = Math.ceil(distance / step);
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            if (!this.canOccupy(x1 + dx * t, y1 + dy * t, radius)) return false;
        }
        return true;
    }

    /**
     * A* route across the authored 40px tile grid, for enemies that must go
     * around red walls instead of pushing into them.
     *
     * Eight-directional, without cutting corners, then greedily smoothed with
     * line-of-sight checks. Returns world-space waypoints from the first corner
     * to the target, or null when no route exists within maxExpansions.
     *
     * The map is much larger than a room, so the search is bounded and cells
     * are tested lazily: only touched cells pay for a canOccupy call.
     */
    findPath(startX, startY, targetX, targetY, radius = 12, maxExpansions = 4000) {
        const ts = this.tileSize;
        const cols = Math.max(1, Math.ceil(this.width / ts));
        const rows = Math.max(1, Math.ceil(this.height / ts));
        const clampCell = (value, size) => Math.max(0, Math.min(size - 1, Math.floor(value / ts)));
        let startCX = clampCell(startX, cols), startCY = clampCell(startY, rows);
        let goalCX = clampCell(targetX, cols), goalCY = clampCell(targetY, rows);
        const keyOf = (cx, cy) => cy * cols + cx;
        const centerOf = (cx, cy) => ({ x: (cx + 0.5) * ts, y: (cy + 0.5) * ts });

        const walkCache = new Map();
        const walkable = (cx, cy) => {
            if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
            const key = keyOf(cx, cy);
            let value = walkCache.get(key);
            if (value === undefined) {
                const point = centerOf(cx, cy);
                value = this.canOccupy(point.x, point.y, radius);
                walkCache.set(key, value);
            }
            return value;
        };
        const nearestWalkable = (cx, cy) => {
            for (let ring = 1; ring <= 3; ring++) {
                for (let oy = -ring; oy <= ring; oy++) {
                    for (let ox = -ring; ox <= ring; ox++) {
                        if (Math.abs(ox) !== ring && Math.abs(oy) !== ring) continue;
                        if (walkable(cx + ox, cy + oy)) return { cx: cx + ox, cy: cy + oy };
                    }
                }
            }
            return null;
        };

        // A straight shot is already the best route.
        if (this.hasLineOfSight(startX, startY, targetX, targetY, radius)) {
            return [{ x: targetX, y: targetY }];
        }

        if (!walkable(startCX, startCY)) {
            const free = nearestWalkable(startCX, startCY);
            if (!free) return null;
            startCX = free.cx; startCY = free.cy;
        }
        if (!walkable(goalCX, goalCY)) {
            // Aim at the closest free cell so a player hugging a wall still
            // gives the enemy a usable destination.
            const free = nearestWalkable(goalCX, goalCY);
            if (!free) return null;
            goalCX = free.cx; goalCY = free.cy;
        }

        const startKey = keyOf(startCX, startCY);
        const goalKey = keyOf(goalCX, goalCY);
        const gScore = new Map([[startKey, 0]]);
        const cameFrom = new Map();
        const closed = new Set();
        const open = new PathMinHeap();
        const diagonal = ts * Math.SQRT2;
        const heuristic = (cx, cy) => {
            const dx = Math.abs(cx - goalCX), dy = Math.abs(cy - goalCY);
            return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
        };

        open.push(startCX, startCY, heuristic(startCX, startCY) * ts);
        let expansions = 0;

        while (open.size && expansions < maxExpansions) {
            const node = open.pop();
            const nodeKey = keyOf(node.cx, node.cy);
            const nodeG = gScore.get(nodeKey);
            if (nodeG === undefined || closed.has(nodeKey)) continue;
            const expected = nodeG + heuristic(node.cx, node.cy) * ts;
            if (node.score > expected + 0.001) continue; // stale heap entry
            closed.add(nodeKey);
            expansions++;

            if (nodeKey === goalKey) {
                const cells = [];
                let current = goalKey;
                while (current !== undefined) {
                    cells.push({ cx: current % cols, cy: Math.floor(current / cols) });
                    if (current === startKey) break;
                    current = cameFrom.get(current);
                }
                cells.reverse();

                const points = cells.map(cell => centerOf(cell.cx, cell.cy));
                if (this.hasLineOfSight(points[points.length - 1].x, points[points.length - 1].y, targetX, targetY, radius)) {
                    points.push({ x: targetX, y: targetY });
                }

                // Greedy smoothing: keep only the farthest point still visible
                // from the previous anchor, so movement hugs corners instead of
                // zig-zagging between tile centres.
                const smoothed = [];
                let anchorX = startX, anchorY = startY;
                for (let i = 0; i < points.length;) {
                    let farthest = -1;
                    for (let j = points.length - 1; j >= i; j--) {
                        if (this.hasLineOfSight(anchorX, anchorY, points[j].x, points[j].y, radius)) {
                            farthest = j;
                            break;
                        }
                    }
                    if (farthest < 0) { farthest = i; }
                    const chosen = points[farthest];
                    smoothed.push(chosen);
                    anchorX = chosen.x; anchorY = chosen.y;
                    i = farthest + 1;
                }
                return smoothed;
            }

            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (ox === 0 && oy === 0) continue;
                    const nx = node.cx + ox, ny = node.cy + oy;
                    const isDiagonal = ox !== 0 && oy !== 0;
                    if (!walkable(nx, ny)) continue;
                    // Never squeeze diagonally between two solid corners.
                    if (isDiagonal && (!walkable(node.cx + ox, node.cy) || !walkable(node.cx, node.cy + oy))) continue;
                    const nextKey = keyOf(nx, ny);
                    if (closed.has(nextKey)) continue;
                    const cost = isDiagonal ? diagonal : ts;
                    const tentative = nodeG + cost;
                    const previous = gScore.get(nextKey);
                    if (previous !== undefined && tentative >= previous) continue;
                    gScore.set(nextKey, tentative);
                    cameFrom.set(nextKey, nodeKey);
                    open.push(nx, ny, tentative + heuristic(nx, ny) * ts);
                }
            }
        }
        return null;
    }

    /** Return only a room whose actual tile under the point is traversable. */
    pointInRoom(px, py) {
        for (const room of this.rooms) {
            if (px < room.x || px > room.x + room.w || py < room.y || py > room.y + room.h) continue;
            if (!room.template) return room;
            const cellX = Math.floor((px - room.x) / this.tileSize), cellY = Math.floor((py - room.y) / this.tileSize);
            if (cellX < 0 || cellY < 0 || cellX >= room.tw || cellY >= room.th) continue;
            const cell = room.template.mask[cellY * room.tw + cellX];
            if (cell === 1 || cell === 2) return room;
        }
        return null;
    }


    /** Get the room a point is currently in. */
    getCurrentRoom(px, py) {
        return this.pointInRoom(px, py);
    }

    /** Mark a room as cleared and release its doors. */
    clearRoom(room) {
        room.lockPending = false;
        if (room.locked) this.unlockRoom(room);
        if (!room.cleared) {
            room.cleared = true;
            this.roomsCleared++;
        }
    }

    /** The collision planes this room would use if its doors closed. */
    doorBarriersFor(room) {
        const barriers = [];
        for (const edge of this.corridors) {
            const owner = edge.a === room ? edge.a : edge.b === room ? edge.b : null;
            if (!owner) continue;
            const doorIndex = owner === edge.a ? edge.doorA : edge.doorB;
            const door = owner.template?.doors?.[doorIndex];
            if (door) barriers.push(doorBarrierRect(owner, door));
        }
        return barriers;
    }

    /** Rebuild the active collision planes from every locked room. */
    refreshDoorBlockers() {
        this.doorBlockers = [];
        for (const edge of this.corridors) {
            if (!edge.a.locked && !edge.b.locked) continue;
            const owner = edge.a.locked ? edge.a : edge.b;
            const doorIndex = owner === edge.a ? edge.doorA : edge.doorB;
            const door = owner.template?.doors?.[doorIndex];
            if (door) this.doorBlockers.push(doorBarrierRect(owner, door));
        }
    }

    lockRoom(room) {
        if (room.locked) return;
        room.locked = true;
        room.lockPending = false;
        this.refreshDoorBlockers();
    }

    unlockRoom(room) {
        if (!room.locked) return;
        room.locked = false;
        this.refreshDoorBlockers();
    }

    /**
     * Close a room only once a player is genuinely inside and no body is
     * straddling one of its door planes. Locking on the threshold would trap
     * the player in the door cell, so the caller retries every frame.
     */
    canLockRoom(room, players, blockers = []) {
        if (room.locked || room.cleared) return false;
        if (!players.some(player => this.pointInRoom(player.x, player.y) === room)) return false;
        const bodies = [...players, ...blockers];
        return this.doorBarriersFor(room).every(rect =>
            !bodies.some(body => circleOverlapsRect(body.x, body.y, body.radius || 14, rect)));
    }

    /**
     * Fill a floor rectangle: base colour plus a checkerboard of lighter tiles.
     *
     * The checkerboard phase comes from GLOBAL tile coordinates, not from the
     * rectangle's own origin. That is what lets rooms and corridors be filled
     * independently and still seam together invisibly — which matters because
     * corridors run centre-to-centre and therefore cross room interiors. Give
     * them their own colour and every room gets a stripe painted across it.
     */
    fillFloor(ctx, x, y, w, h, clip) {
        const ts = this.tileSize;
        const x0 = Math.max(x, clip.left), y0 = Math.max(y, clip.top);
        const x1 = Math.min(x + w, clip.right), y1 = Math.min(y + h, clip.bottom);
        if (x1 <= x0 || y1 <= y0) return;

        ctx.fillStyle = PALETTE.floorDark;
        ctx.fillRect(snap(x0), snap(y0), snap(x1 - x0), snap(y1 - y0));

        ctx.fillStyle = PALETTE.floorLight;
        const tx0 = Math.floor(x0 / ts), ty0 = Math.floor(y0 / ts);
        const tx1 = Math.ceil(x1 / ts), ty1 = Math.ceil(y1 / ts);
        for (let ty = ty0; ty < ty1; ty++) {
            for (let tx = tx0; tx < tx1; tx++) {
                if ((tx + ty) % 2 !== 0) continue;
                const px = Math.max(tx * ts, x0), py = Math.max(ty * ts, y0);
                const pw = Math.min((tx + 1) * ts, x1) - px;
                const ph = Math.min((ty + 1) * ts, y1) - py;
                if (pw > 0 && ph > 0) ctx.fillRect(snap(px), snap(py), snap(pw), snap(ph));
            }
        }
    }

    /** Render rooms from their mask while keeping the game's existing palette. */
    draw(ctx, camera, viewW, viewH) {
        const ts = this.tileSize;
        const clip = { left: camera.x - ts, right: camera.x + viewW + ts,
            top: camera.y - ts, bottom: camera.y + viewH + ts };
        const visible = (x, y, w, h) => !(x > clip.right || x + w < clip.left || y > clip.bottom || y + h < clip.top);

        // Legacy fallback rooms retain the original rectangular presentation.
        for (const room of this.rooms) {
            if (room.template || !visible(room.x - 8, room.y - 8, room.w + 16, room.h + 16)) continue;
            pixelFrame(ctx, room.x - 8, room.y - 8, room.w + 16, room.h + 16, 8, PALETTE.wall);
            pixelFrame(ctx, room.x - 2, room.y - 2, room.w + 4, room.h + 4, 2, PALETTE.wallLit);
        }

        for (const room of this.rooms) {
            if (!visible(room.x, room.y, room.w, room.h)) continue;
            if (!room.template) {
                this.fillFloor(ctx, room.x, room.y, room.w, room.h, clip);
                ctx.fillStyle = PALETTE.floorGrime;
                ctx.fillRect(snap(room.x), snap(room.y), snap(room.w), 3);
                ctx.fillRect(snap(room.x), snap(room.y + room.h - 3), snap(room.w), 3);
                continue;
            }
            const template = room.template;
            const isOpen = (x, y) => x >= 0 && y >= 0 && x < room.tw && y < room.th
                && (template.mask[y * room.tw + x] === 1 || template.mask[y * room.tw + x] === 2);
            for (let y = 0; y < room.th; y++) for (let x = 0; x < room.tw; x++) {
                const cell = template.mask[y * room.tw + x];
                const px = room.x + x * ts, py = room.y + y * ts;
                if (!visible(px, py, ts, ts)) continue;
                if (cell === 1 || cell === 2) {
                    this.fillFloor(ctx, px, py, ts, ts, clip);
                } else {
                    // Authored walls (0) and blue obstacles (3) are both empty
                    // background; only their trim is visible where they meet
                    // floor or a doorway, so red-bordered room limits and blue
                    // obstacles read as void instead of solid brown masses.
                    ctx.fillStyle = PALETTE.void; ctx.fillRect(snap(px), snap(py), ts, ts);
                    ctx.fillStyle = PALETTE.wallLit;
                    if (isOpen(x, y + 1)) ctx.fillRect(snap(px), snap(py + ts - 3), ts, 3);
                    if (isOpen(x, y - 1)) ctx.fillRect(snap(px), snap(py), ts, 3);
                    if (isOpen(x + 1, y)) ctx.fillRect(snap(px + ts - 3), snap(py), 3, ts);
                    if (isOpen(x - 1, y)) ctx.fillRect(snap(px), snap(py), 3, ts);
                }
            }
        }

        // Only legacy maps have artificial corridors. Authored rooms meet at
        // their exact yellow door cells, so drawing corridor rectangles there
        // would create a second, misleading route through walls.
        for (const rect of this.corridorRects || []) {
            if (visible(rect.x, rect.y, rect.w, rect.h)) this.fillFloor(ctx, rect.x, rect.y, rect.w, rect.h, clip);
        }

        // Solid door planes for combat rooms that have not been cleared yet.
        for (const rect of this.doorBlockers) {
            if (!visible(rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8)) continue;
            ctx.fillStyle = PALETTE.wall;
            ctx.fillRect(snap(rect.x), snap(rect.y), Math.max(2, snap(rect.w)), Math.max(2, snap(rect.h)));
            ctx.fillStyle = PALETTE.danger;
            if (rect.w < rect.h) {
                for (let y = rect.y + 4; y < rect.y + rect.h - 2; y += 12) {
                    ctx.fillRect(snap(rect.x - 2), snap(y), snap(rect.w + 4), 4);
                }
            } else {
                for (let x = rect.x + 4; x < rect.x + rect.w - 2; x += 12) {
                    ctx.fillRect(snap(x), snap(rect.y - 2), 4, snap(rect.h + 4));
                }
            }
        }

        if (this.exit) {
            const exit = this.exit;
            pixelRect(ctx, exit.x, exit.y, 54, 30, PALETTE.exit);
            pixelRect(ctx, exit.x, exit.y, 44, 20, '#0d2a12');
            pixelRect(ctx, exit.x, exit.y, 10, 14, PALETTE.exit);
        }

        if (this.bossRoom && !this.exit) {
            const room = this.bossRoom;
            const point = room.markerPoint || { x: room.cx, y: room.cy };
            pixelFrame(ctx, point.x - 26, point.y - 26, 52, 52, 3, PALETTE.blood);
            pixelRect(ctx, point.x, point.y, 16, 16, PALETTE.danger);
        }

        // Treasure chests: a warm gold landmark in an otherwise dark floor.
        for (const room of this.rooms) {
            if (room.type !== 'treasure' || !room.treasurePoint) continue;
            const point = room.treasurePoint;
            if (!visible(point.x - 24, point.y - 20, 48, 40)) continue;
            pixelFrame(ctx, point.x - 19, point.y - 14, 38, 28, 4, PALETTE.hudDim);
            pixelRect(ctx, point.x, point.y + 2, 28, 18, '#8a5a1a');
            pixelRect(ctx, point.x, point.y - 5, 30, 9, PALETTE.hud);
            pixelRect(ctx, point.x, point.y + 3, 6, 6, PALETTE.hudDim);
        }

        if (this.playerStart) pixelFrame(ctx, this.playerStart.x - 18, this.playerStart.y - 18, 36, 36, 2, PALETTE.hudDim);

        if (this.debugLayout) {
            ctx.save();
            ctx.lineWidth = 2;
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            for (const edge of this.corridors) {
                ctx.strokeStyle = '#ffdf54'; ctx.beginPath(); ctx.moveTo(edge.a.cx, edge.a.cy); ctx.lineTo(edge.b.cx, edge.b.cy); ctx.stroke();
            }
            for (const room of this.rooms) {
                pixelFrame(ctx, room.x, room.y, room.w, room.h, 2, '#fff36b');
                ctx.fillStyle = '#fff36b'; ctx.fillText(`${room.id} · ${room.type}`, room.cx, room.cy - 28);
                for (const door of room.template?.doors || []) {
                    for (let step = 0; step < door.length; step++) {
                        let x, y;
                        if (door.side === 'N') { x = door.offset + step; y = 0; }
                        else if (door.side === 'S') { x = door.offset + step; y = room.th - 1; }
                        else if (door.side === 'W') { x = 0; y = door.offset + step; }
                        else { x = room.tw - 1; y = door.offset + step; }
                        ctx.strokeStyle = '#ff42ef'; ctx.strokeRect(room.x + x * ts + 5, room.y + y * ts + 5, ts - 10, ts - 10);
                    }
                }
            }
            ctx.restore();
        }
    }

    /**
     * Get corridor segments (L-shaped: horizontal at y1, then vertical at x2).
     *
     * Each segment is a rectangle of real width. Previously these were returned
     * with zero thickness, so the fillRect() in draw() painted nothing and
     * corridors showed up as hairlines. Both segments are extended by a half
     * width at their ends so the elbow joins cleanly instead of notching.
     */
    corridorSegments(corr, width = this.corridorWidth) {
        const h = width / 2;
        return [
            {   // horizontal run
                x1: Math.min(corr.x1, corr.x2) - h,
                y1: corr.y1 - h,
                x2: Math.max(corr.x1, corr.x2) + h,
                y2: corr.y1 + h
            },
            {   // vertical run
                x1: corr.x2 - h,
                y1: Math.min(corr.y1, corr.y2) - h,
                x2: corr.x2 + h,
                y2: Math.max(corr.y1, corr.y2) + h
            }
        ];
    }
}
