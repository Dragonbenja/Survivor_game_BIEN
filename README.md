# TS Survivors — Guía del jugador

Sobrevive el mayor tiempo posible contra oleadas de enemigos que no paran de crecer. Tus armas atacan solas: tú solo te mueves, usas la habilidad y eliges mejoras. Entre partidas desbloqueas héroes, mapas, armas y ventajas completando **logros**.

## Abrir el juego

Doble clic en **`TS Survivors.html`**. No hace falta instalar nada ni compilar: el HTML ya lleva el juego incrustado.

- `game.ts` — código fuente (TypeScript).
- `game.js` — compilado (se genera con `tsc`; el HTML es autocontenido y no lo necesita).
- El progreso (logros y estadísticas) se guarda en el almacenamiento local del navegador.

## Controles

| Acción | Tecla / ratón |
|---|---|
| Moverte | `W A S D` o flechas |
| Usar habilidad | `Espacio` |
| Elegir héroe | `1`–`8` o clic en la tarjeta |
| Elegir mapa | `1`–`6` o clic en la tarjeta (tras elegir héroe) |
| Elegir mejora al subir de nivel | `1`–`3` o clic en la tarjeta |
| Volver a tirar las mejoras | `R` durante la subida de nivel (gasta un reroll) |
| Abrir/cerrar **Logros** | `L` o `Tab` (↑/↓ cambian de página) |
| Volver de la selección de mapa | `Esc` |
| Volver a elegir héroe tras morir | `R` |

El juego necesita teclado; no hay controles táctiles.

## Cómo se juega

- Los enemigos sueltan **gemas** al morir. Recógelas pasando cerca (rango base: 70 px) para ganar XP.
- Al llenar la barra de XP (arriba) subes de nivel, el juego se pausa y eliges **1 de 3 mejoras** al azar. Si subes varios niveles de golpe, eliges una mejora por cada nivel.
- Los enemigos hacen daño por contacto. Tras recibir un golpe tienes **0,5 s de invulnerabilidad**.
- Un enemigo **golpeado y aún vivo** muestra una barra de vida roja sobre su cabeza; si está congelado se ve teñido de azul, y si está enraizado, de verde.
- El HUD muestra vida, recarga de habilidad, nivel, bajas, tiempo, armas, sinergias activas y el botón de Logros.
- Las oleadas son más frecuentes con el tiempo (una cada 1 s al inicio, hasta una cada 0,1 s pasados ~120 s), con un máximo de 320 enemigos a la vez.
- Cada partida puedes llevar **como máximo 6 armas** de las 12 disponibles.

## Héroes

| # | Héroe | Vida | Velocidad | Arma inicial | Habilidad | Extra | Desbloqueo |
|---|---|---|---|---|---|---|---|
| 1 | Mage | 100 | 160 | Magic Bolt | Nova | Equilibrado | — |
| 2 | Knight | 140 | 148 | Orbit Blades | Blink Dash | Armadura 1 | — |
| 3 | Cleric | 110 | 155 | Holy Aura | Frost Pulse | Regenera 0,5 HP/s | — |
| 4 | Stormcaller | 80 | 175 | Lightning | Meteor Storm | +10% daño | — |
| 5 | Rogue | 90 | 172 | Throwing Knives | Smoke Bomb | +25% XP ganada | Logro *Primera Sangre* |
| 6 | Berserker | 130 | 158 | Whirlwind | Berserk | +15% daño y +30% con menos del 50% de vida | Logro *Arsenal* |
| 7 | Necromancer | 95 | 152 | Bone Spirits | Raise Dead | 1 aliado extra con su habilidad | Logro *Química* |
| 8 | Druid | 115 | 158 | Nature Totem | Entangling Roots | Recoge gemas desde más lejos | Logro *Buscatesoros* |

Desbloquear un héroe también deja su arma disponible para el resto de héroes.

## Mapas

Se eligen después del héroe. Cada uno cambia el entorno, la decoración, los modificadores y los peligros ambientales.

