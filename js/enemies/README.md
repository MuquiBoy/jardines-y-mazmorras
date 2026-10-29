# Categorías de enemigos

- esbirros/: Básico, Mosca Tirador y Espiral. Se combinan en salas combat (la categoría simple actual) y combat-hard.
- mini-jefes/: enemigos que alteran posicionamiento o prioridades. Solo aparece una clase por sala combat-hard: 30% Cochinilla Esquinero y 70% Babosa Persecución. Si la esquina requerida por la Cochinilla no es válida, se usa otro mini-jefe elegible; los esbirros de la sala se conservan.
- El jefe convencional conserva su sala boss. La Cochinilla Perforamuros sigue siendo contenido de la sala de pruebas 0-0 mientras no se apruebe para la generación procedural.

catalog.js define los tipos y las reglas de aparición. index.html y server/simulation.js deben cargar enemy.js, los esbirros, los archivos de mini-jefes, catalog.js y después map.js.
