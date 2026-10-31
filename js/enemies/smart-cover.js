/* Shared cover geometry for enemies that opt into Búsqueda de cobertura inteligente. */
const SmartCover = {
    /**
     * Pick a reachable floor point just behind a blue obstacle. The body sits
     * one radius plus a 10 px gap beyond that obstacle's rear face, and every
     * candidate is checked against the authored room collision mask.
     */
    findCoverPoint(enemy, threat, map, room = null) {
        if (!threat || !map?.pointInRoom || !map?.canOccupy || !map?.hasLineOfSight) return null;
        room = room || map.pointInRoom(enemy.x, enemy.y);
        const template = room?.template;
        if (!room || !template?.mask || !room.tw || !room.th) return null;

        const tileSize = map.tileSize || 40;
        const crossesBlueObstacle = (x1, y1, x2, y2) => {
            const distance = Math.hypot(x2 - x1, y2 - y1);
            const steps = Math.max(1, Math.ceil(distance / (tileSize * 0.2)));
            for (let step = 1; step < steps; step++) {
                const t = step / steps;
                const cellX = Math.floor((x1 + (x2 - x1) * t - room.x) / tileSize);
                const cellY = Math.floor((y1 + (y2 - y1) * t - room.y) / tileSize);
                if (cellX < 0 || cellY < 0 || cellX >= room.tw || cellY >= room.th) continue;
                if (template.mask[cellY * room.tw + cellX] === 3) return true;
            }
            return false;
        };
        // Do not walk away from a useful shelter: if a blue obstacle already
        // blocks the player's line to this position, it is the best cover.
        if (!map.hasLineOfSight(threat.x, threat.y, enemy.x, enemy.y, enemy.radius) &&
            crossesBlueObstacle(threat.x, threat.y, enemy.x, enemy.y)) {
            return { x: enemy.x, y: enemy.y, room, score: 0 };
        }
        const offset = tileSize / 2 + enemy.radius + 10;
        const maxCoverTravel = tileSize * 4;
        const directions = [
            { x: 1, y: 0 }, { x: -1, y: 0 },
            { x: 0, y: 1 }, { x: 0, y: -1 }
        ];
        const candidates = [];
        const seen = new Set();

        for (let cellY = 0; cellY < room.th; cellY++) {
            for (let cellX = 0; cellX < room.tw; cellX++) {
                if (template.mask[cellY * room.tw + cellX] !== 3) continue;

                const obstacleX = room.x + (cellX + 0.5) * tileSize;
                const obstacleY = room.y + (cellY + 0.5) * tileSize;
                const awayX = obstacleX - threat.x;
                const awayY = obstacleY - threat.y;
                const awayLength = Math.hypot(awayX, awayY) || 1;

                for (const direction of directions) {
                    const alignment = (direction.x * awayX + direction.y * awayY) / awayLength;
                    // The obstacle must lie between the threat and the cover
                    // point, rather than merely being somewhere nearby.
                    if (alignment < 0.45) continue;

                    const point = {
                        x: obstacleX + direction.x * offset,
                        y: obstacleY + direction.y * offset
                    };
                    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (map.pointInRoom(point.x, point.y) !== room ||
                        !map.canOccupy(point.x, point.y, enemy.radius)) continue;

                    const distance = Math.hypot(point.x - enemy.x, point.y - enemy.y);
                    if (distance > maxCoverTravel ||
                        map.hasLineOfSight(threat.x, threat.y, point.x, point.y, enemy.radius) ||
                        !crossesBlueObstacle(threat.x, threat.y, point.x, point.y)) continue;
                    candidates.push({
                        ...point,
                        room,
                        score: distance + (1 - alignment) * tileSize * 0.5
                    });
                }
            }
        }

        candidates.sort((a, b) => a.score - b.score);
        // Bound line-of-sight work in rooms with many authored obstacles.
        for (const candidate of candidates.slice(0, 12)) {
            return candidate;
        }
        return null;
    },

    /**
     * Choose a short, reachable firing lane close to shelter. The enemy only
     * exposes itself long enough to take its scheduled shot, then returns to
     * cover; if no lane exists it keeps its position and cadence.
     */
    findAttackPoint(enemy, threat, map, room, coverPoint) {
        const cells = room?.template?.walkableCells;
        if (!threat || !map?.canOccupy || !map?.hasLineOfSight || !cells?.length || !coverPoint) return null;
        const tileSize = map.tileSize || 40;
        const maxPeekDistance = Math.hypot(room.w, room.h);
        const candidates = [];
        for (const cell of cells) {
            const point = {
                x: room.x + (cell.x + 0.5) * tileSize,
                y: room.y + (cell.y + 0.5) * tileSize
            };
            const coverDistance = Math.hypot(point.x - coverPoint.x, point.y - coverPoint.y);
            if (coverDistance < tileSize * 0.75 || coverDistance > maxPeekDistance) continue;
            if (map.pointInRoom(point.x, point.y) !== room || !map.canOccupy(point.x, point.y, enemy.radius)) continue;
            candidates.push({
                ...point,
                score: coverDistance + Math.abs(Math.hypot(point.x - threat.x, point.y - threat.y) - 240) * 0.08
            });
        }
        candidates.sort((a, b) => a.score - b.score);
        for (const candidate of candidates.slice(0, 256)) {
            if (map.hasLineOfSight(threat.x, threat.y, candidate.x, candidate.y, enemy.radius)) return candidate;
        }
        return null;
    }
};
