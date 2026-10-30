/**
 * Fixed presentation pool shared by impact, transformation and enemy-death
 * bursts. Nothing is allocated when an effect starts during combat.
 */
class ParticlePool {
    static CAPACITY = 256;

    constructor(capacity = ParticlePool.CAPACITY) {
        this.capacity = Math.max(1, Math.floor(capacity));
        this.active = [];
        this.free = [];
        this.skipped = 0;
        this.recycledForDeath = 0;
        this.recycleCursor = 0;
        for (let i = 0; i < this.capacity; i++) {
            this.free.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0,
                maxLife: 35, color: '#ffffff', radius: 0, kind: 'normal' });
        }
    }

    clear() {
        for (const particle of this.active) this.free.push(particle);
        this.active.length = 0;
        this.recycleCursor = 0;
    }

    spawn(x, y, color, count, kind = 'normal') {
        const wanted = Math.max(0, Math.floor(count));
        let spawned = 0;
        for (let i = 0; i < wanted; i++) {
            let particle = this.free.pop();
            if (!particle) {
                if (kind !== 'death') {
                    this.skipped += wanted - i;
                    break;
                }
                // Keep deaths visible at capacity. Prefer replacing an impact;
                // otherwise replace a different old particle on each request.
                let index = this.active.findIndex(entry => entry.kind !== 'death');
                if (index < 0) index = this.recycleCursor++ % this.active.length;
                particle = this.active[index];
                this.recycledForDeath++;
            } else {
                this.active.push(particle);
            }
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            particle.x = x;
            particle.y = y;
            particle.vx = Math.cos(angle) * speed;
            particle.vy = Math.sin(angle) * speed;
            particle.life = 20 + Math.random() * 15;
            particle.maxLife = 35;
            particle.color = color;
            particle.radius = 2 + Math.random() * 3;
            particle.kind = kind;
            spawned++;
        }
        return spawned;
    }

    /** Advance at the game's 60 Hz tick rate, regardless of display refresh. */
    update(ticks = 1) {
        if (!(ticks > 0)) return;
        let live = 0;
        const shrink = Math.pow(0.95, ticks);
        for (let i = 0; i < this.active.length; i++) {
            const particle = this.active[i];
            particle.x += particle.vx * ticks;
            particle.y += particle.vy * ticks;
            particle.life -= ticks;
            particle.radius *= shrink;
            if (particle.life > 0) this.active[live++] = particle;
            else this.free.push(particle);
        }
        this.active.length = live;
    }

    getStats() {
        return { capacity: this.capacity, active: this.active.length,
            free: this.free.length, skipped: this.skipped,
            recycledForDeath: this.recycledForDeath };
    }
}
