/* Roles separados del motor base para balancearlos sin editar Player. */
class CharacterRole {
    constructor({ id, name, description, health, speed, damage, fireRate, bulletCount, bulletPierce }) {
        Object.assign(this, { id, name, description, health, speed, damage, fireRate, bulletCount, bulletPierce });
    }

    apply(player) {
        player.character = this.id;
        player.maxHealth = player.health = this.health;
        player.speed = this.speed;
        player.damage = this.damage;
        player.fireRate = this.fireRate;
        player.bulletCount = this.bulletCount;
        player.bulletPierce = this.bulletPierce;
    }
}

const CHARACTER_ROLES = Object.freeze({
    aji: new CharacterRole({ id: 'aji', name: 'Piromano Ají', description: 'Daño elevado; salud y cadencia equilibradas.', health: 90, speed: 4.5, damage: 13, fireRate: 12, bulletCount: 1, bulletPierce: 0 }),
    invocador: new CharacterRole({ id: 'invocador', name: 'Invocador', description: 'Dispara dos proyectiles para cubrir más espacio.', health: 85, speed: 4.4, damage: 8, fireRate: 15, bulletCount: 2, bulletPierce: 0 }),
    carguero: new CharacterRole({ id: 'carguero', name: 'Carguero', description: 'Más resistente, con menor velocidad.', health: 140, speed: 3.8, damage: 10, fireRate: 14, bulletCount: 1, bulletPierce: 0 }),
    gunslinger: new CharacterRole({ id: 'gunslinger', name: 'Pistolero', description: 'Alta cadencia y daño moderado.', health: 90, speed: 4.8, damage: 8, fireRate: 7, bulletCount: 1, bulletPierce: 0 })
});
