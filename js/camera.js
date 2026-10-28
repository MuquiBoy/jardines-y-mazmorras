/**
 * Select one shared, stable spectating target for the party on the server.
 * All downed viewers receive the same target id in each authoritative snapshot.
 */
function selectPartySpectatorTargetId(players, currentTargetId, random = Math.random) {
    const members = [...players].filter(Boolean);
    if (!members.some(player => player.health <= 0)) return null;

    const living = members
        .filter(player => player.health > 0)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (living.length === 0) return null;
    if (living.some(player => player.id === currentTargetId)) return currentTargetId;

    const sample = Number(random());
    const normalized = Number.isFinite(sample) ? Math.min(0.999999999, Math.max(0, sample)) : 0;
    return living[Math.floor(normalized * living.length)].id;
}

/**
 * Resolve the camera focus for one co-op client.
 * Healthy viewers follow themselves. A downed viewer spectates the shared
 * living teammate, keeping that choice until the target dies or they revive.
 */
function resolveSpectatorCameraTarget(viewer, players, currentTargetId, random = Math.random) {
    if (!viewer) return { target: null, targetId: null, spectating: false };
    if (viewer.health > 0) return { target: viewer, targetId: null, spectating: false };

    const targetId = selectPartySpectatorTargetId(players, currentTargetId, random);
    const target = [...players].find(player => player && player.id === targetId) || null;
    return { target, targetId, spectating: true };
}