| Mapa | Peligros / modificadores | XP | Desbloqueo |
|---|---|---|---|
| Pradera | Ninguno | x1,00 | — |
| Desierto | Tormentas de arena que empujan a todos · enemigos +5% velocidad | x1,15 | — |
| Tundra | Suelo helado: patinas y cuesta frenar · enemigos −8% velocidad | x1,10 | Logro *Curtido* |
| Volcán | Charcas de lava que dañan a enemigos y a ti · enemigos +10% HP | x1,25 | Logro *Exterminador* |
| Cripta | Oscuridad: solo ves alrededor del héroe · enemigos +20% HP | x1,30 | Logro *Veterano* |
| Abismo | Grietas que atraen a todos hacia su centro · más oleadas y enemigos más rápidos | x1,50 | Logro *Leyenda* |

## Enemigos

| Enemigo | Aparece | Vida | Velocidad | Daño por contacto | XP | Notas |
|---|---|---|---|---|---|---|
| Bat | Desde el inicio | 6 + 0,1·t | 95 + 0,3·t (máx. +50) | 6 | 1 | Rápido y frágil |
| Skeleton | Desde los 20 s | 12 + 0,15·t | 55 + 0,4·t (máx. +60) | 8 | 1 | — |
| Spitter | Desde los 45 s | 14 + 0,16·t | 46 + 0,12·t (máx. +30) | 7 | 2 | Dispara proyectiles |
| Brute | Desde los 60 s | 60 + 0,5·t | 38 + 0,15·t (máx. +25) | 16 | 5 | Lento y muy duro |
| Wraith | Desde los 90 s | 16 + 0,2·t | 118 + 0,25·t (máx. +45) | 7 | 2 | Muy veloz |
| Golem | Desde los 150 s | 110 + 0,9·t | 30 + 0,06·t (máx. +14) | 20 | 8 | Al morir se rompe en 3 murciélagos |

`t` son los segundos transcurridos; todos se vuelven más duros con el tiempo.

**Élites**: a partir del minuto 1 aparece una élite cada 75 s (×6 vida, +50% daño, ×5 XP, tamaño mayor). Sueltan un **cofre** garantizado.

## Armas (nivel máximo 8)

Daño efectivo = daño base × (1 + 0,3 por nivel adicional) × tu multiplicador de daño. El cooldown se multiplica por tu reducción de cooldown.

| Arma | Daño base | Qué hace | Disponible |
|---|---|---|---|
| Magic Bolt | 12 | Dispara al enemigo más cercano cada 0,8 s; desde nivel 3 atraviesa | Inicio |
| Orbit Blades | 12 | Cuchillas giratorias que empujan; cada enemigo recibe un golpe cada 0,35 s | Inicio |
| Holy Aura | 8 | Daña a todos los enemigos dentro del aura cada 0,5 s | Inicio |
| Lightning | 25 | Rayos sobre enemigos aleatorios a menos de 380 px | Inicio |
| Fire Trail | 6 | Llamas en el suelo mientras te mueves (no deja rastro si te quedas quieto) | Inicio |
| Garlic | 5 | Aura pequeña que daña, ralentiza y repele a los enemigos pegados | Inicio |
| Frost Wand | 10 | Proyectiles de hielo que congelan al impactar | Inicio |
| Throwing Knives | 9 | Abanico de cuchillos rápidos y perforantes | Héroe Rogue / Logro *Primera Sangre* |
| Whirlwind | 15 | Giro cuerpo a cuerpo con mucho empuje; +25% daño por enemigo extra (máx. 3) | Héroe Berserker / Logro *Arsenal* |
| Bone Spirits | 8 | Espíritus óseos teledirigidos | Héroe Necromancer / Logro *Química* |
| Nature Totem | 9 | Coloca tótems (máx. 2) que disparan espinas | Héroe Druid / Logro *Buscatesoros* |
| Boomerang Axe | 18 | Hachas que vuelan, atraviesan y regresan a ti | Logro *Intocable* |

