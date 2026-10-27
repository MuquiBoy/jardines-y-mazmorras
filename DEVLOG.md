# Registro de desarrollo — Jardines y Mazmorras

## 2026-10-25 — Hito: demo cooperativa publicada

- **Estado probado por el creador:** la demo abre desde la URL pública y funciona en solitario; la respuesta en tiempo real fue muy buena.
- **Multijugador:** la captura compartida muestra dos sesiones conectadas a una misma sala.
- **Repositorio:** [MuquiBoy/jardines-y-mazmorras](https://github.com/MuquiBoy/jardines-y-mazmorras), rama `main`.
- **Hosting:** servicio web de Render con plan `free`; la URL reportada es https://jardines-y-mazmorras.onrender.com.
- **Configuración revisada:** `render.yaml` establece `plan: free`, `startCommand: node server.js` y `autoDeployTrigger: commit`.

## Flujo acordado

1. Desarrollar y guardar avances en la copia local del proyecto.
2. Registrar en este archivo los hitos, cambios importantes y problemas encontrados.
3. Cuando un conjunto de mejoras esté listo para compartir, publicarlo en GitHub, en `main`.
4. Render debería desplegar automáticamente cada commit de esa rama. Comprobar que el despliegue termine correctamente antes de dar por actualizada la demo pública.
5. Mantener el servicio en el plan gratuito.

## Pendiente

- Probar la misma sala con un amigo desde otro dispositivo o navegador.
- En futuras mejoras, anotar qué cambió, cómo se comprobó y cualquier limitación conocida.
## 2026-10-25 — Identidad inicial del juego

- La pantalla de inicio pasa a llamarse Jardines y Mazmorras, mantiene Press Start 2P y adopta una paleta vegetal verde saturada.
- Se incorpora Rin's Theme de request (OpenGameArt), licencia CC0, como loop chiptune de combate del primer piso.
- Cambios guardados localmente para probar antes de publicar. Pendiente revisar la pantalla y escuchar el tema en la copia local.
## 2026-10-25 — Primera pasada jugable de los seis roles

- Se añadió una configuración independiente de combate para Pistolero, Tirador, Perdigonero, Invocador, Piromano y Bastión, en el orden solicitado y disponibles desde el inicio.
- Los placeholders usan verde, azul, magenta, morado, rojo y naranja, respectivamente. La escala visual y el radio de colisión se configuran por separado; Bastión tiene la mayor reserva de vida.
- Se incorporaron cargadores y recarga manual con R, cono de cinco perdigones, ráfagas incendiarias con daño periódico y unidades invocadas con vida propia, auto-búsqueda y daño recibido.
- Disparo de Tirador, fuego del Piromano, quemadura e invocaciones usan efectos sintetizados originales de Web Audio con estética retro. No requieren descargas de sonido de terceros.
- Cambios guardados en la copia local para revisión; todavía no publicados en GitHub ni Render. No se ejecutaron pruebas.
## 2026-10-26 — Generación procedural conectada a las plantillas

- El piso se arma con los PNG de `assets/plantillas-salas/` (19 plantillas: 4 entry, 4 hub, 3 combat, 5 combat-hard, 2 treasure, 1 boss). El servidor escanea las carpetas y `manifest.json` queda como respaldo estático.
- Regla de rotación establecida: cada plantilla puede girarse 90°, 180° o 270° solo si la puerta coincide en lado opuesto, ancho de dos losas y desplazamiento exacto. El generador no recorta salas ni crea aberturas.
- Los hubs actuales son pasillos de dos puertas. La desviación del tesoro usa la sala `combat-hard` de tres puertas como cruce antes del jefe; no se exige arte nuevo.
- Verificación: 100 pisos en prueba automatizada y 30 pisos en el navegador real, sin usar el generador de respaldo, sin solapamientos, con puertas alineadas y aparición cooperativa segura.
- Probados los modos cooperativo (servidor) y sin conexión. Se corrigió una espera de `image.decode()` que podía dejar la carga de plantillas colgada en pestañas en segundo plano.
- Copia de seguridad previa en `%TEMP%\opencode\backup-jardines-20261026`. Cambios locales, todavía sin publicar en GitHub ni Render.

## 2026-10-26 — Navegación de enemigos alrededor de muros

- `DungeonMap` incorpora `findPath()` (A* 8-direccional sobre la rejilla de 40 px, sin cortar esquinas, con suavizado por línea de visión) y `hasLineOfSight()`.
- Los enemigos simples cachean la ruta y solo la recalculan al cambiar de objetivo o agotarse; en espacio abierto persiguen en línea recta. Si un paso queda bloqueado, se desvían lateralmente para no quedarse empujando el muro.
- Perseguidor y espiral usan `steerTo()`. El tirador usa `retreatFrom()` para abrir distancia hasta su banda de disparo y rodea obstáculos cuando está acorralado.
- Verificación: prueba automatizada con perseguidor, tirador y espiral en 14 pisos reales, con rutas a través de puertas, 0 penetraciones de muro y sin atascos; 5 pasadas consecutivas correctas. En navegador, 60 enemigos simulados durante 600 frames sin violaciones de máscara y sin errores de consola.
- La generación se revalidó con los 100 pisos de siempre: sin respaldo, con puertas alineadas y composición intacta. Cambios locales, todavía sin publicar.

## 2026-10-26 — Composición variable y salas de combate selladas

- Composición por piso: 6–8 salas `combat` + 1–2 `combat-hard`, más 1 `treasure`, 1 `entry` y 1 `boss`. Los hubs se calculan como salas de juego + 2, con grafo `fork-branch` (bifurcación con ala lateral y unión del tesoro) y respaldo `spine-treasure`.
- Las salas de combate cierran sus puertas al entrar el jugador y solo las abren cuando muere el último enemigo de esa sala. El cierre usa planos finos de 16 px sobre la puerta autoral, no celdas completas, para no atrapar a nadie en el umbral; `canLockRoom()` espera a que ningún cuerpo solape el plano.
- Orden del encuentro corregido: al cruzar la puerta la sala se sella primero y los enemigos se generan después. En cooperativo, cualquier jugador que estaba fuera al iniciar el combate es reubicado junto al primero que entró, en la casilla libre más cercana (`findFreeSpotNear()`), antes de que aparezcan los enemigos. La excepción son los jugadores que ya están combatiendo en otra sala, para no dejar ese otro encuentro sellado y sin nadie que lo limpie. El cliente corta la interpolación en saltos largos o marcados con `teleportTick` para que la reubicación no parezca un deslizamiento a través de muros.
- Las rejas se dibujan en rojo sobre la puerta cerrada y el azul de obstáculo se pinta con el color del vacío. El bloqueo es autoritativo en `server/simulation.js` y también funciona en solitario y sin conexión.
- Verificación: 100 pisos con composición y respaldo, 25 pisos del grafo lineal, 12 salas con cierre/liberación, reubicación de compañero en servidor, navegación enemiga en 14 pisos y navegación cooperativa en 3 salas. En navegador: bloqueo, rejas sólidas y liberación al limpiar la sala.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.

## 2026-10-26 — Muros en vacío, remates y rotación libre

- Texturas corregidas en `DungeonMap.draw()`: las celdas no transitables de la plantilla, tanto el muro de borde marcado en rojo (máscara `0`) como el obstáculo azul (máscara `3`), se pintan con `PALETTE.void`. Solo queda visible un remate de 3 px en `PALETTE.wallLit` en los lados que tocan suelo o puerta. Las rejas de las puertas selladas conservan el cuerpo marrón y las barras rojas.
- La línea roja autoral define el límite real de cada sala y ya no se convierte en una masa marrón: el borde se respeta como zona vacía y el remate marca dónde empieza el suelo transitable.
- Rotación habilitada para todas las categorías, incluidas `entry` y `boss`, con las cuatro orientaciones (0°, 90°, 180°, 270°), sin espejos. El generador elige la orientación que encaja con las puertas del hub.
- `manifest.json` sincronizado con el catálogo real: solo queda `entry/inicio 1_entry.png` (las variantes 2–4 ya no existen) y la revisión `834f5eeec55d5eff` coincide con `/api/room-templates`. No hay rutas ausentes ni entradas de más.
- Verificación: 100 pisos de composición, cierre/liberación de puertas, navegación cooperativa y navegación enemiga siguen pasando. Una prueba nueva generó 200 pisos y `entry` y `boss` usaron las cuatro rotaciones. Otra prueba rasterizó salas reales: 1351 celdas de muro y 74 de obstáculo en vacío, 1148 remates correctos en Node; en el canvas del navegador, 568 celdas de muro, 46 de obstáculo y 570 remates sin una sola discrepancia.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.

## 2026-10-26 — Ajuste de tamaño de Bastión e Invocador

- Bastión reduce su cuerpo visible de 48×48 a 40×40 px (`visualScale: 40 / 24`).
- Invocador reduce su cuerpo visible de 36×36 a 32×32 px (`visualScale: 32 / 24`).
- El contorno de 4 px se mantiene y el radio de colisión no cambia: 17 px para Bastión y 12 px para Invocador.
- Verificación: el cliente dibuja exactamente 40×40 y 32×32 px sobre el canvas; el servidor cooperativo envía las nuevas escalas tras reiniciarse, manteniendo los radios intactos.
- `index.html` actualizó las etiquetas de versión de `map.js` (`authored-floor-void-v6`) y `roles.js` (`roles-size-40-32-v1`) para que el lanzador y el navegador carguen esta copia.
- `ABRIR JUEGO.bat` ahora compara las etiquetas del `index.html` local con las del servidor antes de reutilizarlo. Reutiliza el puerto 8123 u 8080 solo si sirven exactamente esta versión; si no, arranca un servidor nuevo en 8123 (o en un puerto libre si está ocupado). Probados tanto el arranque en frío como la reutilización del servidor, con HTTP 200 y las etiquetas nuevas.
- La comprobación vive en `abrir-juego-check.ps1`: además de las etiquetas, exige que el proceso del servidor haya arrancado después de la última modificación de los archivos que carga en memoria (`server.js`, `server/*.js`, `js/palette.js`, `js/characters/roles.js`, `js/bullet.js`, `js/player.js`, `js/enemy.js`, `js/map.js`). Si el servidor es anterior a un cambio, devuelve error y el lanzador arranca una copia nueva en vez de abrir la vieja.
- Verificación del lanzador: con el servidor al día reutiliza 8123 sin crear otro proceso (exit 0, mismo PID); tras detenerlo arranca en frío en 8123 con HTTP 200 y las etiquetas nuevas; tras tocar `js/map.js` el chequeo devuelve error (exit 1) y el lanzador no reutiliza el servidor obsoleto.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.

## 2026-10-26 — Física del jefe, sala nueva y puertas selladas

- La generación usa la nueva plantilla `boss/sala gigante jefe_boss.png` (24×20 losas, 960×800 px). El catálogo dinámico la detecta y `manifest.json` quedó sincronizado con esa única entrada y la revisión `6c85e8d43a6185e7`.
- El jefe ya no se teletransporta a `center ± órbita`: su deriva pasa por `steerTo()` y por `map.canOccupy()`, así que respeta las líneas de muro rojas (máscara `0`) y los obstáculos azules (máscara `3`).
- La órbita reduce su radio cuando el cuerpo de 40 px no cabe, se limita a la sala del jefe y gira de dirección si queda bloqueada. El objetivo nunca se acepta si no es transitable.
- La aparición del jefe ahora exige hueco para sus 40 px de radio, prefiere el centro de la sala y evita al jugador; antes usaba el mismo punto de 14 px que un enemigo común y podía nacer medio dentro de un muro.
- La sala `boss` se sella igual que una sala de combate: al entrar se marca `lockPending`, `updateRoomLocks()` cierra las puertas y solo después aparecen el jefe y sus acompañantes. En cooperativo se reubica al compañero dentro antes de generar enemigos, con el mismo orden que ya usaban las salas de combate.
- Las puertas del jefe se abren en cuanto muere el jefe, aunque queden acompañantes vivos. `onBossDefeated()` marca la sala como limpia, libera las barreras y abre la salida dentro de la propia sala; tanto el cliente como el servidor centralizan ahí las tres rutas de muerte (invocación, quemadura y bala).
- Verificación: 25 pisos generados usan la plantilla nueva; 37.500 frames de combate sin una sola posición inválida ni salida de la sala, incluida una sala sintética con obstáculos azules; el run cooperativo del servidor pasó otros 900 ticks dentro de la física. Una prueba nueva selló y abrió la sala del jefe en 12 pisos en solitario y en las rutas cooperativas de bala y quemadura, comprobando que el jefe aparece después del cierre y que las puertas se liberan al morir. Siguen pasando generación, puertas de combate, navegación cooperativa, navegación enemiga, texturas/rotaciones y tamaños de rol.
- `index.html` actualizó `map.js` a `authored-floor-void-v7`, `enemy.js` a `boss-wall-physics-v11` y `game.js` a `boss-door-lock-v7`.
- `abrir-juego-check.ps1` ahora detiene una copia vieja del propio juego si ocupa 8123/8080 (solo cuando la respuesta y el proceso la identifican como tal), para que `ABRIR JUEGO` libere el puerto y arranque la versión nueva en 8123.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.

## 2026-10-26 — Cámara al 200% sin perder nitidez

- Se añadió `CAMERA_ZOOM = 2` como constante independiente de `PIXEL_SIZE`. El lienzo conserva la resolución nativa de la ventana y el mundo se dibuja en espacio de cámara al doble, así que cada píxel de arte ocupa un bloque exacto de 2×2 píxeles de pantalla. No es un reescalado del lienzo: no se descartan píxeles dibujados.
- La vista visible pasa a la mitad en ambos ejes (`viewWidth`/`viewHeight = lienzo × PIXEL_SIZE / CAMERA_ZOOM`). La cámara sigue centrada en el jugador, con el mismo recorte a los límites del mapa. En una ventana de 1000×700 se ven 500×350 unidades de mundo.
- El apuntado con ratón descuenta el zoom y la relación entre el lienzo y su tamaño CSS antes de convertir a coordenadas de mundo. El apuntado táctil no cambia porque ya usa una dirección normalizada. El cooperativo reutiliza la misma cámara y la misma conversión del cliente.
- Las capas de pantalla (viñeta, destello de daño, transición, notificaciones y minimapa) siguen dibujándose a resolución y tamaño normales; solo el mundo se amplía.
- Verificación en navegador: el sprite de Pistolero de 24×24 se pinta con 1424 píxeles opacos frente a 356 del PNG (factor 4, es decir 2× por eje); un proyectil de 9 px de mundo ocupa 18 px de lienzo; la cámara queda centrada en el jugador; un movimiento de ratón de 200 px equivale a 100 unidades de mundo y el vector de apuntado coincide al 100%. Las pruebas de colores, sprites, tamaños, jefe y texturas siguen pasando.
- `index.html` actualizó `palette.js` a `pixel-zoom-200-v1` y `game.js` a `camera-zoom-200-v9`.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.

## 2026-10-26 — Sprites de rol y disparos con el color de cada clase

- Los cinco stickers de `00-sprites/jugador/` sustituyen a los placeholders: Pistolero, Tirador, Piromano 24×24, Invocador 32×32 y Bastión 40×40. Se dibujan 1:1 con `imageSmoothingEnabled = false`, conservando el contorno incluido en el PNG. Perdigonero mantiene el placeholder porque todavía no tiene carpeta de sprite.
- Cada rol carga su PNG desde `00-sprites/jugador/<rol>/<rol>_sticker.png` con versión de caché propia. Si el archivo faltara, el jugador vuelve al rectángulo de color sin romper la partida.
- El color del rol ya viaja en cada proyectil de `Player.shoot()` (`color: this.color`): verde `#55d64b` (Pistolero), magenta `#f044b5` (Perdigonero), azul `#48a9ff` (Tirador), naranja `#ff951f` (Bastión), rojo `#ff453a` (Piromano) y morado `#ae64e8` (Invocador).
- El Invocador no dispara balas: ataca con unidades invocadas. Su invocación pasó de `#b96cff` al morado exacto del rol, `#ae64e8`, y la barra de vida de la invocación usa ese mismo color.
- El render en solitario pinta el anillo del proyectil con `bullet.color` y deja el núcleo claro; el servidor cooperativo serializa `color` en `bulletState` y el cliente dibuja los proyectiles del snapshot, por lo que el color se conserva en multijugador.
- Verificación: prueba nueva de colores por rol (incluida la invocación morada y la ruta cooperativa) y prueba de sprites ya existente; siguen pasando tamaños de rol 40×32, física y puertas del jefe, y texturas/rotaciones.
- `index.html` actualizó `roles.js` a `roles-player-sprites-colors-v2`, `player.js` a `player-role-sprites-v1` y `game.js` a `role-shot-colors-v8`.
- Cambios locales en `http://localhost:8123`; sin commit, push ni despliegue en GitHub/Render.
