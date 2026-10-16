"use strict";
/**
 * @file game.ts
 * @brief Survivor-like (estilo Vampire Survivors) con POO en TypeScript.
 *
 * Mantiene la idea de composición del ejemplo en C++: el Player se compone
 * de Weapon[] y un Skill. A diferencia de C++, en TypeScript los objetos se
 * guardan por referencia, lo que permite polimorfismo sin punteros.
 *
 * Versión mejorada:
 *  - 8 héroes (4 desbloqueables) y 6 mapas con modificadores y peligros propios.
 *  - 12 armas y 8 habilidades, con sinergias únicas por combinación.
 *  - Objetos en el mundo: cofres, corazones, imanes, bombas, élites.
 *  - Logros persistentes (localStorage) que desbloquean héroes, mapas, armas
 *    y bonificaciones de partida, visibles en la ventana "Logros" (tecla L).
 */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** @brief Elige un elemento al azar de un array no vacío. */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
/** @brief Ruido determinista 2D: mismo (x,y,seed) siempre devuelve lo mismo. */
function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}
/** @brief Máximo de armas que puede llevar un héroe a la vez. */
const MAX_WEAPONS = 6;
/** @brief Nivel máximo de las habilidades. */
const SKILL_MAX = 6;
function emptyStats() {
    return {
        totalKills: 0, totalTime: 0, runs: 0, bestTime: 0, bestKills: 0, bestLevel: 0, maxWeapons: 0,
        chests: 0, elites: 0, gems: 0, bestNoHit: 0, synergies: [], maps: [], heroes: [],
    };
}
function makeRunStats() {
    return { time: 0, kills: 0, chests: 0, elites: 0, noHit: 0, bestNoHit: 0, level: 1, weapons: 1, synergies: new Set(), maps: new Set() };
}
/** @brief Clave de guardado en localStorage. */
const SAVE_KEY = 'tsSurvivors.save.v1';
/** @class Progress @brief Guarda y carga logros desbloqueados y estadísticas. */
class Progress {
    constructor() {
        this.unlocked = [];
        this.stats = emptyStats();
        let ok = true;
        try {
            localStorage.getItem(SAVE_KEY);
        }
        catch {
            ok = false;
        }
        this.ok = ok;
        this.load();
    }
    static num(v, def = 0) { return typeof v === 'number' && isFinite(v) ? v : def; }
    static list(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
    load() {
        if (!this.ok)
            return;
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw)
                return;
            const d = JSON.parse(raw);
            this.unlocked = Progress.list(d.unlocked);
            const s = d.stats ?? {};
            const n = Progress.num;
            this.stats = {
                totalKills: n(s['totalKills']), totalTime: n(s['totalTime']), runs: n(s['runs']),
                bestTime: n(s['bestTime']), bestKills: n(s['bestKills']), bestLevel: n(s['bestLevel']),
                maxWeapons: n(s['maxWeapons']), chests: n(s['chests']), elites: n(s['elites']),
                gems: n(s['gems']), bestNoHit: n(s['bestNoHit']),
                synergies: Progress.list(s['synergies']), maps: Progress.list(s['maps']), heroes: Progress.list(s['heroes']),
            };
        }
        catch { /* datos corruptos: se empieza de cero */ }
    }
    save() {
        if (!this.ok)
            return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({ unlocked: this.unlocked, stats: this.stats }));
        }
        catch { /* sin almacenamiento */ }
    }
    has(id) { return this.unlocked.includes(id); }
    /** @brief Desbloquea un logro. @returns true si era nuevo. */
    unlock(id) {
        if (this.has(id))
            return false;
        this.unlocked.push(id);
        this.save();
        return true;
    }
}
const PROGRESS = new Progress();
/** @brief true si el contenido asociado al logro ya está desbloqueado. */
const unlocked = (id) => !id || PROGRESS.has(id);
/* ------------------------------------------------------------------ */
/*  Entidades                                                          */
/* ------------------------------------------------------------------ */
/** @class Entity @brief Clase base abstracta de todo objeto del mundo. */
class Entity {
    /** @param x Posición X. @param y Posición Y. @param radius Radio de colisión. */
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.alive = true;
    }
}
/**
 * @class Enemy
 * @brief Base abstracta de enemigos: persigue al jugador, anima y suelta gemas.
 *
 * Soporta estados alterados: congelación (`slow`), enraizado (`root`) y sangrado,
 * además de la variante élite con muchas más vida y recompensas.
 */
