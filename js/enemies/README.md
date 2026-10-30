# Categorías de enemigos

- esbirros/: Básico, Mosca Tirador, Esbirro Tirador y Espiral. Se combinan en salas combat (la categoría simple actual) y combat-hard. Esbirro Tirador es por ahora una copia exacta de Mosca Tirador para permitir ajustar su versión por separado más adelante.
- Los sprites y animaciones de todos los esbirros se guardan en `00-sprites/enemigos/2_esbirros/<id_del_enemigo>/`. Mosca Tirador carga su animación desde esa carpeta.
- mini-jefes/: enemigos que alteran posicionamiento o prioridades. Solo aparece una clase por sala combat-hard: 50% Cochinilla Esquinero y 50% Babosa Persecución. Si la esquina requerida por la Cochinilla no es válida, se usa la Babosa como alternativa; los esbirros de la sala se conservan.
- Los sprites y animaciones de todos los mini-jefes se guardan en `00-sprites/enemigos/1_mini-jefes/<id_del_enemigo>/`. La Cochinilla Esquinero ya carga su PNG desde esa carpeta.
- La sala de pruebas 0-0 usa una secuencia independiente `entry → hub → combat → hub → combat-hard`. En sus salas de combate se generan los esbirros y el sorteo de mini-jefe del catálogo actual; esto no cambia la composición de los pisos normales.
- El jefe convencional conserva su sala boss. La sala 0-0 no incluye el jefe de piso ni enemigos colocados manualmente fuera del catálogo.

catalog.js define los tipos y las reglas de aparición. index.html y server/simulation.js deben cargar enemy.js, los esbirros, los archivos de mini-jefes, catalog.js y después map.js.
