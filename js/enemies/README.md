# Categorías de enemigos

- esbirros/: Esbirro Miedoso, Mosca Tirador, Esbirro Tirador y Espiral. Se combinan en salas combat (la categoría simple actual) y combat-hard. Esbirro Tirador reutiliza la navegación de Mosca Tirador y posee su propio ciclo de ráfaga y recarga.
- smart-cover.js: "Búsqueda de cobertura inteligente" (`SmartCover` en el código). Esbirro Miedoso, Mosca Tirador y Esbirro Tirador comparten allí la selección de cobertura azul y de puntos de ataque. Cada enemigo conserva sus propias condiciones de activación, movimiento, estadísticas y ataque. Véase COBERTURA_INTELIGENTE.txt.
- Sus pesos de aparición se configuran por piso en `catalog.js`: 25 para Esbirro Miedoso, 10 para Mosca Tirador y 20 para cada uno de Esbirro Tirador y Espiral. Se normalizan entre los tipos habilitados de ese piso y se sortean por cada esbirro, tanto en `combat` como en `combat-hard`.
- Los sprites y animaciones de todos los esbirros se guardan en `00-sprites/enemigos/2_esbirros/<id_del_enemigo>/`. Mosca Tirador y Esbirro Tirador cargan sus propias animaciones desde sus carpetas respectivas.
- mini-jefes/: enemigos que alteran posicionamiento o prioridades. Solo aparece una clase por sala combat-hard: 50% Cochinilla Esquinero y 50% Babosa Persecución. Si la esquina requerida por la Cochinilla no es válida, se usa la Babosa como alternativa; los esbirros de la sala se conservan.
- Los sprites y animaciones de todos los mini-jefes se guardan en `00-sprites/enemigos/1_mini-jefes/<id_del_enemigo>/`. La Cochinilla Esquinero ya carga su PNG desde esa carpeta.
- El arte propio de Mosca Tirador, Esbirro Tirador, Cochinilla Esquinero y Babosa Persecución se prepara antes de mostrar una partida. Estos enemigos no dibujan placeholders durante la carga.
- La sala de pruebas 0-0 usa una secuencia independiente `entry → hub → combat → hub → combat-hard`. En sus salas de combate se generan los esbirros y el sorteo de mini-jefe del catálogo actual; esto no cambia la composición de los pisos normales.
- El jefe convencional conserva su sala boss. La sala 0-0 no incluye el jefe de piso ni enemigos colocados manualmente fuera del catálogo.

catalog.js define los tipos y las reglas de aparición. index.html y server/simulation.js deben cargar enemy.js, smart-cover.js, los esbirros, los archivos de mini-jefes, catalog.js y después map.js.
