# Auditoría de la base de código

## Fuente y licencia

- Base: [jorge-erdb/abyss-engine](https://github.com/jorge-erdb/abyss-engine), rama `main`, clonada para esta auditoría.
- Licencia del repositorio: MIT, copyright de Jorge Erdmann (2026). Al redistribuir o modificar porciones sustanciales, conservar el aviso de copyright y la licencia en `LICENSE`.
- El código no declara paquetes de terceros: la página es HTML/CSS/JavaScript clásico y canvas. `index.html` carga Google Fonts (Press Start 2P). El repositorio también incluye tres MP3 (`audio/*.mp3`); `audio/README.md` describe la reproducción pero no identifica autores, fuentes ni licencias. La MIT del código no acredita esos activos: verificar sus permisos antes de redistribuir o publicar el juego derivado. Los efectos de juego sí se sintetizan con Web Audio. Revisar cada recurso nuevo por separado.

## Estructura observada

`index.html` carga scripts clásicos globales en orden; `js/player.js` gestiona movimiento, apuntado, disparo y XP; `js/enemy.js` define enemigos y jefe; `js/map.js` crea habitaciones, conexiones y spawns; `js/game.js` orquesta el estado, el bucle fijo de 60 Hz, colisiones, cámara y cambios de habitación. `js/ui.js`, `js/palette.js`, `js/touch.js` y `js/audio.js` cubren presentación, controles y sonido. No hay paso de build ni dependencias de runtime declaradas.

## Reutilizable

- Generación procedural y modelo geométrico `DungeonMap`.
- Entidades y patrones de enemigo/jefe, colisiones, balas, progresión de dificultad y bucle de paso fijo.
- Renderizado canvas, feedback, HUD y abstracción de controles.

## Límites para multijugador

- `Game` construye y muta localmente jugador, enemigos, balas, drops, mapa y progresión; cada cliente divergiría bajo latencia o aleatoriedad.
- `Player.update()` mezcla lectura del input con movimiento, cooldowns y disparo. Debe separarse en comandos de entrada y paso autoritativo.
- Los enemigos usan aleatoriedad local y toman como referencia un único jugador; el objetivo debe ser elegido por servidor desde jugadores conectados.
- El mapa utiliza `Math.random()` global; para reproducirlo hace falta semilla y RNG determinista o que el servidor envíe la geometría generada.
- Mejoras y XP afectan a un único `Player`, y algunos estados UI (pausa/subida de nivel) congelan el paso local. No deben detener la simulación compartida.
- Los scripts globales simplifican la lectura pero dificultan importar gameplay en Node. El código fuente real debe revisarse antes de extraer módulos.

## Decisión

La base es viable como motor de presentación y como fuente de algoritmos de mazmorra y gameplay. No es una arquitectura multijugador lista para conectar: reutilizar el bucle completo en cada cliente produciría autoridades en conflicto. La adaptación debe mover la decisión del estado a servidor y convertir el cliente en vista/controlador. Para evitar una reescritura injustificada, migrar sistemas por etapas y conservar interfaces de entidades/mapa, verificando equivalencia en cada extracción.

## Estado de inspección

Se inspeccionaron el README, `LICENSE`, `index.html`, `audio/README.md`, los archivos bajo `audio/` y las clases principales. La licencia MIT está presente y no hay dependencias de runtime declaradas. La licencia/procedencia de los MP3 no queda acreditada en el repositorio y requiere verificación antes de publicar o redistribuir.