class Enemy extends Entity {
    /** @param radius Radio. @param hp Vida. @param speed Velocidad. @param contactDamage Daño por contacto. @param xpValue XP al morir. */
    constructor(x, y, radius, hp, speed, contactDamage, xpValue) {
        super(x, y, radius);
        this.hp = hp;
        this.speed = speed;
        this.contactDamage = contactDamage;
        this.xpValue = xpValue;
        this.age = rand(0, 6);
        this.flash = 0;
        this.dir = 1;
        this.slow = 0;
        this.rootT = 0;
        this.bleedT = 0;
        this.bleedDps = 0;
        this.bleedTick = 0;
        this.elite = false;
        this.maxHp = hp;
    }
    /** @brief Daño que hace al tocar al jugador. */
    get touchDamage() { return this.contactDamage; }
    /** @brief XP que suelta al morir. */
    get xp() { return this.xpValue; }
    /** @brief true si está ralentizado o enraizado (lo usan algunas sinergias). */
    get chilled() { return this.slow > 0 || this.rootT > 0; }
    update(dt, game) {
        const p = game.player;
        const d = dist(this, p) || 1;
        const mul = this.speedMul();
        this.x += ((p.x - this.x) / d) * this.speed * mul * dt;
        this.y += ((p.y - this.y) / d) * this.speed * mul * dt;
        this.dir = p.x >= this.x ? 1 : -1;
        this.age += dt;
        this.flash -= dt;
        this.slow -= dt;
        this.rootT -= dt;
        if (this.bleedT > 0) {
            this.bleedT -= dt;
            this.bleedTick -= dt;
            if (this.bleedTick <= 0) {
                this.bleedTick = 0.5;
                this.takeDamage(this.bleedDps * 0.5, game, true);
            }
        }
    }
    /** @brief Aplica sangrado (daño por tiempo). @param dps Daño por segundo. @param sec Duración. */
    bleed(dps, sec) { this.bleedDps = Math.max(this.bleedDps, dps); this.bleedT = Math.max(this.bleedT, sec); }
    /** @brief Ralentiza al enemigo (velocidad x0.3). @param sec Duración en segundos. */
    freeze(sec) { this.slow = Math.max(this.slow, sec); }
    /** @brief Enraiza al enemigo (casi no se mueve). @param sec Duración en segundos. */
    root(sec) { this.rootT = Math.max(this.rootT, sec); }
    /** @brief Empuja al enemigo alejándolo de un punto. @param from Origen. @param force Píxeles. */
    knock(from, force) {
        const d = dist(this, from) || 1;
        this.x += ((this.x - from.x) / d) * force;
        this.y += ((this.y - from.y) / d) * force;
    }
    speedMul() { return this.rootT > 0 ? 0.06 : this.slow > 0 ? 0.3 : 1; }
    /** @brief Ajusta vida y velocidad con los modificadores del mapa. */
    applyMods(hpMul, spdMul) { this.hp *= hpMul; this.maxHp = this.hp; this.speed *= spdMul; }
    /** @brief Convierte al enemigo en élite: más vida, más daño y más botín. */
    makeElite() {
        this.elite = true;
        this.hp = this.maxHp = this.maxHp * 6 + 40;
        this.contactDamage = Math.round(this.contactDamage * 1.5);
        this.xpValue *= 5;
        this.radius *= 1.35;
        this.speed *= 0.95;
    }
    /**
     * @brief Resta vida; si muere avisa al juego (que suelta gemas y botín).
     * @param amount Daño. @param game Juego. @param silent Sin destello (sangrado).
     */
    takeDamage(amount, game, silent = false) {
        if (!this.alive)
            return;
        this.hp -= amount;
        if (!silent)
            this.flash = 0.08;
        if (this.hp <= 0) {
            this.alive = false;
            game.onKill(this);
        }
    }
    /** @brief Dibuja el enemigo mirando al jugador; se pone blanco al ser golpeado. */
    draw(ctx) {
        if (this.elite) {
            ctx.save();
            ctx.translate(this.x, this.y);
            circle(ctx, 0, this.radius * 0.55, this.radius * 1.5, 'rgba(0,0,0,.25)');
            ctx.strokeStyle = 'rgba(255,205,80,.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 7 + Math.sin(this.age * 4) * 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.dir, 1);
        this.drawBody(ctx, this.flash > 0);
        if (this.slow > 0)
            circle(ctx, 0, 0, this.radius, 'rgba(120,200,255,.4)');
        if (this.rootT > 0)
            circle(ctx, 0, 0, this.radius * 0.9, 'rgba(120,220,120,.45)');
        ctx.restore();
        if (this.alive && this.hp < this.maxHp) {
            const w = Math.max(20, this.radius * 2), y = this.y - this.radius - 14;
            ctx.fillStyle = 'rgba(0,0,0,.6)';
            ctx.fillRect(this.x - w / 2 - 1, y - 1, w + 2, 6);
            ctx.fillStyle = '#e04848';
            ctx.fillRect(this.x - w / 2, y, w * Math.max(0, this.hp / this.maxHp), 4);
        }
    }
}
/** @class Bat @brief Murciélago: rápido y frágil, con alas que aletean. */
class Bat extends Enemy {
    constructor(x, y, t) { super(x, y, 9, 6 + t * 0.1, 95 + Math.min(50, t * 0.3), 6, 1); }
    drawBody(ctx, hit) {
        const c = hit ? '#fff' : '#6a3d8f', f = Math.sin(this.age * 22);
        ctx.fillStyle = c;
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(s * 4, -2);
            ctx.lineTo(s * 19, -9 - 7 * f);
            ctx.lineTo(s * 13, 0);
            ctx.lineTo(s * 16, 7 + 4 * f);
            ctx.lineTo(s * 5, 4);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(s * 3, -6);
            ctx.lineTo(s * 6, -13);
            ctx.lineTo(s * 7, -5);
            ctx.fill();
        }
        circle(ctx, 0, 0, 8, c);
        circle(ctx, -3, -1, 2, '#ff4d4d');
        circle(ctx, 3, -1, 2, '#ff4d4d');
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-3, 4);
        ctx.lineTo(-1, 4);
        ctx.lineTo(-2, 8);
        ctx.moveTo(1, 4);
        ctx.lineTo(3, 4);
        ctx.lineTo(2, 8);
        ctx.fill();
    }
}
/** @class Skeleton @brief Esqueleto: velocidad y vida medias, camina con rebote. */
class Skeleton extends Enemy {
    constructor(x, y, t) { super(x, y, 11, 12 + t * 0.15, 55 + Math.min(60, t * 0.4), 8, 1); }
    drawBody(ctx, hit) {
        const c = hit ? '#fff' : '#e8e4d4', b = Math.sin(this.age * 10) * 1.5;
        ctx.fillStyle = c;
        ctx.fillRect(-5, 1 + b, 10, 10);
        ctx.fillStyle = '#3a3a44';
        for (const y of [4, 7, 10])
            ctx.fillRect(-4, y + b, 8, 1.2);
        circle(ctx, 0, -5 + b, 8, c);
        ctx.fillStyle = c;
        ctx.fillRect(-4, -1 + b, 8, 4);
        circle(ctx, -3, -6 + b, 2.4, '#1b1b22');
        circle(ctx, 3, -6 + b, 2.4, '#1b1b22');
        circle(ctx, -3 + 0.8, -6 + b, 1, '#ff5959');
        circle(ctx, 3 + 0.8, -6 + b, 1, '#ff5959');
        ctx.fillStyle = '#1b1b22';
        ctx.fillRect(-2, 0 + b, 4, 1.4);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(10, -6 + b, 3, 16);
    }
}
/** @class Brute @brief Ogro: lento, enorme y muy resistente. */
class Brute extends Enemy {
    constructor(x, y, t) { super(x, y, 17, 60 + t * 0.5, 38 + Math.min(25, t * 0.15), 16, 5); }
    drawBody(ctx, hit) {
        const c = hit ? '#fff' : '#5c8a3a', b = Math.sin(this.age * 6) * 1.5;
        circle(ctx, 0, 3 + b, 16, c);
        circle(ctx, 0, -9 + b, 9, c);
        ctx.fillStyle = hit ? '#fff' : '#d9d2b0';
        ctx.beginPath();
        ctx.moveTo(-7, -15 + b);
        ctx.lineTo(-10, -24 + b);
        ctx.lineTo(-3, -17 + b);
        ctx.moveTo(7, -15 + b);
        ctx.lineTo(10, -24 + b);
        ctx.lineTo(3, -17 + b);
        ctx.fill();
        ctx.strokeStyle = '#1b2a10';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, -13 + b);
        ctx.lineTo(-1, -10 + b);
        ctx.moveTo(6, -13 + b);
        ctx.lineTo(1, -10 + b);
        ctx.stroke();
        circle(ctx, -3.5, -9 + b, 1.8, '#ffd23f');
        circle(ctx, 3.5, -9 + b, 1.8, '#ffd23f');
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-5, -4 + b);
        ctx.lineTo(-3, -4 + b);
        ctx.lineTo(-4, -9 + b);
        ctx.moveTo(5, -4 + b);
        ctx.lineTo(3, -4 + b);
        ctx.lineTo(4, -9 + b);
        ctx.fill();
        ctx.fillStyle = '#3d5a26';
        ctx.fillRect(-9, 8 + b, 18, 3);
    }
}
/** @class Spitter @brief Escupidor: mantiene distancia y lanza proyectiles al jugador. */
class Spitter extends Enemy {
    constructor(x, y, t) {
        super(x, y, 12, 14 + t * 0.16, 46 + Math.min(30, t * 0.12), 7, 2);
        this.shoot = rand(1, 2.5);
    }
    update(dt, game) {
        super.update(dt, game);
        this.shoot -= dt;
        const p = game.player;
        if (this.shoot > 0 || !this.alive)
            return;
        const d = dist(this, p);
        if (d > 520)
            return;
        this.shoot = 2.6;
        game.add(new EnemyShot(this.x, this.y, p.x, p.y, 7 + game.time * 0.02));
    }
    drawBody(ctx, hit) {
        const c = hit ? '#fff' : '#7a5c9a', b = Math.sin(this.age * 8) * 1.5;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(0, 6 + b, 11, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        circle(ctx, 0, -6 + b, 8, c);
        circle(ctx, 4, -7 + b, 3, '#c8ff7a');
        ctx.fillStyle = '#2a2036';
        ctx.beginPath();
        ctx.arc(-1, -4 + b, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.fillRect(-9, 14 + b, 5, 3);
        ctx.fillRect(4, 14 + b, 5, 3);
    }
}
/** @class Wraith @brief Espectro: muy rápido y frágil, con cuerpo translúcido. */
class Wraith extends Enemy {
    constructor(x, y, t) { super(x, y, 11, 16 + t * 0.2, 118 + Math.min(45, t * 0.25), 7, 2); }
    drawBody(ctx, hit) {
        ctx.globalAlpha = 0.85;
        const c = hit ? '#fff' : '#7fd8d8', b = Math.sin(this.age * 6) * 2;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, -14 + b);
        ctx.lineTo(10, 2 + b);
        for (let i = 0; i < 4; i++)
            ctx.lineTo(6 - i * 4, (i % 2 ? 12 : 6) + b);
        ctx.lineTo(-10, 2 + b);
        ctx.fill();
        circle(ctx, -3, -4 + b, 2, '#0a2a2a');
        circle(ctx, 3, -4 + b, 2, '#0a2a2a');
        ctx.globalAlpha = 1;
    }
}
/** @class Golem @brief Gólem: lentísimo y muy duro; al morir se rompe en murciélagos. */
class Golem extends Enemy {
    constructor(x, y, t) { super(x, y, 19, 110 + t * 0.9, 30 + Math.min(14, t * 0.06), 20, 8); }
    drawBody(ctx, hit) {
        const c = hit ? '#fff' : '#6f7480', b = Math.sin(this.age * 4) * 1.2;
        ctx.fillStyle = c;
        ctx.fillRect(-15, -6 + b, 30, 22);
        ctx.fillStyle = hit ? '#fff' : '#565b66';
        ctx.fillRect(-19, -4 + b, 6, 16);
        ctx.fillRect(13, -4 + b, 6, 16);
        circle(ctx, 0, -12 + b, 11, c);
        circle(ctx, -4, -13 + b, 2.2, '#ffb03a');
        circle(ctx, 4, -13 + b, 2.2, '#ffb03a');
        ctx.fillStyle = '#2a2d33';
        ctx.fillRect(-6, -7 + b, 12, 2);
    }
}
/** @class EnemyShot @brief Proyectil enemigo (escupidores). */
class EnemyShot extends Entity {
    constructor(x, y, tx, ty, damage) {
        super(x, y, 6);
        this.damage = damage;
        this.life = 5;
        const d = Math.hypot(tx - x, ty - y) || 1;
        this.vx = ((tx - x) / d) * 195;
        this.vy = ((ty - y) / d) * 195;
    }
    update(dt, game) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        const p = game.player;
        if (dist(this, p) < this.radius + p.radius) {
            this.alive = false;
            p.takeDamage(this.damage, game);
        }
    }
    draw(ctx) {
        circle(ctx, this.x, this.y, this.radius + 2, 'rgba(160,110,220,.35)');
        circle(ctx, this.x, this.y, this.radius, '#a06ee0');
    }
}
/** @class Gem @brief Gema de experiencia atraída por el jugador. */
class Gem extends Entity {
    constructor(x, y, value) {
        super(x, y, 5);
        this.value = value;
        this.t = 0;
    }
    update(dt, game) {
        const p = game.player;
        const d = dist(this, p) || 1;
        this.t += dt;
        if (d < p.pickupRange || game.magnet > 0) {
            const sp = game.magnet > 0 ? 620 : 420;
            this.x += ((p.x - this.x) / d) * sp * dt;
            this.y += ((p.y - this.y) / d) * sp * dt;
        }
        if (d < p.radius + this.radius) {
            this.alive = false;
            p.addXp(this.value, game);
        }
    }
    draw(ctx) {
        const r = this.radius + Math.sin(this.t * 5) * 0.8;
        circle(ctx, this.x, this.y, r + 2, 'rgba(61,214,208,.25)');
        circle(ctx, this.x, this.y, r, '#3dd6d0');
    }
}
/** @class Pickup @brief Objeto del suelo: cura, imán, bomba o cofre de mejora. */
class Pickup extends Entity {
    constructor(x, y, kind) {
        super(x, y, kind === 'chest' ? 14 : 11);
        this.kind = kind;
        this.t = 0;
        this.life = kind === 'chest' ? 90 : 25;
    }
    update(dt, game) {
        this.t += dt;
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        const p = game.player;
        const d = dist(this, p) || 1;
        if (this.kind !== 'chest' && d < p.pickupRange + 20) {
            this.x += ((p.x - this.x) / d) * 270 * dt;
            this.y += ((p.y - this.y) / d) * 270 * dt;
        }
        if (d < p.radius + this.radius) {
            this.alive = false;
            game.collect(this.kind);
        }
    }
    draw(ctx) {
        if (this.life < 4 && Math.floor(this.life * 6) % 2 === 0)
            return;
        const b = Math.sin(this.t * 4) * 2;
        switch (this.kind) {
            case 'heart':
                circle(ctx, this.x, this.y, this.radius + 4, 'rgba(255,110,130,.18)');
                circle(ctx, this.x - 4, this.y - 3 + b, 5, '#ff5b7f');
                circle(ctx, this.x + 4, this.y - 3 + b, 5, '#ff5b7f');
                ctx.fillStyle = '#ff5b7f';
                ctx.beginPath();
                ctx.moveTo(this.x - 9, this.y - 1 + b);
                ctx.lineTo(this.x + 9, this.y - 1 + b);
                ctx.lineTo(this.x, this.y + 10 + b);
                ctx.fill();
                break;
            case 'magnet':
                circle(ctx, this.x, this.y + b, this.radius + 4, 'rgba(120,200,255,.18)');
                ctx.strokeStyle = '#7fd8ff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(this.x, this.y + b, 6, Math.PI, 0);
                ctx.stroke();
                ctx.strokeStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(this.x - 6, this.y + b);
                ctx.lineTo(this.x - 6, this.y + 6 + b);
                ctx.moveTo(this.x + 6, this.y + b);
                ctx.lineTo(this.x + 6, this.y + 6 + b);
                ctx.stroke();
                break;
            case 'bomb':
                circle(ctx, this.x, this.y + b, this.radius + 4, 'rgba(255,120,60,.18)');
                circle(ctx, this.x, this.y + b, 8, '#2b2f3a');
                ctx.strokeStyle = '#ffb03a';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(this.x + 4, this.y - 6 + b);
                ctx.lineTo(this.x + 8, this.y - 12 + b);
                ctx.stroke();
                circle(ctx, this.x + 9, this.y - 13 + b, 2.4, '#ffd76a');
                break;
            default:
                circle(ctx, this.x, this.y, this.radius + 8, 'rgba(255,200,90,.16)');
                ctx.fillStyle = '#8a5a2b';
                ctx.fillRect(this.x - 13, this.y - 10 + b, 26, 20);
                ctx.fillStyle = '#e0b84a';
                ctx.fillRect(this.x - 13, this.y - 4 + b, 26, 4);
                ctx.fillStyle = '#d9c07a';
                ctx.fillRect(this.x - 3, this.y - 12 + b, 6, 24);
                break;
        }
    }
}
/** @class Projectile @brief Proyectil del jugador con perforación y efectos limitados. */
class Projectile extends Entity {
    constructor(x, y, vx, vy, damage, pierce, style = 'orb') {
        super(x, y, style === 'ice' ? 6 : 5);
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.pierce = pierce;
        this.style = style;
        this.life = 2;
        this.hit = new Set();
        this.spin = 0;
        /** Probabilidad (0-1) de encadenar un rayo al impactar (sinergia Tormenta Arcana). */
        this.chain = 0;
    }
    update(dt, game) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.spin += dt * 12;
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        for (const e of game.enemyList) {
            if (!e.alive || this.hit.has(e) || dist(this, e) >= this.radius + e.radius)
                continue;
            this.hit.add(e);
            if (this.style === 'ice')
                e.freeze(1.2);
            e.takeDamage(this.damage, game);
            if (this.chain > 0 && Math.random() < this.chain) {
                const near = game.enemyList.find(o => o.alive && o !== e && dist(o, e) < 190);
                if (near) {
                    game.add(new Bolt(near.x, near.y));
                    near.takeDamage(this.damage * 0.6, game);
                }
            }
            if (this.pierce-- <= 0) {
                this.alive = false;
                return;
            }
        }
    }
    draw(ctx) {
        switch (this.style) {
            case 'knife': {
                const a = Math.atan2(this.vy, this.vx);
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(a);
                ctx.fillStyle = '#e8ecf5';
                ctx.beginPath();
                ctx.moveTo(8, 0);
                ctx.lineTo(-4, 3);
                ctx.lineTo(-4, -3);
                ctx.fill();
                ctx.fillStyle = '#8a5a2b';
                ctx.fillRect(-7, -1.5, 4, 3);
                ctx.restore();
                break;
            }
            case 'ice':
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.spin);
                ctx.fillStyle = '#bfefff';
                ctx.beginPath();
                ctx.moveTo(0, -7);
                ctx.lineTo(5, 0);
                ctx.lineTo(0, 7);
                ctx.lineTo(-5, 0);
                ctx.fill();
                ctx.restore();
                break;
            case 'bone':
                circle(ctx, this.x, this.y, this.radius + 2, 'rgba(200,245,190,.3)');
                circle(ctx, this.x, this.y, this.radius, '#def7d6');
                break;
            case 'spike':
                circle(ctx, this.x, this.y, this.radius, '#7ad07a');
                break;
            default:
                circle(ctx, this.x, this.y, this.radius + 1, '#f4d35e');
        }
    }
}
/** @class Spirit @brief Espíritu óseo teledirigido (arma Bone Spirits). */
class Spirit extends Entity {
    constructor(x, y, damage, leech) {
        super(x, y, 7);
        this.damage = damage;
        this.leech = leech;
        this.life = 3.2;
        const a = rand(0, Math.PI * 2);
        this.vx = Math.cos(a) * 150;
        this.vy = Math.sin(a) * 150;
    }
    update(dt, game) {
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        const t = game.nearestEnemy(this);
        if (t) {
            const d = dist(this, t) || 1;
            const sp = 400;
            this.vx += (((t.x - this.x) / d) * sp - this.vx) * Math.min(1, dt * 5);
            this.vy += (((t.y - this.y) / d) * sp - this.vy) * Math.min(1, dt * 5);
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        for (const e of game.enemyList) {
            if (!e.alive || dist(this, e) >= this.radius + e.radius)
                continue;
            e.takeDamage(this.damage, game);
            if (this.leech)
                game.player.heal(1);
            this.alive = false;
            return;
        }
    }
    draw(ctx) {
        circle(ctx, this.x, this.y, this.radius + 3, 'rgba(170,255,170,.25)');
        circle(ctx, this.x, this.y, this.radius, '#c8f5c0');
        circle(ctx, this.x - 2.5, this.y - 1, 1.4, '#2c5c2c');
        circle(ctx, this.x + 2.5, this.y - 1, 1.4, '#2c5c2c');
    }
}
/** @class Axe @brief Hacha que vuela, gira y vuelve al jugador (arma Boomerang Axe). */
class Axe extends Entity {
    constructor(owner, damage, range, vx, vy, pierce) {
        super(owner.x, owner.y, 12);
        this.owner = owner;
        this.damage = damage;
        this.range = range;
        this.vx = vx;
        this.vy = vy;
        this.pierce = pierce;
        this.hit = new Map();
        this.life = 0;
        this.angle = 0;
    }
    update(dt, game) {
        this.life += dt;
        this.angle += dt * 14;
        if (this.life > this.range || this.pierce <= 0) {
            const d = dist(this, this.owner) || 1;
            const sp = 420 + (this.life - this.range) * 260;
            this.x += ((this.owner.x - this.x) / d) * sp * dt;
            this.y += ((this.owner.y - this.y) / d) * sp * dt;
            if (d < 24) {
                this.alive = false;
                return;
            }
        }
        else {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        }
        for (const e of game.enemyList) {
            if (!e.alive || game.time - (this.hit.get(e) ?? -99) < 0.35 || dist(this, e) >= this.radius + e.radius)
                continue;
            this.hit.set(e, game.time);
            e.takeDamage(this.damage, game);
            this.pierce--;
        }
        for (const e of this.hit.keys())
            if (!e.alive)
                this.hit.delete(e);
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(-2, -14, 4, 28);
        ctx.fillStyle = '#d0d6e0';
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(11, -10);
        ctx.lineTo(4, -2);
        ctx.lineTo(-4, -2);
        ctx.lineTo(-11, -10);
        ctx.fill();
        ctx.restore();
    }
}
/** @class Ally @brief Esqueleto invocado que persigue y golpea enemigos. */
class Ally extends Entity {
    constructor(x, y, damage, life, explode) {
        super(x, y, 10);
        this.damage = damage;
        this.explode = explode;
        this.atk = 0;
        this.walk = 0;
        this.life = life;
    }
    update(dt, game) {
        this.life -= dt;
        this.walk += dt;
        if (this.life <= 0) {
            if (this.explode) {
                game.add(new Ring(this.x, this.y, 70, '#c8f5c0'));
                for (const e of game.enemyList)
                    if (e.alive && dist(this, e) < 70 + e.radius)
                        e.takeDamage(this.damage * 2, game);
            }
            this.alive = false;
            return;
        }
        this.atk -= dt;
        const t = game.nearestEnemy(this);
        const p = game.player;
        const goal = t ? { x: t.x, y: t.y } : { x: p.x + Math.cos(this.walk * 2) * 40, y: p.y + Math.sin(this.walk * 2) * 40 };
        const d = dist(this, goal) || 1;
        const stop = t ? this.radius + t.radius : 0;
        if (d > stop) {
            const sp = t ? 175 : 150;
            this.x += ((goal.x - this.x) / d) * sp * dt;
            this.y += ((goal.y - this.y) / d) * sp * dt;
        }
        if (t && d < this.radius + t.radius + 6 && this.atk <= 0) {
            this.atk = 0.8;
            t.takeDamage(this.damage, game);
        }
    }
    draw(ctx) {
        const b = Math.sin(this.walk * 12) * 1.6;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath();
        ctx.ellipse(0, 12, 9, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dfe6d8';
        ctx.fillRect(-4, 0 + b, 8, 9);
        circle(ctx, 0, -5 + b, 6.5, '#e8f0e0');
        circle(ctx, -2.4, -6 + b, 2, '#1b1b22');
        circle(ctx, 2.4, -6 + b, 2, '#1b1b22');
        if (this.life < 2 && Math.floor(this.life * 8) % 2 === 0) {
            ctx.restore();
            return;
        }
        ctx.restore();
    }
}
/** @class Totem @brief Tótem que dispara espinas al enemigo más cercano (arma Nature Totem). */
class Totem extends Entity {
    /** @param x Posición X. @param y Posición Y. @param life Duración en segundos. @param damage Daño de cada espina. @param holy Si la sinergia Santuario está activa. */
    constructor(x, y, life, damage, holy) {
        super(x, y, 12);
        this.damage = damage;
        this.holy = holy;
        this.cd = 0.4;
        this.pulse = 0;
        this.life = life;
    }
    update(dt, game) {
        this.life -= dt;
        this.pulse -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        this.cd -= dt;
        if (this.cd > 0)
            return;
        const t = game.nearestEnemy(this);
        if (!t || dist(this, t) > 340)
            return;
        this.cd = 1.2;
        const a = Math.atan2(t.y - this.y, t.x - this.x);
        game.add(new Projectile(this.x, this.y, Math.cos(a) * 420, Math.sin(a) * 420, this.damage, 0, 'spike'));
        if (this.holy) {
            this.pulse = 0.15;
            for (const e of game.enemyList)
                if (e.alive && dist(this, e) < 90 + e.radius)
                    e.takeDamage(this.damage * 0.7, game);
        }
    }
    draw(ctx) {
        if (this.holy) {
            ctx.fillStyle = this.pulse > 0 ? 'rgba(255,240,150,.22)' : 'rgba(255,240,150,.08)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, 90, 0, Math.PI * 2);
            ctx.fill();
        }
        circle(ctx, this.x, this.y + 8, 10, 'rgba(0,0,0,.3)');
        ctx.fillStyle = '#6b4a24';
        ctx.fillRect(this.x - 7, this.y - 6, 14, 18);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(this.x - 9, this.y - 12, 18, 7);
        ctx.fillStyle = '#7ad07a';
        ctx.beginPath();
        ctx.moveTo(this.x - 12, this.y - 14);
        ctx.lineTo(this.x + 12, this.y - 14);
        ctx.lineTo(this.x, this.y - 26);
        ctx.fill();
        circle(ctx, this.x, this.y - 4, 3, '#ffe96b');
    }
}
/** @class Flame @brief Fuego en el suelo que daña por ticks; con sinergia también congela. */
class Flame extends Entity {
    constructor(x, y, r, damage, life, frost) {
        super(x, y, r);
        this.damage = damage;
        this.life = life;
        this.frost = frost;
        this.tick = 0;
        this.t = 0;
    }
    update(dt, game) {
        this.life -= dt;
        this.t += dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        this.tick -= dt;
        if (this.tick > 0)
            return;
        this.tick = 0.4;
        for (const e of game.enemyList) {
            if (!e.alive || dist(this, e) >= this.radius + e.radius)
                continue;
            const bonus = this.frost && e.chilled ? 1.5 : 1;
            if (this.frost)
                e.freeze(0.8);
            e.takeDamage(this.damage * bonus, game);
        }
    }
    draw(ctx) {
        const f = 1 + Math.sin(this.t * 14) * 0.1;
        circle(ctx, this.x, this.y, this.radius * f, 'rgba(255,110,30,.35)');
        circle(ctx, this.x, this.y, this.radius * 0.5 * f, this.frost ? 'rgba(150,220,255,.6)' : 'rgba(255,220,90,.55)');
    }
}
/** @class Ring @brief Efecto visual de onda expansiva (sin daño propio). */
class Ring extends Entity {
    constructor(x, y, maxR, color = '#9b8cff') {
        super(x, y, 0);
        this.maxR = maxR;
        this.color = color;
        this.t = 0;
    }
    update(dt) {
        this.t += dt;
        this.radius = this.maxR * Math.min(1, this.t / 0.3);
        if (this.t >= 0.3)
            this.alive = false;
    }
    draw(ctx) {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
    }
}
/** @class Bolt @brief Efecto visual de rayo (sin daño propio). */
class Bolt extends Entity {
    constructor(x, y) {
        super(x, y, 0);
        this.t = 0;
    }
    update(dt) { this.t += dt; if (this.t > 0.15)
        this.alive = false; }
    draw(ctx) {
        ctx.strokeStyle = '#fff6a8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - 220);
        for (let i = 1; i <= 5; i++)
            ctx.lineTo(this.x + (i < 5 ? rand(-14, 14) : 0), this.y - 220 + i * 44);
        ctx.stroke();
    }
}
/** @class LavaPool @brief Charca de lava telegrafiada: daña a jugador y enemigos (mapa Volcán). */
class LavaPool extends Entity {
    constructor(x, y, r) {
        super(x, y, r);
        this.warn = 1.3;
        this.life = 6;
        this.tick = 0;
        this.t = 0;
    }
    update(dt, game) {
        this.t += dt;
        if (this.warn > 0) {
            this.warn -= dt;
            return;
        }
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        this.tick -= dt;
        if (this.tick > 0)
            return;
        this.tick = 0.5;
        const p = game.player;
        if (dist(this, p) < this.radius + p.radius)
            p.hurtRaw(6, game);
        for (const e of game.enemyList)
            if (e.alive && dist(this, e) < this.radius + e.radius)
                e.takeDamage(22, game);
    }
    draw(ctx) {
        if (this.warn > 0) {
            ctx.strokeStyle = `rgba(255,120,60,${0.35 + 0.3 * Math.sin(this.t * 18)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius * (1.1 - this.warn / 1.3 * 0.3), 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        circle(ctx, this.x, this.y, this.radius + 4, 'rgba(255,80,20,.35)');
        circle(ctx, this.x, this.y, this.radius, '#d63b12');
        circle(ctx, this.x, this.y, this.radius * 0.62 + Math.sin(this.t * 6) * 2, '#ff8a3d');
        circle(ctx, this.x, this.y, this.radius * 0.3, '#ffd76a');
    }
}
/** @class VoidRift @brief Grieta del Abismo que atrae a todos hacia su centro. */
class VoidRift extends Entity {
    constructor(x, y, r = 170) {
        super(x, y, r);
        this.warn = 1.2;
        this.life = 6;
        this.tick = 0;
        this.t = 0;
    }
    update(dt, game) {
        this.t += dt;
        if (this.warn > 0) {
            this.warn -= dt;
            return;
        }
        this.life -= dt;
        if (this.life <= 0) {
            this.alive = false;
            return;
        }
        const pull = (o, force) => {
            const d = dist(this, o) || 1;
            if (d > this.radius)
                return;
            const f = (1 - d / this.radius) * force;
            o.x += ((this.x - o.x) / d) * f * dt;
            o.y += ((this.y - o.y) / d) * f * dt;
        };
        const p = game.player;
        pull(p, 110);
        for (const e of game.enemyList)
            if (e.alive)
                pull(e, 150);
        this.tick -= dt;
        if (this.tick > 0)
            return;
        this.tick = 0.5;
        if (dist(this, p) < 46)
            p.hurtRaw(3, game);
    }
    draw(ctx) {
        if (this.warn > 0) {
            ctx.strokeStyle = `rgba(200,110,255,${0.4 + 0.3 * Math.sin(this.t * 16)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        for (let i = 3; i >= 1; i--) {
            ctx.strokeStyle = `rgba(160,80,255,${0.15 * i})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius * (0.35 + 0.2 * i) - (this.t * 40) % 40, 0, Math.PI * 2);
            ctx.stroke();
        }
        circle(ctx, this.x, this.y, 26, 'rgba(30,0,60,.85)');
        circle(ctx, this.x, this.y, 12, '#c86bff');
    }
}
/** @brief Catálogo de sinergias del juego. */
const SYNERGIES = [
    { id: 'arcaneStorm', name: 'Tormenta Arcana', desc: 'Magic Bolt y Lightning: los proyectiles pueden encadenar rayos (+1 rayo).', needs: ['Magic Bolt', 'Lightning'] },
    { id: 'steelTempest', name: 'Torbellino de Acero', desc: 'Orbit Blades y Whirlwind: +1 cuchilla, más empuje y sangrado.', needs: ['Orbit Blades', 'Whirlwind'] },
    { id: 'thermalShock', name: 'Choque Térmico', desc: 'Fire Trail y Frost Wand: las llamas congelan y hacen +50% a enemigos helados.', needs: ['Fire Trail', 'Frost Wand'] },
    { id: 'unwaveringFaith', name: 'Fe Inquebrantable', desc: 'Holy Aura y Garlic: el aura cura 0,5 HP por enemigo golpeado.', needs: ['Holy Aura', 'Garlic'] },
    { id: 'throwingMastery', name: 'Maestría Arrojadiza', desc: 'Throwing Knives y Boomerang Axe: +1 cuchillo y +1 perforación.', needs: ['Throwing Knives', 'Boomerang Axe'] },
    { id: 'legion', name: 'Legión', desc: 'Bone Spirits y Raise Dead: los espíritus roban 1 HP y los aliados explotan.', needs: ['Bone Spirits', 'Raise Dead'] },
    { id: 'sanctuary', name: 'Santuario', desc: 'Nature Totem y Holy Aura: los tótems emiten el aura sagrada.', needs: ['Nature Totem', 'Holy Aura'] },
    { id: 'holySmith', name: 'Forja Sagrada', desc: 'Holy Aura y Frost Wand: el aura ralentiza a todo lo que toca.', needs: ['Holy Aura', 'Frost Wand'] },
];
/* ------------------------------------------------------------------ */
/*  Armas                                                              */
/* ------------------------------------------------------------------ */
/** @class Weapon @brief Arma automática con nivel; daño y cooldown dependen de las stats del dueño. */
class Weapon {
    /** @param name Nombre. @param baseDamage Daño nivel 1. @param cooldown Segundos entre usos. @param color Color con el que se lista en el HUD. */
    constructor(name, baseDamage, cooldown, color = '#f4d35e') {
        this.name = name;
        this.baseDamage = baseDamage;
        this.cooldown = cooldown;
        this.color = color;
        this.level = 1;
        this.maxLevel = 8;
        this.timer = 0;
    }
    /** @brief Daño efectivo (+30% por nivel, multiplicado por el poder del dueño). */
    dmg(o) { return this.baseDamage * (1 + 0.3 * (this.level - 1)) * o.mightTotal(); }
    /** @brief Cooldown efectivo según la reducción del dueño. */
    cd(o) { return this.cooldown * o.cooldownMult; }
    upgrade() { this.level++; }
    draw(_ctx, _owner) { }
}
/** @class MagicBolt @brief Dispara proyectiles al enemigo más cercano. */
class MagicBolt extends Weapon {
    constructor() { super('Magic Bolt', 12, 0.8, '#7fb3ff'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const target = game.nearestEnemy(owner);
        if (!target)
            return;
        this.timer = this.cd(owner);
        const base = Math.atan2(target.y - owner.y, target.x - owner.x);
        const n = Math.ceil(this.level / 1.5);
        const pierce = this.level >= 3 ? 1 : 0;
        const chain = owner.syn('arcaneStorm') ? 0.25 : 0;
        for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.15;
            const p = new Projectile(owner.x, owner.y, Math.cos(a) * 450, Math.sin(a) * 450, this.dmg(owner), pierce, 'orb');
            p.chain = chain;
            game.add(p);
        }
    }
}
/**
 * @class OrbitBlades
 * @brief Cuchillas que giran alrededor del jugador y empujan a los enemigos.
 *
 * El radio de órbita es corto para alcanzar a los enemigos pegados al jugador.
 */
class OrbitBlades extends Weapon {
    constructor() {
        super('Orbit Blades', 12, 0.35, '#d0d6e0');
        this.angle = 0;
        this.lastHit = new Map();
    }
    orbit() { return 46 + 5 * this.level; }
    blades(owner, tempest) {
        const n = Math.min(8, 1 + this.level + (tempest ? 1 : 0));
        return Array.from({ length: n }, (_, i) => {
            const a = this.angle + (i * Math.PI * 2) / n;
            return { x: owner.x + Math.cos(a) * this.orbit(), y: owner.y + Math.sin(a) * this.orbit(), a };
        });
    }
    update(dt, owner, game) {
        const tempest = owner.syn('steelTempest');
        this.angle += dt * (3 + 0.2 * this.level + (tempest ? 0.8 : 0));
        const blades = this.blades(owner, tempest), gap = this.cd(owner);
        for (const e of game.enemyList) {
            if (!e.alive || game.time - (this.lastHit.get(e) ?? -99) < gap)
                continue;
            if (blades.some(b => dist(b, e) < 14 + e.radius)) {
                this.lastHit.set(e, game.time);
                e.takeDamage(this.dmg(owner), game);
                e.knock(owner, tempest ? 24 : 12);
                if (tempest)
                    e.bleed(4, 3);
            }
        }
        for (const e of this.lastHit.keys())
            if (!e.alive)
                this.lastHit.delete(e);
    }
    draw(ctx, owner) {
        for (const b of this.blades(owner, owner.syn('steelTempest'))) {
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.a + Math.PI);
            ctx.fillStyle = '#d0d6e0';
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.lineTo(-6, 6);
            ctx.lineTo(-6, -6);
            ctx.fill();
            ctx.fillStyle = '#7a5a2b';
            ctx.fillRect(-10, -2, 5, 4);
            ctx.restore();
        }
    }
}
/** @class HolyAura @brief Aura que daña periódicamente a los enemigos cercanos. */
class HolyAura extends Weapon {
    constructor() {
        super('Holy Aura', 8, 0.5, '#ffe27a');
        this.flash = 0;
    }
    radius() { return 80 + 12 * this.level; }
    update(dt, owner, game) {
        this.flash -= dt;
        this.timer -= dt;
        if (this.timer > 0)
            return;
        this.timer = this.cd(owner);
        this.flash = 0.15;
        let hits = 0;
        const frost = owner.syn('holySmith');
        const faithful = owner.syn('unwaveringFaith');
        for (const e of game.enemyList) {
            if (!e.alive || dist(owner, e) >= this.radius() + e.radius)
                continue;
            if (frost)
                e.freeze(0.8);
            e.takeDamage(this.dmg(owner), game);
            hits++;
        }
        if (faithful && hits > 0)
            owner.heal(Math.min(4, hits * 0.5));
    }
    draw(ctx, owner) {
        ctx.fillStyle = this.flash > 0 ? 'rgba(255,240,150,.28)' : 'rgba(255,240,150,.10)';
        ctx.beginPath();
        ctx.arc(owner.x, owner.y, this.radius(), 0, Math.PI * 2);
        ctx.fill();
    }
}
/** @class LightningStrike @brief Rayos sobre enemigos aleatorios dentro de un rango. */
class LightningStrike extends Weapon {
    constructor() { super('Lightning', 25, 1.6, '#fff6a8'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const pool = game.enemyList.filter(e => e.alive && dist(owner, e) < 380);
        if (pool.length === 0)
            return;
        this.timer = this.cd(owner);
        const extra = owner.syn('arcaneStorm') ? 1 : 0;
        for (let i = 0; i < 1 + Math.floor(this.level / 2) + extra && pool.length > 0; i++) {
            const e = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
            game.add(new Bolt(e.x, e.y));
            e.takeDamage(this.dmg(owner), game);
        }
    }
}
/** @class Garlic @brief Aura pequeña que golpea, ralentiza y repele a los enemigos pegados. */
class Garlic extends Weapon {
    constructor() {
        super('Garlic', 5, 0.45, '#eae6d8');
        this.pulse = 0;
    }
    radius(o) { return (58 + 6 * this.level) * (o.syn('unwaveringFaith') ? 1.3 : 1); }
    update(dt, owner, game) {
        this.pulse -= dt;
        this.timer -= dt;
        if (this.timer > 0)
            return;
        this.timer = this.cd(owner);
        this.pulse = 0.12;
        const push = owner.syn('unwaveringFaith') ? 9 : 5;
        for (const e of game.enemyList) {
            if (!e.alive || dist(owner, e) >= this.radius(owner) + e.radius)
                continue;
            e.takeDamage(this.dmg(owner), game);
            e.freeze(0.6);
            e.knock(owner, push);
        }
    }
    draw(ctx, owner) {
        ctx.fillStyle = this.pulse > 0 ? 'rgba(235,230,200,.20)' : 'rgba(235,230,200,.07)';
        ctx.beginPath();
        ctx.arc(owner.x, owner.y, this.radius(owner), 0, Math.PI * 2);
        ctx.fill();
    }
}
/** @class FrostWand @brief Proyectiles de hielo que congelan a los enemigos. */
class FrostWand extends Weapon {
    constructor() { super('Frost Wand', 10, 1.15, '#8fd8ff'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const target = game.nearestEnemy(owner);
        if (!target)
            return;
        this.timer = this.cd(owner);
        const base = Math.atan2(target.y - owner.y, target.x - owner.x);
        const n = 1 + Math.floor(this.level / 3);
        for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.2;
            game.add(new Projectile(owner.x, owner.y, Math.cos(a) * 380, Math.sin(a) * 380, this.dmg(owner), 0, 'ice'));
        }
    }
}
/** @class BoomerangAxe @brief Lanza hachas que vuelan y regresan atravesando enemigos. */
class BoomerangAxe extends Weapon {
    constructor() { super('Boomerang Axe', 18, 1.5, '#c0c8d8'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const target = game.nearestEnemy(owner);
        if (!target)
            return;
        this.timer = this.cd(owner);
        const a = Math.atan2(target.y - owner.y, target.x - owner.x);
        const pierce = 2 + (this.level >= 4 ? 1 : 0) + (owner.syn('throwingMastery') ? 1 : 0);
        game.add(new Axe(owner, this.dmg(owner), 0.9, Math.cos(a) * 380, Math.sin(a) * 380, pierce));
    }
}
/** @class ThrowingKnives @brief Abanico de cuchillos rápidos y perforantes. */
class ThrowingKnives extends Weapon {
    constructor() { super('Throwing Knives', 9, 0.85, '#e6e6f0'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const target = game.nearestEnemy(owner);
        if (!target)
            return;
        this.timer = this.cd(owner);
        const base = Math.atan2(target.y - owner.y, target.x - owner.x);
        const mastery = owner.syn('throwingMastery');
        const n = 1 + Math.floor(this.level / 2) + (mastery ? 1 : 0);
        const pierce = (this.level >= 4 ? 1 : 0) + (mastery ? 1 : 0);
        for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.22;
            game.add(new Projectile(owner.x, owner.y, Math.cos(a) * 520, Math.sin(a) * 520, this.dmg(owner), pierce, 'knife'));
        }
    }
}
/** @class BoneSpirits @brief Espíritus óseos teledirigidos que persiguen enemigos. */
class BoneSpirits extends Weapon {
    constructor() { super('Bone Spirits', 8, 1.0, '#c8f5c0'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const target = game.nearestEnemy(owner);
        if (!target)
            return;
        this.timer = this.cd(owner);
        const n = 1 + Math.floor(this.level / 2);
        const leech = owner.syn('legion');
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2);
            game.add(new Spirit(owner.x + Math.cos(a) * 14, owner.y + Math.sin(a) * 14, this.dmg(owner), leech));
        }
    }
}
/** @class NatureTotem @brief Coloca tótems que disparan espinas (máximo 2 a la vez). */
class NatureTotem extends Weapon {
    constructor() { super('Nature Totem', 0, 6, '#7ad07a'); }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0)
            return;
        if (game.entities.filter(e => e instanceof Totem && e.alive).length >= 2)
            return;
        this.timer = this.cd(owner);
        const dmg = (9 + 3 * (this.level - 1)) * owner.mightTotal();
        game.add(new Totem(owner.x, owner.y, 9 + 1.5 * this.level, dmg, owner.syn('sanctuary')));
    }
}
/** @class Whirlwind @brief Giro cuerpo a cuerpo: mucho empuje y daño creciente con varios enemigos. */
class Whirlwind extends Weapon {
    constructor() {
        super('Whirlwind', 15, 1.2, '#ffb08a');
        this.spin = 0;
    }
    radius() { return 88 + 4 * this.level; }
    update(dt, owner, game) {
        this.spin -= dt;
        this.timer -= dt;
        if (this.timer > 0)
            return;
        const r = this.radius();
        const hitList = game.enemyList.filter(e => e.alive && dist(owner, e) < r + e.radius);
        if (hitList.length === 0)
            return;
        this.timer = this.cd(owner);
        this.spin = 0.25;
        const tempest = owner.syn('steelTempest');
        const bonus = 1 + 0.25 * Math.max(0, Math.min(3, hitList.length) - 1) + (tempest ? 0.3 : 0);
        const dmg = this.dmg(owner) * bonus;
        for (const e of hitList) {
            e.takeDamage(dmg, game);
            e.knock(owner, tempest ? 34 : 22);
            if (tempest)
                e.bleed(4, 3);
        }
    }
    draw(ctx, owner) {
        if (this.spin <= 0)
            return;
        ctx.strokeStyle = `rgba(255,190,140,${this.spin * 3})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(owner.x, owner.y, this.radius() * 0.9, this.spin * 22, this.spin * 22 + Math.PI * 1.4);
        ctx.stroke();
    }
}
/** @class FireTrail @brief Deja llamas detrás del jugador mientras se mueve. */
class FireTrail extends Weapon {
    constructor() {
        super('Fire Trail', 6, 0.35, '#ff8a3d');
        this.last = { x: 1e9, y: 1e9 };
    }
    update(dt, owner, game) {
        this.timer -= dt;
        if (this.timer > 0 || dist(owner, this.last) < 22)
            return;
        this.timer = this.cd(owner);
        this.last = { x: owner.x, y: owner.y };
        game.add(new Flame(owner.x, owner.y, 18 + 2 * this.level, this.dmg(owner), 2 + 0.4 * this.level, owner.syn('thermalShock')));
    }
}
/* ------------------------------------------------------------------ */
/*  Habilidades                                                        */
/* ------------------------------------------------------------------ */
/** @class Skill @brief Habilidad activa con nivel y cooldown (Template Method: activate). */
class Skill {
    constructor(name, baseCooldown) {
        this.name = name;
        this.baseCooldown = baseCooldown;
        this.level = 1;
        this.maxLevel = SKILL_MAX;
        this.timer = 0;
        this.total = 1;
    }
    /** @brief Cooldown base reducido un 10% por nivel. */
    get cooldown() { return this.baseCooldown * Math.pow(0.9, this.level - 1); }
    /** @brief Progreso de recarga entre 0 y 1. */
    get ratio() { return 1 - Math.max(0, this.timer) / this.total; }
    upgrade() { this.level++; }
    update(dt) { if (this.timer > 0)
        this.timer -= dt; }
    tryUse(owner, game) {
        if (this.timer > 0)
            return;
        this.total = this.timer = this.cooldown * owner.cooldownMult;
        this.activate(owner, game);
    }
}
/** @class Nova @brief Daña a todos los enemigos en un radio; crece con el nivel. */
class Nova extends Skill {
    constructor() { super('Nova', 8); }
    activate(owner, game) {
        const L = this.level - 1, radius = 160 + 20 * L, dmg = (50 + 25 * L) * owner.mightTotal();
        game.add(new Ring(owner.x, owner.y, radius));
        for (const e of game.enemyList)
            if (dist(owner, e) < radius + e.radius)
                e.takeDamage(dmg, game);
    }
}
/** @class FrostPulse @brief Daña y ralentiza a los enemigos cercanos. */
class FrostPulse extends Skill {
    constructor() { super('Frost Pulse', 10); }
    activate(owner, game) {
        const L = this.level - 1, radius = 200 + 20 * L, dmg = (15 + 8 * L) * owner.mightTotal();
        game.add(new Ring(owner.x, owner.y, radius, '#8fd8ff'));
        for (const e of game.enemyList)
            if (dist(owner, e) < radius + e.radius) {
                e.freeze(2 + 0.5 * L);
                e.takeDamage(dmg, game);
            }
    }
}
/** @class BlinkDash @brief Salto en la dirección de movimiento: invulnerable y daña lo que cruza. */
class BlinkDash extends Skill {
    constructor() { super('Blink Dash', 5); }
    activate(owner, game) {
        const L = this.level - 1, d = 140 + 20 * L, dmg = (30 + 15 * L) * owner.mightTotal(), sx = owner.x, sy = owner.y;
        owner.x += owner.aim.x * d;
        owner.y += owner.aim.y * d;
        owner.invuln = 0.5 + 0.1 * L;
        for (const e of game.enemyList) {
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
                if (dist({ x: sx + (owner.x - sx) * t, y: sy + (owner.y - sy) * t }, e) < 40 + e.radius) {
                    e.takeDamage(dmg, game);
                    break;
                }
            }
        }
        game.add(new Ring(owner.x, owner.y, 50, '#7fe0ff'));
    }
}
/** @class MeteorStorm @brief Lluvia de meteoros sobre enemigos al azar (área de 60 px cada uno). */
class MeteorStorm extends Skill {
    constructor() { super('Meteor Storm', 12); }
    activate(owner, game) {
        const L = this.level - 1, dmg = (60 + 25 * L) * owner.mightTotal();
        const pool = game.enemyList.filter(e => e.alive && dist(owner, e) < 450);
        for (let i = 0; i < 4 + L; i++) {
            const t = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { x: owner.x + rand(-200, 200), y: owner.y + rand(-200, 200) };
            const c = { x: t.x, y: t.y };
            game.add(new Ring(c.x, c.y, 60, '#ff8a3d'));
            for (const e of game.enemyList)
                if (e.alive && dist(c, e) < 60 + e.radius)
                    e.takeDamage(dmg, game);
        }
    }
}
/** @class SmokeBomb @brief Bomba de humo: invulnerabilidad, velocidad y nube que ralentiza. */
class SmokeBomb extends Skill {
    constructor() { super('Smoke Bomb', 7); }
    activate(owner, game) {
        const L = this.level - 1, radius = 150 + 15 * L;
        owner.invuln = 1.6 + 0.2 * L;
        owner.haste = 3 + 0.4 * L;
        game.add(new Ring(owner.x, owner.y, radius, '#c8cad6'));
        for (const e of game.enemyList)
            if (dist(owner, e) < radius + e.radius)
                e.freeze(1.5 + 0.2 * L);
    }
}
/** @class Berserk @brief Furia: +40% daño y +25% velocidad, pero recibes +25% daño. */
class Berserk extends Skill {
    constructor() { super('Berserk', 14); }
    activate(owner, game) {
        const L = this.level - 1;
        owner.rageT = 6 + 0.6 * L;
        owner.heal(owner.maxHp * (0.12 + 0.02 * L));
        game.add(new Ring(owner.x, owner.y, 120 + 10 * L, '#ff6b5b'));
    }
}
/** @class RaiseDead @brief Invoca esqueletos aliados que luchan por ti. */
class RaiseDead extends Skill {
    constructor() { super('Raise Dead', 15); }
    activate(owner, game) {
        const L = this.level - 1;
        const n = 1 + Math.floor(this.level / 2) + (owner.syn('legion') ? 1 : 0) + (owner.hero.id === 'necromancer' ? 1 : 0);
        const dmg = (10 + 4 * L) * owner.mightTotal();
        const life = 12 + this.level;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            game.add(new Ally(owner.x + Math.cos(a) * 34, owner.y + Math.sin(a) * 34, dmg, life, owner.syn('legion')));
        }
        game.add(new Ring(owner.x, owner.y, 90, '#c8f5c0'));
    }
}
/** @class EntanglingRoots @brief Enraiza a los enemigos cercanos y los daña. */
class EntanglingRoots extends Skill {
    constructor() { super('Entangling Roots', 11); }
    activate(owner, game) {
        const L = this.level - 1, radius = 210 + 20 * L, dmg = (12 + 6 * L) * owner.mightTotal();
        game.add(new Ring(owner.x, owner.y, radius, '#7ad07a'));
        for (const e of game.enemyList)
            if (dist(owner, e) < radius + e.radius) {
                e.root(2 + 0.3 * L);
                e.takeDamage(dmg, game);
            }
    }
}
function shadow(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(0, 13, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
}
/** @class WizardPainter @brief Mago: sombrero puntiagudo, barba y bastón. */
class WizardPainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(10, -14, 3, 27);
        circle(ctx, 11.5, -16, 4, '#ffd966');
        ctx.translate(0, bob);
        ctx.fillStyle = '#3b6fd4';
        ctx.beginPath();
        ctx.moveTo(-10, 13);
        ctx.lineTo(10, 13);
        ctx.lineTo(6, -4);
        ctx.lineTo(-6, -4);
        ctx.fill();
        ctx.fillStyle = '#e0b84a';
        ctx.fillRect(-7, 3, 14, 2.5);
        circle(ctx, 0, -9, 6, '#f1c9a0');
        ctx.fillStyle = '#eee';
        ctx.beginPath();
        ctx.moveTo(-5, -7);
        ctx.lineTo(5, -7);
        ctx.lineTo(0, 5);
        ctx.fill();
        circle(ctx, -1.5, -10, 1.3, '#222');
        circle(ctx, 3.5, -10, 1.3, '#222');
        ctx.fillStyle = '#5b3fb5';
        ctx.beginPath();
        ctx.moveTo(-12, -12);
        ctx.lineTo(12, -12);
        ctx.lineTo(4, -31);
        ctx.fill();
        ctx.fillStyle = '#e0b84a';
        ctx.fillRect(-7, -15, 14, 2);
    }
}
/** @class KnightPainter @brief Caballero: armadura, yelmo con penacho, espada y escudo. */
class KnightPainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.fillStyle = '#cfd5df';
        ctx.fillRect(11, -18, 3, 22);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(8, 3, 9, 3);
        ctx.translate(0, bob);
        ctx.fillStyle = '#8a94a8';
        ctx.fillRect(-8, -4, 16, 17);
        ctx.fillStyle = '#5d6679';
        ctx.fillRect(-8, 8, 16, 3);
        ctx.fillStyle = '#3b6fd4';
        ctx.fillRect(-13, -3, 7, 14);
        ctx.fillStyle = '#e0b84a';
        ctx.fillRect(-11, 1, 3, 6);
        circle(ctx, 0, -10, 7.5, '#aab3c4');
        ctx.fillStyle = '#1b1f2a';
        ctx.fillRect(-1, -12, 8, 3);
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(-2, -17);
        ctx.lineTo(-13, -20);
        ctx.lineTo(-5, -11);
        ctx.fill();
    }
}
/** @class ClericPainter @brief Clérigo: túnica blanca con cruz, capucha, halo y maza. */
class ClericPainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(10, -8, 3, 21);
        circle(ctx, 11.5, -10, 4.5, '#e0b84a');
        ctx.translate(0, bob);
        ctx.fillStyle = '#eae6d8';
        ctx.beginPath();
        ctx.moveTo(-11, 13);
        ctx.lineTo(11, 13);
        ctx.lineTo(6, -4);
        ctx.lineTo(-6, -4);
        ctx.fill();
        ctx.fillStyle = '#e0b84a';
        ctx.fillRect(-1, 0, 2, 9);
        ctx.fillRect(-3.5, 3, 7, 2);
        circle(ctx, 0, -9, 6, '#f1c9a0');
        ctx.fillStyle = '#d6d0bd';
        ctx.beginPath();
        ctx.arc(0, -10, 7.5, Math.PI, 0);
        ctx.fill();
        circle(ctx, -1.5, -9, 1.3, '#222');
        circle(ctx, 3.5, -9, 1.3, '#222');
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -22, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
}
/** @class StormPainter @brief Invocador de tormentas: capa oscura, pelo en picos y chispa flotante. */
class StormPainter {
    draw(ctx, bob) {
        shadow(ctx);
        circle(ctx, 13, -8 + Math.sin(Date.now() / 150) * 2, 3.5, '#ffe96b');
        ctx.translate(0, bob);
        ctx.fillStyle = '#2c2f5a';
        ctx.beginPath();
        ctx.moveTo(-11, 13);
        ctx.lineTo(10, 13);
        ctx.lineTo(7, -4);
        ctx.lineTo(-7, -4);
        ctx.fill();
        ctx.fillStyle = '#ffe96b';
        ctx.beginPath();
        ctx.moveTo(1, 0);
        ctx.lineTo(-3, 6);
        ctx.lineTo(0, 6);
        ctx.lineTo(-1, 11);
        ctx.lineTo(4, 3);
        ctx.lineTo(1, 3);
        ctx.fill();
        circle(ctx, 0, -9, 6, '#e8b98f');
        ctx.beginPath();
        ctx.moveTo(-6, -11);
        ctx.lineTo(-8, -20);
        ctx.lineTo(-3, -15);
        ctx.lineTo(0, -23);
        ctx.lineTo(3, -15);
        ctx.lineTo(8, -20);
        ctx.lineTo(6, -11);
        ctx.fill();
        circle(ctx, -1.5, -9, 1.3, '#222');
        circle(ctx, 3.5, -9, 1.3, '#222');
    }
}
/** @class RoguePainter @brief Pícara: capucha morada, bufanda y dos dagas. */
class RoguePainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.translate(0, bob);
        ctx.fillStyle = '#4a3b6b';
        ctx.beginPath();
        ctx.moveTo(-9, 13);
        ctx.lineTo(9, 13);
        ctx.lineTo(6, -6);
        ctx.lineTo(-6, -6);
        ctx.fill();
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(-7, -2, 14, 3);
        ctx.fillStyle = '#e8cfae';
        ctx.fillRect(8, 2, 12, 3);
        ctx.fillStyle = '#cfd5df';
        ctx.beginPath();
        ctx.moveTo(20, 3.5);
        ctx.lineTo(28, 2);
        ctx.lineTo(28, 5);
        ctx.fill();
        circle(ctx, 0, -9, 6, '#f1c9a0');
        ctx.fillStyle = '#5b4a8a';
        ctx.beginPath();
        ctx.moveTo(-8, -8);
        ctx.arc(0, -9, 8, Math.PI, 0);
        ctx.lineTo(8, -2);
        ctx.lineTo(-8, -2);
        ctx.fill();
        circle(ctx, -1.5, -9, 1.3, '#222');
        circle(ctx, 3.5, -9, 1.3, '#222');
        ctx.fillStyle = '#2b2040';
        ctx.fillRect(-6, -7, 13, 2.5);
    }
}
/** @class BerserkerPainter @brief Bárbaro: torso desnudo, pinturas de guerra y hacha enorme. */
class BerserkerPainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.translate(0, bob);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(10, -14, 4, 26);
        ctx.fillStyle = '#d0d6e0';
        ctx.beginPath();
        ctx.moveTo(12, -14);
        ctx.lineTo(24, -18);
        ctx.lineTo(12, -4);
        ctx.fill();
        ctx.fillStyle = '#c98f6a';
        ctx.fillRect(-8, -4, 16, 17);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(-8, 2, 16, 3);
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(-8, 11, 16, 3);
        circle(ctx, 0, -10, 7.5, '#e8b98f');
        ctx.fillStyle = '#6b4a24';
        ctx.beginPath();
        ctx.arc(0, -11, 8.5, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#d9d2b0';
        ctx.beginPath();
        ctx.moveTo(-8, -14);
        ctx.lineTo(-14, -20);
        ctx.lineTo(-4, -17);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(8, -14);
        ctx.lineTo(14, -20);
        ctx.lineTo(4, -17);
        ctx.fill();
        circle(ctx, -2, -10, 1.4, '#222');
        circle(ctx, 3, -10, 1.4, '#222');
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, -5);
        ctx.lineTo(4, -5);
        ctx.stroke();
    }
}
/** @class NecroPainter @brief Nigromante: túnica oscura, calavera y llamas verdes. */
class NecroPainter {
    draw(ctx, bob) {
        shadow(ctx);
        circle(ctx, 12, -18 + Math.sin(Date.now() / 180) * 2, 4, 'rgba(120,255,150,.85)');
        ctx.translate(0, bob);
        ctx.fillStyle = '#2a2438';
        ctx.beginPath();
        ctx.moveTo(-11, 13);
        ctx.lineTo(11, 13);
        ctx.lineTo(6, -4);
        ctx.lineTo(-6, -4);
        ctx.fill();
        ctx.fillStyle = '#3d5a3a';
        ctx.fillRect(-7, 2, 14, 3);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(10, -10, 3, 23);
        circle(ctx, 11.5, -13, 5, '#e8e4d4');
        circle(ctx, 10, -14, 1.4, '#1b1b22');
        circle(ctx, 13, -14, 1.4, '#1b1b22');
        ctx.fillStyle = '#c8f5c0';
        ctx.beginPath();
        ctx.moveTo(-6, -14);
        ctx.lineTo(-3, -20);
        ctx.lineTo(0, -14);
        ctx.lineTo(3, -20);
        ctx.lineTo(6, -14);
        ctx.fill();
        circle(ctx, 0, -9, 6, '#cfd8c8');
        circle(ctx, -2, -9, 1.4, '#0d1a0d');
        circle(ctx, 3, -9, 1.4, '#0d1a0d');
    }
}
/** @class DruidPainter @brief Druida: capa de hojas, astas y cayado con enredadera. */
class DruidPainter {
    draw(ctx, bob) {
        shadow(ctx);
        ctx.fillStyle = '#6b4a24';
        ctx.fillRect(11, -12, 3, 25);
        circle(ctx, 12.5, -14, 4, '#7ad07a');
        ctx.translate(0, bob);
        ctx.fillStyle = '#3f6b3f';
        ctx.beginPath();
        ctx.moveTo(-11, 13);
        ctx.lineTo(11, 13);
        ctx.lineTo(6, -4);
        ctx.lineTo(-6, -4);
        ctx.fill();
        ctx.fillStyle = '#6aa84f';
        ctx.beginPath();
        ctx.moveTo(-9, 6);
        ctx.lineTo(-3, 0);
        ctx.lineTo(2, 8);
        ctx.lineTo(8, 1);
        ctx.lineTo(9, 13);
        ctx.lineTo(-11, 13);
        ctx.fill();
        circle(ctx, 0, -9, 6, '#e0c090');
        ctx.fillStyle = '#8a6a3a';
        ctx.beginPath();
        ctx.arc(0, -10, 7.5, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = '#d9d2b0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, -13);
        ctx.lineTo(-10, -22);
        ctx.moveTo(6, -13);
        ctx.lineTo(10, -22);
        ctx.stroke();
        circle(ctx, -1.5, -9, 1.3, '#2b2b1b');
        circle(ctx, 3.5, -9, 1.3, '#2b2b1b');
    }
}
/** @brief Crea una definición de héroe rellenando los nombres de arma y habilidad. */
function hero(def) {
    return { ...def, weaponName: def.weapon().name, skillName: def.skill().name };
}
/** @brief Héroes seleccionables: 4 iniciales y 4 desbloqueables por logros. */
const HEROES = [
    hero({ id: 'mage', name: 'Mage', desc: 'Equilibrado, proyectiles a distancia', perk: 'Sin bonos ni penalizaciones', maxHp: 100, speed: 160, might: 1, armor: 0, regen: 0, weapon: () => new MagicBolt(), skill: () => new Nova(), painter: new WizardPainter() }),
    hero({ id: 'knight', name: 'Knight', desc: 'Resistente, con armadura, algo lento', perk: 'Armadura 1 desde el inicio', maxHp: 140, speed: 148, might: 1, armor: 1, regen: 0, weapon: () => new OrbitBlades(), skill: () => new BlinkDash(), painter: new KnightPainter() }),
    hero({ id: 'cleric', name: 'Cleric', desc: 'Regenera y frena a las multitudes', perk: 'Regenera 0,5 HP/s', maxHp: 110, speed: 155, might: 1, armor: 0, regen: 0.5, weapon: () => new HolyAura(), skill: () => new FrostPulse(), painter: new ClericPainter() }),
    hero({ id: 'stormcaller', name: 'Stormcaller', desc: 'Rápido, frágil y con daño alto', perk: '+10% de daño', maxHp: 80, speed: 175, might: 1.1, armor: 0, regen: 0, weapon: () => new LightningStrike(), skill: () => new MeteorStorm(), painter: new StormPainter() }),
    hero({ id: 'rogue', name: 'Rogue', desc: 'Cuchillos rápidos y humo para escapar', perk: '+25% de XP ganada', maxHp: 90, speed: 172, might: 1, armor: 0, regen: 0, xpMult: 1.25, weapon: () => new ThrowingKnives(), skill: () => new SmokeBomb(), painter: new RoguePainter(), unlock: 'firstBlood' }),
    hero({ id: 'berserker', name: 'Berserker', desc: 'Cuerpo a cuerpo brutal y muy agresivo', perk: '+15% daño y +30% con la vida por debajo del 50%', maxHp: 130, speed: 158, might: 1.15, armor: 1, regen: 0, weapon: () => new Whirlwind(), skill: () => new Berserk(), painter: new BerserkerPainter(), unlock: 'arsenal' }),
    hero({ id: 'necromancer', name: 'Necromancer', desc: 'Espíritus óseos y esqueletos aliados', perk: 'Invoca 1 aliado extra con Raise Dead', maxHp: 95, speed: 152, might: 1.05, armor: 0, regen: 0.25, weapon: () => new BoneSpirits(), skill: () => new RaiseDead(), painter: new NecroPainter(), unlock: 'chemist' }),
    hero({ id: 'druid', name: 'Druid', desc: 'Tótems y raíces que frenan la horda', perk: 'Recoge gemas desde más lejos', maxHp: 115, speed: 158, might: 1, armor: 0, regen: 0.5, pickupRange: 110, weapon: () => new NatureTotem(), skill: () => new EntanglingRoots(), painter: new DruidPainter(), unlock: 'treasure10' }),
];
/** @brief Mapas seleccionables tras elegir héroe: 2 iniciales y 4 desbloqueables. */
const MAPS = [
    { id: 'field', name: 'Pradera', desc: 'Campo abierto sin peligros ambientales', hazards: 'Sin peligros', bg: '#1a2418', grid: '#22301f', accent: '#57c05a', deco: ['tree', 'flower', 'rock'], seed: 11, xp: 1, enemyHp: 1, enemySpeed: 1, spawn: 1 },
    { id: 'desert', name: 'Desierto', desc: 'Ráfagas de arena que empujan a todos', hazards: '+15% XP | Tormentas de arena', bg: '#2b2415', grid: '#3a301d', accent: '#e0c060', deco: ['cactus', 'dune', 'rock'], seed: 23, xp: 1.15, enemyHp: 1, enemySpeed: 1.05, spawn: 1, wind: true },
    { id: 'tundra', name: 'Tundra', desc: 'Hielo resbaladizo: cuesta frenar', hazards: '+10% XP | Suelo helado', bg: '#16202b', grid: '#1f2c39', accent: '#8fd8ff', deco: ['pine', 'ice', 'rock'], seed: 37, xp: 1.1, enemyHp: 1, enemySpeed: 0.92, spawn: 1, ice: true, unlock: 'survivor3' },
    { id: 'volcano', name: 'Volcán', desc: 'Charcas de lava que dañan a todos', hazards: '+25% XP | Lava | Enemigos +10% HP', bg: '#231114', grid: '#33201c', accent: '#ff7a3d', deco: ['crack', 'rock', 'crack'], seed: 51, xp: 1.25, enemyHp: 1.1, enemySpeed: 1, spawn: 1.05, lava: true, unlock: 'slayer' },
    { id: 'crypt', name: 'Cripta', desc: 'Oscuridad: apenas ves más allá de tu luz', hazards: '+30% XP | Enemigos +20% HP', bg: '#141220', grid: '#201d2e', accent: '#a58cff', deco: ['tomb', 'bone'], seed: 67, xp: 1.3, enemyHp: 1.2, enemySpeed: 1, spawn: 1, dark: true, unlock: 'level15' },
    { id: 'void', name: 'Abismo', desc: 'Grietas que absorben y oleadas mucho mayores', hazards: '+50% XP | Grietas | Más enemigos', bg: '#0d0a18', grid: '#1b1433', accent: '#c86bff', deco: ['crystal', 'crack'], seed: 83, xp: 1.5, enemyHp: 1.1, enemySpeed: 1.12, spawn: 1.35, rift: true, unlock: 'survivor8' },
];
/** @brief Modificador de XP de las bonificaciones meta (se aplica al crear al jugador). */
function bonusHp() { return unlocked('massacre') ? 25 : 0; }
/** @brief Rerolls disponibles por partida. */
function rerollBonus() { return clamp(1 + (unlocked('elite5') ? 1 : 0) + (unlocked('arsenal6') ? 1 : 0), 1, 3); }
/** @brief Dibuja una decoración determinista del mapa en coordenadas de mundo. */
function drawDeco(ctx, x, y, kind, v) {
    const s = 0.75 + v * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    switch (kind) {
        case 'tree':
            ctx.fillStyle = 'rgba(0,0,0,.25)';
            ctx.beginPath();
            ctx.ellipse(0, 6, 13, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#4a3418';
            ctx.fillRect(-3, -8, 6, 16);
            circle(ctx, 0, -16, 14, '#2f5c2a');
            circle(ctx, -7, -10, 9, '#356b2e');
            circle(ctx, 7, -11, 8, '#2a5226');
            break;
        case 'flower':
            circle(ctx, 0, 0, 3, v > 0.5 ? '#e8d16a' : '#d97ab0');
            circle(ctx, 3, -2, 2.4, '#e8e8ee');
            ctx.strokeStyle = 'rgba(120,180,120,.7)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(0, 2);
            ctx.lineTo(0, 9);
            ctx.stroke();
            break;
        case 'rock':
            ctx.fillStyle = 'rgba(0,0,0,.25)';
            ctx.beginPath();
            ctx.ellipse(0, 5, 13, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#585f6b';
            ctx.beginPath();
            ctx.moveTo(-11, 4);
            ctx.lineTo(-5, -9);
            ctx.lineTo(5, -11);
            ctx.lineTo(12, 4);
            ctx.fill();
            ctx.fillStyle = '#6d7684';
            ctx.beginPath();
            ctx.moveTo(-5, -9);
            ctx.lineTo(5, -11);
            ctx.lineTo(1, 4);
            ctx.fill();
            break;
        case 'cactus':
            ctx.fillStyle = 'rgba(0,0,0,.25)';
            ctx.beginPath();
            ctx.ellipse(0, 6, 11, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#3f7a44';
            ctx.fillRect(-4, -20, 9, 26);
            ctx.fillRect(-13, -12, 10, 6);
            ctx.fillRect(5, -17, 9, 6);
            ctx.fillStyle = '#4f9455';
            ctx.fillRect(-2, -20, 4, 26);
            break;
        case 'dune':
            ctx.fillStyle = 'rgba(190,165,100,.16)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 46, 16, 0, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'pine':
            ctx.fillStyle = 'rgba(0,0,0,.25)';
            ctx.beginPath();
            ctx.ellipse(0, 7, 13, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#4a3418';
            ctx.fillRect(-3, -4, 6, 12);
            ctx.fillStyle = '#2b4a3a';
            ctx.beginPath();
            ctx.moveTo(0, -30);
            ctx.lineTo(13, -2);
            ctx.lineTo(-13, -2);
            ctx.fill();
            ctx.fillStyle = 'rgba(230,245,255,.8)';
            ctx.beginPath();
            ctx.moveTo(0, -30);
            ctx.lineTo(7, -17);
            ctx.lineTo(-7, -17);
            ctx.fill();
            break;
        case 'ice':
            ctx.fillStyle = 'rgba(150,220,255,.22)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 34, 13, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(200,240,255,.35)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-22, 2);
            ctx.lineTo(0, -6);
            ctx.lineTo(20, 3);
            ctx.stroke();
            break;
        case 'crack':
            ctx.strokeStyle = `rgba(255,120,50,${0.25 + v * 0.35})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(-24, -6);
            ctx.lineTo(-8, 0);
            ctx.lineTo(2, -8);
            ctx.lineTo(16, -2);
            ctx.lineTo(26, -10);
            ctx.stroke();
            break;
        case 'tomb':
            ctx.fillStyle = 'rgba(0,0,0,.3)';
            ctx.beginPath();
            ctx.ellipse(0, 8, 13, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#565b68';
            ctx.fillRect(-9, -14, 18, 22);
            ctx.beginPath();
            ctx.arc(0, -14, 9, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#3e424c';
            ctx.fillRect(-2, -12, 4, 10);
            ctx.fillRect(-6, -9, 12, 4);
            break;
        case 'bone':
            ctx.fillStyle = 'rgba(226,222,206,.75)';
            ctx.fillRect(-9, -2, 18, 4);
            circle(ctx, -9, -2, 3, 'rgba(226,222,206,.75)');
            circle(ctx, 9, 2, 3, 'rgba(226,222,206,.75)');
            break;
        default:
            ctx.strokeStyle = `rgba(200,110,255,${0.3 + v * 0.3})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -18 - v * 10);
            ctx.lineTo(9, 0);
            ctx.lineTo(0, 20);
            ctx.lineTo(-9, 0);
            ctx.closePath();
            ctx.stroke();
            circle(ctx, 0, 0, 4, 'rgba(200,110,255,.5)');
            break;
    }
    ctx.restore();
}
/** @brief Cuenta cuántos elementos distintos hay entre una lista y un conjunto. */
const distinct = (list, set) => new Set([...list, ...set]).size;
/** @brief Catálogo de logros: cada uno desbloquea contenido o bonificaciones. */
const ACHIEVEMENTS = [
    { id: 'firstBlood', name: 'Primera Sangre', desc: 'Mata 25 enemigos en una sola partida', reward: 'Héroe: Rogue (y sus Throwing Knives)', goal: 25, group: 'Combate', value: (_s, r) => r.kills },
    { id: 'survivor3', name: 'Curtido', desc: 'Sobrevive 3 minutos', reward: 'Mapa: Tundra', goal: 180, group: 'Supervivencia', value: (s, r) => Math.max(s.bestTime, r.time) },
    { id: 'survivor8', name: 'Leyenda', desc: 'Sobrevive 8 minutos', reward: 'Mapa: Abismo', goal: 480, group: 'Supervivencia', value: (s, r) => Math.max(s.bestTime, r.time) },
    { id: 'level15', name: 'Veterano', desc: 'Alcanza el nivel 15', reward: 'Mapa: Cripta', goal: 15, group: 'Progreso', value: (s, r) => Math.max(s.bestLevel, r.level) },
    { id: 'slayer', name: 'Exterminador', desc: 'Acumula 1000 bajas en total', reward: 'Mapa: Volcán', goal: 1000, group: 'Combate', value: (s, r) => s.totalKills + r.kills },
    { id: 'arsenal', name: 'Arsenal', desc: 'Lleva 4 armas a la vez', reward: 'Héroe: Berserker (y Whirlwind)', goal: 4, group: 'Progreso', value: (s, r) => Math.max(s.maxWeapons, r.weapons) },
    { id: 'arsenal6', name: 'Coleccionista', desc: 'Lleva 6 armas a la vez', reward: '+1 reroll por partida (máximo 3)', goal: 6, group: 'Progreso', value: (s, r) => Math.max(s.maxWeapons, r.weapons) },
    { id: 'chemist', name: 'Química', desc: 'Activa 3 sinergias distintas en total', reward: 'Héroe: Necromancer (y Bone Spirits)', goal: 3, group: 'Sinergias', value: (s, r) => distinct(s.synergies, r.synergies) },
    { id: 'treasure10', name: 'Buscatesoros', desc: 'Abre 10 cofres en total', reward: 'Héroe: Druid (y Nature Totem)', goal: 10, group: 'Objetos', value: (s, r) => s.chests + r.chests },
    { id: 'untouched120', name: 'Intocable', desc: 'Aguanta 120 s seguidos sin recibir daño', reward: 'Arma: Boomerang Axe', goal: 120, group: 'Supervivencia', value: (s, r) => Math.max(s.bestNoHit, r.bestNoHit) },
    { id: 'elite5', name: 'Cazador de Élites', desc: 'Derrota 5 élites en una partida', reward: '+1 reroll por partida', goal: 5, group: 'Combate', value: (_s, r) => r.elites },
    { id: 'globetrotter', name: 'Trotamundos', desc: 'Juega una partida en cada mapa', reward: 'Empiezas cada partida con 2 armas', goal: MAPS.length, group: 'Mapas', value: (s, r) => distinct(s.maps, r.maps) },
    { id: 'massacre', name: 'Masacre', desc: 'Consigue 500 bajas en una partida', reward: '+25 de vida máxima inicial', goal: 500, group: 'Combate', value: (s, r) => Math.max(s.bestKills, r.kills) },
];
/** @brief Armas disponibles en las subidas de nivel (las bloqueadas no salen). */
const WEAPON_POOL = [
    { name: 'Magic Bolt', make: () => new MagicBolt() },
    { name: 'Orbit Blades', make: () => new OrbitBlades() },
    { name: 'Holy Aura', make: () => new HolyAura() },
    { name: 'Lightning', make: () => new LightningStrike() },
    { name: 'Fire Trail', make: () => new FireTrail() },
    { name: 'Garlic', make: () => new Garlic() },
    { name: 'Frost Wand', make: () => new FrostWand() },
    { name: 'Throwing Knives', make: () => new ThrowingKnives(), unlock: 'firstBlood' },
    { name: 'Whirlwind', make: () => new Whirlwind(), unlock: 'arsenal' },
    { name: 'Bone Spirits', make: () => new BoneSpirits(), unlock: 'chemist' },
    { name: 'Nature Totem', make: () => new NatureTotem(), unlock: 'treasure10' },
    { name: 'Boomerang Axe', make: () => new BoomerangAxe(), unlock: 'untouched120' },
];
/* ------------------------------------------------------------------ */
/*  Jugador                                                            */
/* ------------------------------------------------------------------ */
/** @brief Comprueba si un punto está dentro de un rectángulo. */
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** @brief Busca un logro por identificador. */
const achById = (id) => ACHIEVEMENTS.find(a => a.id === id);
/** @brief Formatea segundos como mm:ss. */
const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** @class Player @brief Héroe jugable compuesto por armas y una habilidad, con stats pasivas. */
class Player extends Entity {
    /** @param hero Definición del héroe elegido. */
    constructor(hero) {
        super(0, 0, 12);
        this.hero = hero;
        this.xp = 0;
        this.xpNext = 5;
        this.level = 1;
        this.pickupRange = 70;
        this.cooldownMult = 1;
        this.xpMult = 1;
        this.invuln = 0;
        /** @brief Segundos restantes de la nube de humo (más velocidad). */
        this.haste = 0;
        /** @brief Segundos restantes de furia (más daño, más velocidad, más daño recibido). */
        this.rageT = 0;
        this.aim = { x: 1, y: 0 };
        /** @brief Sinergias activas según las armas y la habilidad que lleves. */
        this.synergies = [];
        this.vx = 0;
        this.vy = 0;
        this.facing = 1;
        this.walk = 0;
        this.moving = false;
        this.weapons = [];
        this.hp = this.maxHp = hero.maxHp;
        this.speed = hero.speed;
        this.might = hero.might;
        this.armor = hero.armor;
        this.regen = hero.regen;
        this.xpMult = hero.xpMult ?? 1;
        this.pickupRange = hero.pickupRange ?? 70;
        this.skill = hero.skill();
        this.weapons.push(hero.weapon());
    }
    /** @brief true si lleva esa arma o esa habilidad (lo usan las sinergias). */
    has(name) { return this.skill.name === name || this.weapons.some(w => w.name === name); }
    /** @brief true si la sinergia indicada está activa. */
    syn(id) { return this.synergies.some(s => s.id === id); }
    /** @brief Daño total incluyendo furia y el bono del Berserker con poca vida. */
    mightTotal() {
        let m = this.might;
        if (this.hero.id === 'berserker' && this.hp < this.maxHp * 0.5)
            m *= 1.3;
        if (this.rageT > 0)
            m *= 1.4;
        return m;
    }
    /** @brief Velocidad total incluyendo bonificaciones temporales. */
    speedTotal() {
        let s = this.speed;
        if (this.haste > 0)
            s *= 1.4;
        if (this.rageT > 0)
            s *= 1.25;
        return s;
    }
    update(dt, game) {
        const k = game.input;
        const dx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        const dy = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
        const len = Math.hypot(dx, dy);
        const spd = this.speedTotal();
        if (game.map.ice) {
            // En la Tundra el héroe patina: aceleración y fricción en vez de movimiento directo.
            if (len > 0) {
                this.vx += (dx / len) * spd * 6 * dt;
                this.vy += (dy / len) * spd * 6 * dt;
            }
            const fr = Math.pow(0.25, dt);
            this.vx *= fr;
            this.vy *= fr;
            const v = Math.hypot(this.vx, this.vy);
            if (v > spd) {
                this.vx = (this.vx / v) * spd;
                this.vy = (this.vy / v) * spd;
            }
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.moving = Math.hypot(this.vx, this.vy) > 12;
        }
        else {
            this.vx = this.vy = 0;
            if (len > 0) {
                this.x += (dx / len) * spd * dt;
                this.y += (dy / len) * spd * dt;
            }
            this.moving = len > 0;
        }
        if (len > 0) {
            this.aim = { x: dx / len, y: dy / len };
            if (dx !== 0)
                this.facing = dx > 0 ? 1 : -1;
            this.walk += dt;
        }
        this.invuln -= dt;
        this.haste -= dt;
        this.rageT -= dt;
        if (this.regen > 0)
            this.heal(this.regen * dt);
        for (const w of this.weapons)
            w.update(dt, this, game);
        this.skill.update(dt);
        if (k.has('Space'))
            this.skill.tryUse(this, game);
        if (this.invuln > 0)
            return;
        for (const e of game.enemyList) {
            if (e.alive && dist(this, e) < this.radius + e.radius) {
                this.takeDamage(e.touchDamage, game);
                break;
            }
        }
    }
    /** @brief Cura sin pasar del máximo. */
    heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
    /** @brief Recibe daño reducido por la armadura (mínimo 1). */
    takeDamage(n, game) {
        if (this.invuln > 0 || !this.alive)
            return;
        const raw = n * (this.rageT > 0 ? 1.25 : 1);
        this.hp = Math.max(0, this.hp - Math.max(1, raw - this.armor));
        this.invuln = 0.5;
        game.onPlayerHit(raw);
        if (this.hp === 0) {
            this.alive = false;
            game.onDeath();
        }
    }
    /** @brief Daño ambiental (lava, grietas): ignora armadura e invulnerabilidad. */
    hurtRaw(n, game) {
        if (!this.alive)
            return;
        this.hp = Math.max(0, this.hp - n);
        game.onPlayerHit(n);
        if (this.hp === 0) {
            this.alive = false;
            game.onDeath();
        }
    }
    /** @brief Suma experiencia (con bono) y pide subidas de nivel. */
    addXp(v, game) {
        game.gemsCollected++;
        this.xp += v * this.xpMult;
        while (this.xp >= this.xpNext) {
            this.xp -= this.xpNext;
            this.level++;
            this.xpNext = Math.ceil(this.xpNext * 1.4) + 2;
            game.queueLevelUp();
        }
    }
    /** @brief Añade un arma y recalcula sinergias. */
    addWeapon(w, game) {
        this.weapons.push(w);
        this.refreshSynergies(game);
    }
    /** @brief Recalcula las sinergias activas y avisa de las que son nuevas. */
    refreshSynergies(game) {
        const before = new Set(this.synergies.map(s => s.id));
        this.synergies = SYNERGIES.filter(s => s.needs.every(n => this.has(n)));
        for (const s of this.synergies)
            if (!before.has(s.id))
                game.onSynergy(s);
    }
    /** @brief Dibuja armas y luego el héroe con su pintor; parpadea al ser invulnerable. */
    draw(ctx) {
        for (const w of this.weapons)
            w.draw(ctx, this);
        if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0)
            return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.facing, 1);
        if (this.rageT > 0)
            circle(ctx, 0, 0, 16, 'rgba(255,80,60,.25)');
        this.hero.painter.draw(ctx, this.moving ? Math.sin(this.walk * 12) * 1.5 : 0);
        ctx.restore();
    }
}
/** @class Game @brief Bucle principal, entrada, oleadas, mapas, logros y HUD. */
class Game {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.entities = [];
        this.enemyList = [];
        this.time = 0;
        this.kills = 0;
        this.gemsCollected = 0;
        this.state = 'select';
        this.hero = HEROES[0];
        this.map = MAPS[0];
        this.input = new Set();
        /** @brief Segundos que quedan de imán global (atrae todas las gemas). */
        this.magnet = 0;
        this.levelOptions = [];
        this.rerolls = 1;
        this.pendingLevelUps = 0;
        this.run = makeRunStats();
        this.lastRun = makeRunStats();
        this.runUnlocks = [];
        this.toasts = [];
        this.spawnTimer = 0;
        this.eliteTimer = 55;
        this.chestTimer = 90;
        this.lavaTimer = 5;
        this.riftTimer = 10;
        this.windT = 12;
        this.windGust = false;
        this.windDir = { x: 1, y: 0 };
        this.hurtFlash = 0;
        this.shake = 0;
        this.achTimer = 1;
        this.noHitTimer = 0;
        this.logrosOpen = false;
        this.logrosPage = 0;
        this.logrosBtn = { x: 0, y: 0, w: 0, h: 0 };
        this.last = 0;
        this.frame = (t) => {
            const dt = Math.min(0.05, (t - this.last) / 1000);
            this.last = t;
            this.update(dt);
            this.draw();
            requestAnimationFrame(this.frame);
        };
        const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
        resize();
        addEventListener('resize', resize);
        addEventListener('keydown', e => {
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code))
                e.preventDefault();
            this.input.add(e.code);
            if (!e.repeat)
                this.onKey(e.code);
        });
        addEventListener('keyup', e => this.input.delete(e.code));
        addEventListener('blur', () => this.input.clear());
        canvas.addEventListener('click', e => this.onClick(e.offsetX, e.offsetY));
        requestAnimationFrame(this.frame);
    }
    /* --------------------------- entrada --------------------------- */
    /** @brief Gestiona una pulsación según el estado actual. */
    onKey(code) {
        if (code === 'KeyL' || code === 'Tab') {
            this.toggleLogros();
            return;
        }
        if (this.logrosOpen) {
            if (code === 'Escape')
                this.toggleLogros();
            else if (code === 'ArrowDown' || code === 'PageDown')
                this.logrosPage++;
            else if (code === 'ArrowUp' || code === 'PageUp')
                this.logrosPage = Math.max(0, this.logrosPage - 1);
            return;
        }
        if (this.state === 'select') {
            const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(code);
            if (i >= 0)
                this.chooseHero(i);
        }
        else if (this.state === 'mapselect') {
            if (code === 'Escape' || code === 'Backspace') {
                this.state = 'select';
                return;
            }
            const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(code);
            if (i >= 0)
                this.chooseMap(i);
        }
        else if (this.state === 'levelup') {
            const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
            if (i >= 0)
                this.pick(i);
            else if (code === 'KeyR')
                this.rerollOptions();
        }
        else if (this.state === 'dead' && (code === 'KeyR' || code === 'Enter' || code === 'Space')) {
            this.state = 'select';
            this.input.clear();
        }
    }
    toggleLogros() {
        this.logrosOpen = !this.logrosOpen;
        if (this.logrosOpen)
            this.logrosPage = 0;
    }
    /** @brief Gestiona un clic sobre las tarjetas o los botones. */
    onClick(x, y) {
        if (this.logrosOpen) {
            const W = this.canvas.width, H = this.canvas.height;
            if (inRect({ x: W / 2 - 80, y: H - 56, w: 160, h: 36 }, x, y))
                this.toggleLogros();
            return;
        }
        if (inRect(this.logrosBtn, x, y)) {
            this.toggleLogros();
            return;
        }
        if (this.state === 'select') {
            const rects = this.heroRects();
            for (let i = 0; i < rects.length; i++)
                if (inRect(rects[i], x, y)) {
                    this.chooseHero(i);
                    return;
                }
        }
        else if (this.state === 'mapselect') {
            const rects = this.mapRects();
            for (let i = 0; i < rects.length; i++)
                if (inRect(rects[i], x, y)) {
                    this.chooseMap(i);
                    return;
                }
        }
        else if (this.state === 'levelup') {
            const rects = this.optionRects();
            for (let i = 0; i < rects.length; i++)
                if (inRect(rects[i], x, y)) {
                    this.pick(i);
                    return;
                }
        }
    }
    /** @brief Elige héroe; si está bloqueado, avisa con su logro. */
    chooseHero(i) {
        const h = HEROES[i];
        if (!h)
            return;
        if (!unlocked(h.unlock)) {
            const a = achById(h.unlock);
            this.toast(`Bloqueado: logro "${a ? a.name : h.unlock}"`, '#ff9a9a');
            return;
        }
        this.hero = h;
        this.state = 'mapselect';
    }
    /** @brief Elige mapa; si está bloqueado, avisa con su logro. */
    chooseMap(i) {
        const m = MAPS[i];
        if (!m)
            return;
        if (!unlocked(m.unlock)) {
            const a = achById(m.unlock);
            this.toast(`Bloqueado: logro "${a ? a.name : m.unlock}"`, '#ff9a9a');
            return;
        }
        this.reset(this.hero, m);
    }
    /* --------------------------- partida --------------------------- */
    /** @brief Reinicia la partida con el héroe y el mapa elegidos. */
    reset(hero, map) {
        this.entities = [];
        this.enemyList = [];
        this.time = 0;
        this.kills = 0;
        this.gemsCollected = 0;
        this.spawnTimer = 0;
        this.eliteTimer = 55;
        this.chestTimer = 90;
        this.lavaTimer = 5;
        this.riftTimer = 10;
        this.windT = 12;
        this.windGust = false;
        this.magnet = 0;
        this.hurtFlash = 0;
        this.shake = 0;
        this.pendingLevelUps = 0;
        this.levelOptions = [];
        this.toasts = [];
        this.runUnlocks = [];
        this.hero = hero;
        this.map = map;
        this.run = makeRunStats();
        this.run.maps.add(map.id);
        this.rerolls = rerollBonus();
        this.state = 'playing';
        this.player = new Player(hero);
        this.player.maxHp += bonusHp();
        this.player.hp = this.player.maxHp;
        this.player.xpMult *= map.xp;
        if (unlocked('globetrotter')) {
            const extras = WEAPON_POOL.filter(f => !f.unlock && f.name !== hero.weaponName);
            if (extras.length)
                this.player.addWeapon(pick(extras).make(), this);
        }
        this.player.refreshSynergies(this);
        this.input.clear();
        this.toast(`${hero.name} en ${map.name}`, map.accent);
    }
    add(e) { this.entities.push(e); }
    /** @brief Enemigo vivo más cercano a un punto. */
    nearestEnemy(from) {
        let best = null, bd = Infinity;
        for (const e of this.enemyList) {
            const d = dist(from, e);
            if (e.alive && d < bd) {
                bd = d;
                best = e;
            }
        }
        return best;
    }
    /** @brief Aviso flotante en pantalla. */
    toast(text, color = '#e8e8ee') {
        this.toasts.push({ text, color, t: 4.5 });
        if (this.toasts.length > 5)
            this.toasts.shift();
    }
    /** @brief Pide una subida de nivel (se acumulan si subes varias a la vez). */
    queueLevelUp() {
        this.pendingLevelUps++;
        if (this.state === 'playing')
            this.openLevelUp();
    }
    /** @brief Pausa el juego y ofrece 3 mejoras aleatorias (armas, habilidad o pasivas). */
    openLevelUp() {
        const pool = this.buildPool();
        if (pool.length === 0) {
            this.pendingLevelUps = 0;
            this.state = 'playing';
            return;
        }
        pool.sort(() => Math.random() - 0.5);
        this.levelOptions = pool.slice(0, 3);
        this.state = 'levelup';
    }
    /** @brief Todas las mejoras posibles actualmente. */
    buildPool() {
        const p = this.player, pool = [];
        for (const w of p.weapons)
            if (w.level < w.maxLevel)
                pool.push({ label: `${w.name} → Lv ${w.level + 1}`, apply: () => w.upgrade() });
        if (p.weapons.length < MAX_WEAPONS) {
            for (const f of WEAPON_POOL) {
                if (!unlocked(f.unlock) || p.weapons.some(w => w.name === f.name))
                    continue;
                pool.push({ label: `Nueva arma: ${f.name}`, hint: this.synergyHint(p, f.name), apply: () => p.addWeapon(f.make(), this) });
            }
        }
        if (p.skill.level < p.skill.maxLevel)
            pool.push({ label: `${p.skill.name} → Lv ${p.skill.level + 1}`, apply: () => p.skill.upgrade() });
        if (p.cooldownMult > 0.45)
            pool.push({ label: '-10% cooldowns', apply: () => { p.cooldownMult *= 0.9; } });
        if (p.armor < 5)
            pool.push({ label: '+1 armor', apply: () => { p.armor += 1; } });
        pool.push({ label: '+20 de vida máxima y cura completa', apply: () => { p.maxHp += 20; p.hp = p.maxHp; } }, { label: 'Cura el 40% de la vida', apply: () => { p.heal(p.maxHp * 0.4); } }, { label: '+15% daño', apply: () => { p.might += 0.15; } }, { label: '+15% velocidad', apply: () => { p.speed *= 1.15; } }, { label: '+40 rango de recogida', apply: () => { p.pickupRange += 40; } }, { label: '+0.5 vida/s regeneración', apply: () => { p.regen += 0.5; } }, { label: '+20% XP ganada', apply: () => { p.xpMult += 0.2; } });
        return pool;
    }
    /** @brief Texto que avisa de la sinergia que se activaría al coger un arma. */
    synergyHint(p, added) {
        const has = (n) => n === added || p.has(n);
        const news = SYNERGIES.filter(s => !p.syn(s.id) && s.needs.every(has));
        return news.length > 0 ? 'Activa sinergia: ' + news.map(s => s.name).join(' + ') : undefined;
    }
    pick(i) {
        const o = this.levelOptions[i];
        if (!o)
            return;
        o.apply();
        this.player.refreshSynergies(this);
        this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
        if (this.pendingLevelUps > 0)
            this.openLevelUp();
        else {
            this.levelOptions = [];
            this.state = 'playing';
        }
        this.checkAchievements();
    }
    /** @brief Vuelve a tirar las opciones de subida gastando un reroll. */
    rerollOptions() {
        if (this.rerolls <= 0) {
            this.toast('No te quedan rerolls', '#ff9a9a');
            return;
        }
        this.rerolls--;
        this.openLevelUp();
    }
    /** @brief Recoge un objeto del suelo. */
    collect(kind) {
        const p = this.player;
        if (kind === 'heart') {
            const before = p.hp;
            p.heal(Math.max(20, p.maxHp * 0.25));
            this.toast(`+${Math.round(p.hp - before)} vida`, '#ff7b7b');
        }
        else if (kind === 'magnet') {
            this.magnet = 3;
            this.toast('¡Imán! Todas las gemas vienen hacia ti', '#7fd8ff');
        }
        else if (kind === 'bomb') {
            this.explodeBomb();
        }
        else {
            this.openChest();
        }
    }
    /** @brief Bomba: daña y empuja a todos los enemigos cercanos. */
    explodeBomb() {
        this.toast('¡Bomba!', '#ffb03a');
        this.add(new Ring(this.player.x, this.player.y, 320, '#ffb03a'));
        this.shake = 8;
        for (const e of this.enemyList) {
            if (!e.alive || dist(this.player, e) > 320)
                continue;
            const d = dist(this.player, e) || 1;
            e.knock(this.player, 60);
            e.takeDamage(80 * (1 + d / 320), this);
        }
    }
    /** @brief Cofre: concede una mejora aleatoria gratis. */
    openChest() {
        this.run.chests++;
        const pool = this.buildPool();
        if (pool.length === 0)
            this.player.addXp(25, this);
        else {
            const u = pick(pool);
            u.apply();
            this.player.refreshSynergies(this);
            this.toast('Cofre: ' + u.label, '#ffd76a');
        }
        this.checkAchievements();
    }
    /** @brief Avisa de que se ha activado una sinergia. */
    onSynergy(s) {
        this.run.synergies.add(s.id);
        this.toast(`Sinergia activa: ${s.name}`, '#ffd76a');
        this.checkAchievements();
    }
    /** @brief Un enemigo ha muerto: gemas, botín y contadores. */
    onKill(e) {
        this.kills++;
        const gems = e.elite ? 3 : 1;
        for (let i = 0; i < gems; i++) {
            this.add(new Gem(e.x + rand(-9, 9), e.y + rand(-9, 9), e.elite ? Math.ceil(e.xp / gems) : e.xp));
        }
        if (e.elite) {
            this.run.elites++;
            this.add(new Pickup(e.x, e.y, 'chest'));
            this.toast('¡Élite derrotada!', '#ffd76a');
            this.add(new Ring(e.x, e.y, e.radius * 3, '#ffd76a'));
        }
        else {
            const r = Math.random();
            if (r < 0.03)
                this.add(new Pickup(e.x, e.y, 'heart'));
            else if (r < 0.045)
                this.add(new Pickup(e.x, e.y, 'magnet'));
            else if (r < 0.055)
                this.add(new Pickup(e.x, e.y, 'bomb'));
            if (e.radius > 14)
                this.add(new Ring(e.x, e.y, e.radius * 2.2, 'rgba(255,255,255,.5)'));
        }
        if (e instanceof Golem)
            for (let i = 0; i < 3; i++)
                this.add(this.makeEnemy(Bat, e.x + rand(-24, 24), e.y + rand(-24, 24)));
    }
    /** @brief El jugador ha recibido daño: se corta la racha y tiembla la pantalla. */
    onPlayerHit(dmg) {
        this.run.noHit = 0;
        this.noHitTimer = 0;
        this.hurtFlash = Math.min(0.5, this.hurtFlash + 0.25);
        this.shake = Math.min(9, this.shake + 1.5 + dmg * 0.15);
    }
    /** @brief El jugador ha muerto: cierra la partida y guarda el progreso. */
    onDeath() {
        this.state = 'dead';
        this.shake = 9;
        this.hurtFlash = 0.6;
        this.finishRun();
        this.checkAchievements();
    }
    /** @brief Vuelca las estadísticas de la partida en el progreso persistente. */
    finishRun() {
        const s = PROGRESS.stats, r = this.run;
        s.runs += 1;
        s.totalKills += this.kills;
        s.totalTime += this.time;
        s.bestTime = Math.max(s.bestTime, this.time);
        s.bestKills = Math.max(s.bestKills, this.kills);
        s.bestLevel = Math.max(s.bestLevel, this.player.level);
        s.maxWeapons = Math.max(s.maxWeapons, this.player.weapons.length);
        s.chests += r.chests;
        s.elites += r.elites;
        s.gems += this.gemsCollected;
        s.bestNoHit = Math.max(s.bestNoHit, r.bestNoHit);
        for (const id of r.synergies)
            if (!s.synergies.includes(id))
                s.synergies.push(id);
        for (const id of r.maps)
            if (!s.maps.includes(id))
                s.maps.push(id);
        if (!s.heroes.includes(this.hero.id))
            s.heroes.push(this.hero.id);
        PROGRESS.save();
        this.lastRun = { ...r, synergies: new Set(r.synergies), maps: new Set(r.maps) };
        this.run = makeRunStats();
    }
    /** @brief Revisa los logros pendientes y avisa de los nuevos. */
    checkAchievements() {
        if (this.player) {
            this.run.time = this.time;
            this.run.level = this.player.level;
            this.run.weapons = this.player.weapons.length;
        }
        for (const a of ACHIEVEMENTS) {
            if (PROGRESS.has(a.id))
                continue;
            if (a.value(PROGRESS.stats, this.run) >= a.goal && PROGRESS.unlock(a.id)) {
                this.runUnlocks.push(a);
                this.toast(`¡Logro desbloqueado! ${a.name} → ${a.reward}`, '#ffd76a');
            }
        }
    }
    /* --------------------------- oleadas --------------------------- */
    /** @brief Tipos de enemigo disponibles según el tiempo de partida. */
    eligibleKinds() {
        const t = this.time;
        const kinds = [Bat];
        if (t > 20)
            kinds.push(Skeleton);
        if (t > 45)
            kinds.push(Spitter);
        if (t > 60)
            kinds.push(Brute);
        if (t > 90)
            kinds.push(Wraith);
        if (t > 150)
            kinds.push(Golem);
        return kinds;
    }
    /** @brief Sorteo ponderado de enemigo: cuanto más tarde, más variedad y dureza. */
    pickKind() {
        const t = this.time;
        const table = [{ ctor: Bat, w: 40 }];
        if (t > 20)
            table.push({ ctor: Skeleton, w: 34 });
        if (t > 45)
            table.push({ ctor: Spitter, w: 13 });
        if (t > 60)
            table.push({ ctor: Brute, w: 12 });
        if (t > 90)
            table.push({ ctor: Wraith, w: 14 });
        if (t > 150)
            table.push({ ctor: Golem, w: 10 });
        let total = 0;
        for (const o of table)
            total += o.w;
        let r = Math.random() * total;
        for (const o of table) {
            r -= o.w;
            if (r <= 0)
                return o.ctor;
        }
        return Bat;
    }
    /** @brief Crea un enemigo ya afectado por los modificadores del mapa. */
    makeEnemy(ctor, x, y) {
        const e = new ctor(x, y, this.time);
        e.applyMods(this.map.enemyHp, this.map.enemySpeed);
        return e;
    }
    spawn(dt) {
        this.eliteTimer -= dt;
        if (this.eliteTimer <= 0) {
            this.eliteTimer = 75;
            const a = rand(0, Math.PI * 2), r = Math.max(this.canvas.width, this.canvas.height) / 2 + 60;
            const e = this.makeEnemy(this.pickKind(), this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r);
            e.makeElite();
            this.add(e);
            this.toast('¡Élite en camino!', '#ffd76a');
        }
        this.chestTimer -= dt;
        if (this.chestTimer <= 0) {
            this.chestTimer = 95;
            const a = rand(0, Math.PI * 2), r = rand(200, 300);
            this.add(new Pickup(this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r, 'chest'));
            this.toast('Ha aparecido un cofre', '#ffd76a');
        }
        this.spawnTimer -= dt;
        if (this.spawnTimer > 0 || this.enemyList.length >= 320)
            return;
        this.spawnTimer = Math.max(0.1, 1 - this.time / 120) / this.map.spawn;
        const a = rand(0, Math.PI * 2), r = Math.max(this.canvas.width, this.canvas.height) / 2 + 40;
        this.add(this.makeEnemy(this.pickKind(), this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r));
    }
    /** @brief Peligros y clima del mapa (lava, grietas, tormenta de arena). */
    updateHazards(dt) {
        const m = this.map;
        if (m.lava) {
            this.lavaTimer -= dt;
            if (this.lavaTimer <= 0) {
                this.lavaTimer = 6.5;
                if (this.entities.filter(e => e instanceof LavaPool && e.alive).length < 6) {
                    const a = rand(0, Math.PI * 2), r = rand(130, 440);
                    this.add(new LavaPool(this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r, rand(58, 86)));
                }
            }
        }
        if (m.rift) {
            this.riftTimer -= dt;
            if (this.riftTimer <= 0) {
                this.riftTimer = 16;
                if (this.entities.filter(e => e instanceof VoidRift && e.alive).length < 3) {
                    const a = rand(0, Math.PI * 2), r = rand(150, 380);
                    this.add(new VoidRift(this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r));
                    this.toast('¡Grieta del Abismo!', '#c86bff');
                }
            }
        }
        if (m.wind) {
            this.windT -= dt;
            if (this.windT <= 0) {
                this.windGust = !this.windGust;
                this.windT = this.windGust ? 3.5 : 9;
                if (this.windGust) {
                    const a = rand(0, Math.PI * 2);
                    this.windDir = { x: Math.cos(a), y: Math.sin(a) };
                    this.toast('¡Ráfaga de arena!', '#e0c060');
                }
            }
            if (this.windGust) {
                const fx = this.windDir.x * 130 * dt, fy = this.windDir.y * 130 * dt;
                for (const e of this.enemyList)
                    if (e.alive) {
                        e.x += fx;
                        e.y += fy;
                    }
                this.player.x += this.windDir.x * 50 * dt;
                this.player.y += this.windDir.y * 50 * dt;
            }
        }
    }
    /** @brief Separación suave entre enemigos para que rodeen al jugador en vez de apilarse. */
    separate() {
        const en = this.enemyList;
        for (let i = 0; i < en.length; i++) {
            for (let j = i + 1; j < en.length; j++) {
                const a = en[i], b = en[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy), m = a.radius + b.radius;
                if (d === 0) {
                    a.x += 0.1;
                    continue;
                }
                if (d < m) {
                    const f = ((m - d) / (2 * d)) * 0.5;
                    a.x += dx * f;
                    a.y += dy * f;
                    b.x -= dx * f;
                    b.y -= dy * f;
                }
            }
        }
    }
    update(dt) {
        for (const t of this.toasts)
            t.t -= dt;
        this.toasts = this.toasts.filter(t => t.t > 0);
        this.hurtFlash = Math.max(0, this.hurtFlash - dt);
        this.shake = Math.max(0, this.shake - dt * 12);
        if (this.logrosOpen || this.state !== 'playing')
            return;
        this.time += dt;
        this.magnet = Math.max(0, this.magnet - dt);
        this.updateHazards(dt);
        this.enemyList = this.entities.filter((e) => e instanceof Enemy);
        this.spawn(dt);
        this.separate();
        this.player.update(dt, this);
        for (const e of this.entities)
            e.update(dt, this);
        this.entities = this.entities.filter(e => e.alive);
        this.noHitTimer += dt;
        if (this.noHitTimer >= 1) {
            this.noHitTimer -= 1;
            this.run.noHit += 1;
            this.run.bestNoHit = Math.max(this.run.bestNoHit, this.run.noHit);
        }
        this.achTimer -= dt;
        if (this.achTimer <= 0) {
            this.achTimer = 0.5;
            this.checkAchievements();
        }
    }
    /* --------------------------- dibujo --------------------------- */
    /** @brief Rejilla de tarjetas para las pantallas de selección. */
    gridRects(n, cols, top, h, gap = 14) {
        const W = this.canvas.width;
        const w = Math.min(230, (W - 40 - gap * (cols - 1)) / cols);
        const totalW = cols * w + (cols - 1) * gap;
        const x0 = (W - totalW) / 2;
        const out = [];
        for (let i = 0; i < n; i++) {
            const r = Math.floor(i / cols), c = i % cols;
            out.push({ x: x0 + c * (w + gap), y: top + r * (h + gap), w, h });
        }
        return out;
    }
    heroRects() {
        const H = this.canvas.height, rows = Math.ceil(HEROES.length / 4);
        const h = Math.min(232, (H - 150 - 14 * (rows - 1)) / rows);
        return this.gridRects(HEROES.length, 4, 96, h);
    }
    mapRects() {
        const H = this.canvas.height;
        const h = Math.min(240, (H - 150) / 2);
        return this.gridRects(MAPS.length, 3, 96, h);
    }
    optionRects() {
        const H = this.canvas.height, h = 150;
        return this.gridRects(this.levelOptions.length, 3, H / 2 - h / 2, h);
    }
    /** @brief Dibuja una tarjeta con marco y contenido. */
    card(r, highlight, locked) {
        const ctx = this.ctx;
        ctx.fillStyle = locked ? '#1a1d26' : '#232838';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = locked ? '#3a4050' : highlight ? '#ffd76a' : '#4aa3ff';
        ctx.lineWidth = highlight ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1;
    }
    /** @brief Dibuja un candado en la tarjeta de contenido bloqueado. */
    lock(ctx, x, y) {
        ctx.strokeStyle = '#8a90a2';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y - 5, 6, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#8a90a2';
        ctx.fillRect(x - 9, y - 5, 18, 14);
        ctx.fillStyle = '#1a1d26';
        circle(ctx, x, y + 1, 2.6, '#1a1d26');
        ctx.lineWidth = 1;
    }
    /** @brief Texto centrado que se recorta al ancho disponible. */
    ctext(t, x, y, maxW) {
        const ctx = this.ctx;
        ctx.fillText(t, x, y, maxW);
    }
    /** @brief Pantalla de selección de héroe. */
    drawHeroSelect(W, H) {
        const ctx = this.ctx;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText('Elige tu héroe (clic o teclas 1-8)', W / 2, 52);
        ctx.fillStyle = '#8a90a2';
        ctx.font = '13px sans-serif';
        ctx.fillText('L: Logros   |   Los héroes con candado se desbloquean con logros', W / 2, 74);
        const rects = this.heroRects();
        HEROES.forEach((h, i) => {
            const r = rects[i], locked = !unlocked(h.unlock), a = h.unlock ? achById(h.unlock) : undefined;
            this.card(r, false, locked);
            ctx.save();
            ctx.globalAlpha = locked ? 0.25 : 1;
            ctx.translate(r.x + r.w / 2, r.y + 62);
            ctx.scale(1.9, 1.9);
            h.painter.draw(ctx, 0);
            ctx.restore();
            ctx.fillStyle = locked ? '#7a8090' : '#fff';
            ctx.font = 'bold 17px sans-serif';
            this.ctext(`${i + 1}. ${h.name}`, r.x + r.w / 2, r.y + 118, r.w - 16);
            if (locked) {
                this.lock(ctx, r.x + r.w / 2, r.y + 62);
                ctx.fillStyle = '#ff9a9a';
                ctx.font = '12px sans-serif';
                this.ctext(`Logro: ${a ? a.name : h.unlock}`, r.x + r.w / 2, r.y + 142, r.w - 16);
                const cur = a ? Math.min(a.goal, a.value(PROGRESS.stats, this.run)) : 0;
                ctx.fillStyle = '#aab3c8';
                this.ctext(`${Math.floor(cur)} / ${a ? a.goal : 0}`, r.x + r.w / 2, r.y + 160, r.w - 16);
                ctx.fillStyle = '#8a90a2';
                this.ctext(a ? a.desc : '', r.x + r.w / 2, r.y + 180, r.w - 16);
            }
            else {
                ctx.fillStyle = '#aab3c8';
                ctx.font = '12px sans-serif';
                this.ctext(`HP ${h.maxHp}   Vel ${h.speed}   Daño x${h.might}`, r.x + r.w / 2, r.y + 138, r.w - 16);
                this.ctext(`Arma: ${h.weaponName}`, r.x + r.w / 2, r.y + 156, r.w - 16);
                this.ctext(`Habilidad: ${h.skillName}`, r.x + r.w / 2, r.y + 172, r.w - 16);
                ctx.fillStyle = '#8fd8ff';
                this.ctext(h.perk, r.x + r.w / 2, r.y + 196, r.w - 16);
            }
        });
        ctx.fillStyle = '#8a90a2';
        ctx.font = '13px sans-serif';
        ctx.fillText('WASD / flechas: moverte   |   Espacio: habilidad   |   Las armas disparan solas', W / 2, H - 34);
    }
    /** @brief Pantalla de selección de mapa (después del héroe). */
    drawMapSelect(W, H) {
        const ctx = this.ctx;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(`Elige mapa para ${this.hero.name} (clic o teclas 1-6)`, W / 2, 52);
        ctx.fillStyle = '#8a90a2';
        ctx.font = '13px sans-serif';
        ctx.fillText('Cada mapa cambia el entorno, los enemigos y la experiencia   |   Esc: volver', W / 2, 74);
        const rects = this.mapRects();
        MAPS.forEach((m, i) => {
            const r = rects[i], locked = !unlocked(m.unlock), a = m.unlock ? achById(m.unlock) : undefined;
            this.card(r, false, locked);
            // Miniatura del terreno
            const px = r.x + 12, py = r.y + 12, pw = r.w - 24, ph = 64;
            ctx.save();
            ctx.beginPath();
            ctx.rect(px, py, pw, ph);
            ctx.clip();
            ctx.fillStyle = locked ? '#15171e' : m.bg;
            ctx.fillRect(px, py, pw, ph);
            ctx.strokeStyle = m.grid;
            ctx.beginPath();
            for (let x = px; x < px + pw; x += 16) {
                ctx.moveTo(x, py);
                ctx.lineTo(x, py + ph);
            }
            for (let y = py; y < py + ph; y += 16) {
                ctx.moveTo(px, y);
                ctx.lineTo(px + pw, y);
            }
            ctx.stroke();
            if (!locked) {
                for (let k = 0; k < 6; k++) {
                    const v = hash2(k, i, m.seed);
                    drawDeco(ctx, px + 14 + v * (pw - 28), py + 14 + hash2(k, i + 4, m.seed) * (ph - 28), m.deco[k % m.deco.length], 0.4);
                }
            }
            ctx.restore();
            ctx.strokeStyle = locked ? '#3a4050' : m.accent;
            ctx.strokeRect(px, py, pw, ph);
            ctx.fillStyle = locked ? '#7a8090' : '#fff';
            ctx.font = 'bold 16px sans-serif';
            this.ctext(`${i + 1}. ${m.name}`, r.x + r.w / 2, r.y + 98, r.w - 16);
            ctx.fillStyle = '#aab3c8';
            ctx.font = '12px sans-serif';
            this.ctext(m.desc, r.x + r.w / 2, r.y + 118, r.w - 16);
            ctx.fillStyle = m.accent;
            this.ctext(m.hazards, r.x + r.w / 2, r.y + 138, r.w - 16);
            if (locked) {
                this.lock(ctx, r.x + r.w / 2, r.y + 40);
                ctx.fillStyle = '#ff9a9a';
                ctx.font = '12px sans-serif';
                this.ctext(`Logro: ${a ? a.name : m.unlock}`, r.x + r.w / 2, r.y + 166, r.w - 16);
                const cur = a ? Math.min(a.goal, a.value(PROGRESS.stats, this.run)) : 0;
                ctx.fillStyle = '#aab3c8';
                this.ctext(`${Math.floor(cur)} / ${a ? a.goal : 0}`, r.x + r.w / 2, r.y + 184, r.w - 16);
            }
            else {
                ctx.fillStyle = '#8a90a2';
                ctx.font = '11px sans-serif';
                this.ctext(`Enemigos x${m.enemyHp.toFixed(2)} vida  ·  x${m.enemySpeed.toFixed(2)} velocidad  ·  oleadas x${m.spawn.toFixed(2)}`, r.x + r.w / 2, r.y + 162, r.w - 16);
                this.ctext(`XP x${m.xp.toFixed(2)}`, r.x + r.w / 2, r.y + 180, r.w - 16);
            }
        });
    }
    /** @brief Ventana "Logros": progreso y recompensas. */
    drawLogros(W, H) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(6,8,12,.94)';
        ctx.fillRect(0, 0, W, H);
        const done = ACHIEVEMENTS.filter(a => PROGRESS.has(a.id)).length;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd76a';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('LOGROS', W / 2, 48);
        ctx.fillStyle = '#aab3c8';
        ctx.font = '13px sans-serif';
        ctx.fillText(`${done} / ${ACHIEVEMENTS.length} desbloqueados  ·  desbloquean héroes, mapas, armas y ventajas de partida`, W / 2, 70);
        const cols = W >= 820 ? 2 : 1;
        const rowH = 70, top = 88;
        const perCol = Math.max(1, Math.floor((H - top - 80) / rowH));
        const perPage = Math.max(1, perCol * cols);
        const pages = Math.max(1, Math.ceil(ACHIEVEMENTS.length / perPage));
        this.logrosPage = clamp(this.logrosPage, 0, pages - 1);
        const start = this.logrosPage * perPage;
        const colW = Math.min(600, (W - 60) / cols);
        for (let i = start; i < Math.min(ACHIEVEMENTS.length, start + perPage); i++) {
            const idx = i - start;
            const x = (W - colW * cols) / 2 + Math.floor(idx / perCol) * colW;
            const y = top + (idx % perCol) * rowH;
            this.drawAchievementRow(ACHIEVEMENTS[i], x, y, colW - 18);
        }
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#8a90a2';
        const foot = pages > 1 ? `↑ / ↓: cambiar de página (${this.logrosPage + 1}/${pages})` : '';
        ctx.fillText(foot, W / 2, H - 66);
        const btn = { x: W / 2 - 80, y: H - 56, w: 160, h: 36 };
        ctx.fillStyle = '#232838';
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
        ctx.strokeStyle = '#4aa3ff';
        ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
        ctx.fillStyle = '#fff';
        ctx.font = '15px sans-serif';
        ctx.fillText('Cerrar (L / Esc)', W / 2, btn.y + 23);
    }
    /** @brief Fila de un logro: estado, progreso, recompensa. */
    drawAchievementRow(a, x, y, w) {
        const ctx = this.ctx;
        const got = PROGRESS.has(a.id);
        const cur = Math.min(a.goal, a.value(PROGRESS.stats, this.run));
        ctx.fillStyle = got ? '#1e2a1e' : '#1a1d26';
        ctx.fillRect(x, y, w, 64);
        ctx.strokeStyle = got ? '#ffd76a' : '#3a4050';
        ctx.strokeRect(x, y, w, 64);
        ctx.textAlign = 'left';
        if (got)
            circle(ctx, x + 16, y + 20, 7, '#ffd76a');
        else {
            ctx.strokeStyle = '#5a6070';
            ctx.beginPath();
            ctx.arc(x + 16, y + 20, 7, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = got ? '#ffd76a' : '#e8e8ee';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(a.name, x + 32, y + 25, w - 44);
        ctx.fillStyle = '#aab3c8';
        ctx.font = '12px sans-serif';
        ctx.fillText(a.desc, x + 12, y + 43, w - 24);
        const barW = Math.min(160, w * 0.4);
        ctx.fillStyle = '#2a2f3d';
        ctx.fillRect(x + 12, y + 52, barW, 8);
        ctx.fillStyle = got ? '#ffd76a' : '#4aa3ff';
        ctx.fillRect(x + 12, y + 52, barW * (cur / a.goal), 8);
        ctx.fillStyle = '#8a90a2';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${Math.floor(cur)} / ${a.goal}`, x + 12 + barW + 8, y + 60);
        ctx.fillStyle = got ? '#ffd76a' : '#7a8090';
        ctx.textAlign = 'right';
        ctx.fillText((got ? 'Recompensa: ' : 'Desbloquea: ') + a.reward, x + w - 12, y + 60, w * 0.5);
        ctx.textAlign = 'left';
    }
    /** @brief Rejilla del suelo. */
    drawGrid(ctx, p, W, H) {
        ctx.strokeStyle = this.map.grid;
        ctx.lineWidth = 1;
        const g = 64, x0 = Math.floor((p.x - W / 2) / g) * g, y0 = Math.floor((p.y - H / 2) / g) * g;
        ctx.beginPath();
        for (let x = x0; x < p.x + W / 2 + g; x += g) {
            ctx.moveTo(x, p.y - H / 2 - g);
            ctx.lineTo(x, p.y + H / 2 + g);
        }
        for (let y = y0; y < p.y + H / 2 + g; y += g) {
            ctx.moveTo(p.x - W / 2 - g, y);
            ctx.lineTo(p.x + W / 2 + g, y);
        }
        ctx.stroke();
    }
    /** @brief Decoración determinista del mapa (solo lo que se ve). */
    drawDecorations(ctx, view) {
        const m = this.map, cell = 96;
        const x0 = Math.floor(view.x / cell), x1 = Math.ceil((view.x + view.w) / cell);
        const y0 = Math.floor(view.y / cell), y1 = Math.ceil((view.y + view.h) / cell);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const v = hash2(cx, cy, m.seed);
                if (v > 0.35)
                    continue;
                const v2 = hash2(cx + 7, cy - 3, m.seed);
                const v3 = hash2(cx - 5, cy + 11, m.seed);
                const kind = m.deco[Math.floor(v3 * m.deco.length) % m.deco.length];
                drawDeco(ctx, cx * cell + v2 * cell, cy * cell + v3 * cell, kind, v);
            }
        }
    }
    /** @brief Ráfaga de arena del desierto. */
    drawWind(ctx) {
        const W = this.canvas.width, H = this.canvas.height;
        const t = this.time * 620;
        ctx.strokeStyle = 'rgba(230,205,140,.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 70; i++) {
            const h1 = hash2(i, 3, 91), h2 = hash2(i, 5, 91);
            const len = 26 + h1 * 50;
            const wx = this.player.x - W / 2, wy = this.player.y - H / 2;
            const px = wx + (((h1 * W + this.windDir.x * t) % W) + W) % W;
            const py = wy + (((h2 * H + this.windDir.y * t) % H) + H) % H;
            ctx.moveTo(px, py);
            ctx.lineTo(px + this.windDir.x * len, py + this.windDir.y * len);
        }
        ctx.stroke();
    }
    /** @brief Oscuridad de la Cripta: solo ves alrededor del héroe. */
    drawDarkness(W, H) {
        const ctx = this.ctx;
        const R = Math.min(W, H) * 0.5;
        const g = ctx.createRadialGradient(W / 2, H / 2, R * 0.4, W / 2, H / 2, R * 1.35);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,.93)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }
    /** @brief Avisos flotantes (logros, sinergias, cofres...). */
    drawToasts(W) {
        const ctx = this.ctx;
        ctx.textAlign = 'center';
        let y = 120;
        for (const t of this.toasts) {
            ctx.globalAlpha = clamp(t.t, 0, 1);
            ctx.font = 'bold 16px sans-serif';
            const w = Math.min(W - 40, ctx.measureText(t.text).width + 30);
            ctx.fillStyle = 'rgba(12,14,20,.88)';
            ctx.fillRect(W / 2 - w / 2, y - 20, w, 28);
            ctx.strokeStyle = t.color;
            ctx.strokeRect(W / 2 - w / 2, y - 20, w, 28);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, W / 2, y, W - 50);
            ctx.globalAlpha = 1;
            y += 34;
        }
        ctx.textAlign = 'left';
    }
    /** @brief HUD: vida, XP, habilidad, armas, sinergias, tiempo y capas de estado. */
    drawHud(W, H) {
        const ctx = this.ctx, p = this.player;
        ctx.fillStyle = '#2a2f3d';
        ctx.fillRect(0, 0, W, 10);
        ctx.fillStyle = '#3dd6d0';
        ctx.fillRect(0, 0, W * (p.xp / p.xpNext), 10);
        ctx.fillStyle = '#2a2f3d';
        ctx.fillRect(12, 20, 220, 16);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(12, 20, 220 * clamp(p.hp / p.maxHp, 0, 1), 16);
        ctx.fillStyle = '#2a2f3d';
        ctx.fillRect(12, 42, 220, 8);
        ctx.fillStyle = '#9b8cff';
        ctx.fillRect(12, 42, 220 * p.skill.ratio, 8);
        ctx.fillStyle = '#e8e8ee';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Nv ${p.level}   Bajas ${this.kills}   ${p.skill.name} [Espacio]`, 12, 68);
        ctx.fillText(`Vida ${Math.ceil(p.hp)}/${p.maxHp}`, 12, 86);
        const wl = p.weapons.map(w => `${w.name} ${w.level}`);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#aab3c8';
        ctx.fillText(wl.slice(0, 3).join('   |   '), 12, 106);
        if (wl.length > 3)
            ctx.fillText(wl.slice(3).join('   |   '), 12, 122);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#e8e8ee';
        ctx.font = '14px sans-serif';
        ctx.fillText(formatTime(this.time), W - 12, 30);
        ctx.fillStyle = this.map.accent;
        ctx.font = '13px sans-serif';
        ctx.fillText(`${this.map.name}  ·  ${this.map.hazards}`, W - 12, 50, W * 0.5);
        if (p.synergies.length > 0) {
            ctx.fillStyle = '#ffd76a';
            ctx.font = '12px sans-serif';
            const names = p.synergies.map(s => s.name);
            const label = names.length > 3 ? `${names.slice(0, 3).join('  ·  ')}  +${names.length - 3}` : names.join('  ·  ');
            ctx.fillText(`Sinergias: ${label}`, W - 12, 70, W * 0.6);
        }
        const done = ACHIEVEMENTS.filter(a => PROGRESS.has(a.id)).length;
        this.logrosBtn = { x: W - 150, y: H - 40, w: 138, h: 26 };
        ctx.fillStyle = 'rgba(35,40,56,.85)';
        ctx.fillRect(this.logrosBtn.x, this.logrosBtn.y, this.logrosBtn.w, this.logrosBtn.h);
        ctx.strokeStyle = '#4aa3ff';
        ctx.strokeRect(this.logrosBtn.x, this.logrosBtn.y, this.logrosBtn.w, this.logrosBtn.h);
        ctx.fillStyle = '#e8e8ee';
        ctx.font = '13px sans-serif';
        ctx.fillText(`Logros (L) ${done}/${ACHIEVEMENTS.length}`, W - 16, H - 22);
        if (this.hurtFlash > 0) {
            ctx.fillStyle = `rgba(200,40,40,${this.hurtFlash * 0.5})`;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.textAlign = 'center';
        if (this.state === 'levelup')
            this.drawLevelUp(W, H);
        else if (this.state === 'dead')
            this.drawDead(W, H);
        ctx.textAlign = 'left';
    }
    /** @brief Capa de subida de nivel. */
    drawLevelUp(W, H) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,.66)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('¡Subes de nivel! Elige una mejora (clic o teclas 1-3)', W / 2, H / 2 - 100);
        ctx.fillStyle = '#ffd76a';
        ctx.font = '14px sans-serif';
        ctx.fillText(`R: volver a tirar (${this.rerolls})`, W / 2, H / 2 - 76);
        this.optionRects().forEach((r, i) => {
            const o = this.levelOptions[i];
            if (!o)
                return;
            this.card(r, !!o.hint, false);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 15px sans-serif';
            this.ctext(`${i + 1}. ${o.label}`, r.x + r.w / 2, r.y + r.h / 2, r.w - 18);
            if (o.hint) {
                ctx.fillStyle = '#ffd76a';
                ctx.font = '12px sans-serif';
                this.ctext(o.hint, r.x + r.w / 2, r.y + r.h / 2 + 26, r.w - 18);
            }
        });
    }
    /** @brief Pantalla de muerte con resumen de la partida. */
    drawDead(W, H) {
        const ctx = this.ctx, r = this.lastRun;
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText('Has caído', W / 2, H / 2 - 130);
        ctx.font = '16px sans-serif';
        const syn = r.synergies.size > 0 ? [...r.synergies].map(id => (SYNERGIES.find(s => s.id === id) || { name: id }).name).join('  ·  ') : 'ninguna';
        const lines = [
            `Tiempo: ${formatTime(r.time)}   ·   Bajas: ${r.kills}   ·   Nivel: ${r.level}`,
            `Armas: ${r.weapons}   ·   Cofres: ${r.chests}   ·   Élites: ${r.elites}`,
            `Mapa: ${this.map.name}   ·   Héroe: ${this.hero.name}`,
            `Sinergias: ${syn}`,
        ];
        lines.forEach((t, i) => { ctx.fillStyle = i === 3 ? '#ffd76a' : '#d8dbe4'; ctx.fillText(t, W / 2, H / 2 - 84 + i * 26); });
        if (this.runUnlocks.length > 0) {
            ctx.fillStyle = '#ffd76a';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('¡Nuevos desbloqueos!', W / 2, H / 2 + 46);
            ctx.font = '14px sans-serif';
            this.runUnlocks.slice(0, 4).forEach((a, i) => ctx.fillText(`· ${a.name} → ${a.reward}`, W / 2, H / 2 + 70 + i * 20));
        }
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.fillText('Pulsa R para volver a elegir héroe   ·   L: Logros', W / 2, H / 2 + 150);
    }
    draw() {
        const ctx = this.ctx, canvas = this.canvas;
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#14161c';
        ctx.fillRect(0, 0, W, H);
        if (this.state === 'select') {
            this.drawHeroSelect(W, H);
            this.drawToasts(W);
            this.drawLogrosButton(W, H);
            if (this.logrosOpen)
                this.drawLogros(W, H);
            return;
        }
        if (this.state === 'mapselect') {
            this.drawMapSelect(W, H);
            this.drawToasts(W);
            this.drawLogrosButton(W, H);
            if (this.logrosOpen)
                this.drawLogros(W, H);
            return;
        }
        const p = this.player;
        ctx.save();
        const sx = this.shake > 0 ? rand(-1, 1) * this.shake : 0;
        const sy = this.shake > 0 ? rand(-1, 1) * this.shake : 0;
        ctx.translate(W / 2 - p.x + sx, H / 2 - p.y + sy);
        const view = { x: p.x - W / 2 - 80, y: p.y - H / 2 - 80, w: W + 160, h: H + 160 };
        this.drawGrid(ctx, p, W, H);
        this.drawDecorations(ctx, view);
        for (const e of this.entities)
            e.draw(ctx);
        p.draw(ctx);
        if (this.windGust)
            this.drawWind(ctx);
        ctx.restore();
        if (this.map.dark)
            this.drawDarkness(W, H);
        this.drawHud(W, H);
        this.drawToasts(W);
        if (this.logrosOpen)
            this.drawLogros(W, H);
    }
    /** @brief Botón de la ventana de logros en las pantallas de selección. */
    drawLogrosButton(W, H) {
        const ctx = this.ctx;
        const done = ACHIEVEMENTS.filter(a => PROGRESS.has(a.id)).length;
        this.logrosBtn = { x: W - 170, y: H - 62, w: 158, h: 32 };
        ctx.fillStyle = '#232838';
        ctx.fillRect(this.logrosBtn.x, this.logrosBtn.y, this.logrosBtn.w, this.logrosBtn.h);
        ctx.strokeStyle = '#ffd76a';
        ctx.strokeRect(this.logrosBtn.x, this.logrosBtn.y, this.logrosBtn.w, this.logrosBtn.h);
        ctx.fillStyle = '#ffd76a';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Logros (L)  ${done}/${ACHIEVEMENTS.length}`, this.logrosBtn.x + this.logrosBtn.w / 2, this.logrosBtn.y + 21);
        ctx.textAlign = 'left';
    }
}
const canvas = document.getElementById('c');
new Game(canvas, canvas.getContext('2d'));
