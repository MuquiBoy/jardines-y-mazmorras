/**
 * Level-up upgrades shared by the offline game and the authoritative server.
 *
 * Keeping one list avoids the two modes drifting apart: the client shows these
 * cards, and the server validates the chosen id before changing the player's
 * stats. `apply` receives the Player instance owned by either side.
 */
const UPGRADE_DEFS = Object.freeze([
    { id: 'vitality', name: 'Vitality', description: '+20 Max Health, heal permanent health to full', apply: (p) => { p.maxHealth += 20; p.health = p.maxHealth + (p.grayHealth || 0); } },
    { id: 'power', name: 'Power', description: '+5 Damage', apply: (p) => { p.damage += 5; } },
    { id: 'swiftness', name: 'Swiftness', description: '+0.25 Speed', apply: (p) => { p.speed += 0.25; } },
    { id: 'multi-shot', name: 'Multi-Shot', description: '+1 Bullet Count (max 7)', apply: (p) => { if (p.bulletCount < 7) p.bulletCount++; } },
    { id: 'pierce', name: 'Pierce', description: '+1 Bullet Pierce', apply: (p) => { p.bulletPierce++; } },
    { id: 'rapid-fire', name: 'Rapid Fire', description: '+10% Fire Rate', apply: (p) => { p.fireRate = Math.max(4, Math.floor(p.fireRate * 0.9)); } },
    { id: 'bullet-speed', name: 'Bullet Speed', description: '+1 Bullet Speed', apply: (p) => { p.bulletSpeed += 1; } },
    { id: 'magnet', name: 'Magnet', description: '+15 Magnet Range', apply: (p) => { p.magnetRange += 15; } },
    { id: 'full-heal', name: 'Full Heal', description: 'Restore permanent health; gray hearts do not return', apply: (p) => { p.heal(p.maxHealth); } },
    { id: 'power-surge', name: 'Power Surge', description: '+30% Damage (Rare)', apply: (p) => { p.damage = Math.floor(p.damage * 1.3); }, rarity: 'rare' }
]);