## Habilidades (nivel máximo 6, se usan con Espacio)

Cada nivel reduce su cooldown base un 10%.

| Habilidad | Cooldown | Efecto | Escala por nivel |
|---|---|---|---|
| Nova | 8 s | Onda que daña a todos en 160 px (50 de daño) | +20 px, +25 de daño |
| Frost Pulse | 10 s | Daña (15) y congela al 30% de velocidad en 200 px durante 2 s | +20 px, +8 de daño, +0,5 s |
| Blink Dash | 5 s | Salto de 140 px invulnerable que daña (30) lo que cruza | +20 px, +15 de daño, +0,1 s |
| Meteor Storm | 12 s | 4 meteoros sobre enemigos a menos de 450 px (60 de daño en 60 px) | +1 meteoro, +25 de daño |
| Smoke Bomb | 7 s | Invulnerabilidad 1,6 s, +40% velocidad y nube que congela 150 px | +0,2 s, +15 px, +0,4 s de velocidad |
| Berserk | 14 s | Furia 6 s: +40% daño y +25% velocidad, pero recibes +25% daño; te cura | +0,6 s, +2% de curación |
| Raise Dead | 15 s | Invoca esqueletos aliados que persiguen y golpean enemigos | +1 aliado cada 2 niveles, +1 s de vida |
| Entangling Roots | 11 s | Enraiza (casi inmoviliza) y daña a los enemigos en 210 px | +20 px, +6 de daño, +0,3 s |

## Sinergias

Se activan automáticamente al llevar a la vez las dos piezas. Aparecen en el HUD y las subidas de nivel las avisan antes de elegir.

| Sinergia | Combinación | Efecto |
|---|---|---|
| Tormenta Arcana | Magic Bolt + Lightning | +1 rayo y 25% de probabilidad de que los proyectiles encadenen un rayo |
| Torbellino de Acero | Orbit Blades + Whirlwind | +1 cuchilla, giro más rápido, más empuje y sangrado |
| Choque Térmico | Fire Trail + Frost Wand | Las llamas congelan y hacen +50% de daño a enemigos helados |
| Fe Inquebrantable | Holy Aura + Garlic | El aura cura 0,5 HP por enemigo golpeado (máx. 4) y el ajo empuja más |
| Maestría Arrojadiza | Throwing Knives + Boomerang Axe | +1 cuchillo y +1 perforación en ambos |
| Legión | Bone Spirits + Raise Dead | Los espíritus roban 1 HP y los aliados explotan al desaparecer |
| Santuario | Nature Totem + Holy Aura | Los tótems emiten el aura sagrada |
| Forja Sagrada | Holy Aura + Frost Wand | El aura también congela a todo lo que toca |

## Objetos del mundo

| Objeto | Efecto |
|---|---|
| Gema | XP al recogerla |
| Corazón | Cura un 25% de la vida máxima (mínimo 20) |
| Imán | Atrae todas las gemas del mapa durante 3 s |
| Bomba | Daña y empuja a todos los enemigos en 320 px |
| Cofre | Concede una mejora aleatoria gratis (aparece cada ~95 s y con cada élite) |

Los enemigos normales sueltan corazón (3%), imán (1,5%) o bomba (1%).

## Logros

Ventana **Logros** con `L` o `Tab`. El progreso se guarda entre partidas.

| Logro | Objetivo | Recompensa |
|---|---|---|
| Primera Sangre | 25 bajas en una partida | Héroe Rogue + Throwing Knives |
| Curtido | Sobrevivir 3 minutos | Mapa Tundra |
| Leyenda | Sobrevivir 8 minutos | Mapa Abismo |
| Veterano | Alcanzar el nivel 15 | Mapa Cripta |
| Exterminador | 1000 bajas acumuladas | Mapa Volcán |
| Arsenal | Llevar 4 armas a la vez | Héroe Berserker + Whirlwind |
| Coleccionista | Llevar 6 armas a la vez | +1 reroll por partida |
| Química | Activar 3 sinergias distintas | Héroe Necromancer + Bone Spirits |
| Buscatesoros | Abrir 10 cofres | Héroe Druid + Nature Totem |
| Intocable | 120 s seguidos sin recibir daño | Arma Boomerang Axe |
| Cazador de Élites | Derrotar 5 élites en una partida | +1 reroll por partida |
| Trotamundos | Jugar en los 6 mapas | Empiezas cada partida con 2 armas |
| Masacre | 500 bajas en una partida | +25 de vida máxima inicial |

## Mejoras pasivas

| Mejora | Efecto | Límite |
|---|---|---|
| +15% damage | Multiplica el daño de armas y habilidad | Sin límite |
| -10% cooldowns | Reduce el cooldown de armas y habilidad | Deja de ofrecerse al llegar a ~45% del cooldown original |
| +1 armor | Resta 1 al daño recibido (mínimo 1 por golpe) | Máx. 5 |
| +20 max HP and heal | Sube la vida máxima y te cura por completo | Sin límite |
| Heal 40% HP | Cura el 40% de tu vida máxima | Sin límite |
| +15% move speed | Más velocidad de movimiento | Sin límite |
| +40 pickup range | Recoges gemas desde más lejos | Sin límite |
| +0.5 HP/s regen | Regeneración continua | Sin límite |
| +20% XP gain | Ganas más XP por gema | Sin límite |

## Consejos

- Cada mapa premia un estilo distinto: el Abismo da muchísima XP pero es el más peligroso; la Cripta mejora botín a cambio de visibilidad.
- La lava del Volcán también daña a los enemigos: úsala para deshacerte de los Golem sin gastar munición.
- En la Tundra, empieza a frenar antes de girar: el hielo te lleva.
- Contra los Spitter conviene moverse en diagonal; sus proyectiles son lentos pero se acumulan.
- Las sinergias valen más que subir un arma suelta: si ves "Activa sinergia" en una tarjeta, suele ser la mejor elección.
- Guarda los rerolls para subidas con opciones malas, no para las primeras.
- Con 6 armas ya no aparecen más armas nuevas, así que las últimas subidas se centran en niveles y pasivas.

## Para desarrolladores

- Código fuente: `game.ts` (TypeScript, comentarios Doxygen en español, código en inglés).
- Compilar: `npx tsc game.ts --target ES2020 --lib ES2020,DOM --strict` (genera `game.js` con `--noEmitOnError` si quieres evitar salidas con errores).
- `TS Survivors.html` es autocontenido: incluye el JS compilado y funciona con doble clic (también admite `file://`). Si recompilas, vuelve a incrustar `game.js` en el HTML o sirve la carpeta por HTTP y carga el HTML con `<script src="game.js">`.
- Estructura OOP: `Entity` (base) → `Enemy` (`Bat`, `Skeleton`, `Brute`, `Spitter`, `Wraith`, `Golem`), `Gem`, `Pickup`, `Projectile`, `Spirit`, `Axe`, `Ally`, `Totem`, `Flame`, `Ring`, `Bolt`, `LavaPool`, `VoidRift`, `EnemyShot`, `Player`.
- Composición: `Player` contiene `Weapon[]` y un `Skill`. Armas: `MagicBolt`, `OrbitBlades`, `HolyAura`, `LightningStrike`, `FireTrail`, `Garlic`, `FrostWand`, `ThrowingKnives`, `Whirlwind`, `BoneSpirits`, `NatureTotem`, `BoomerangAxe`. Habilidades: `Nova`, `FrostPulse`, `BlinkDash`, `MeteorStorm`, `SmokeBomb`, `Berserk`, `RaiseDead`, `EntanglingRoots`.
- Datos declarativos: `HEROES`, `MAPS`, `SYNERGIES`, `ACHIEVEMENTS`, `WEAPON_POOL`.
- Progreso: `Progress` (logros y estadísticas) con guardado tolerante a fallos en `localStorage` (`tsSurvivors.save.v1`).
