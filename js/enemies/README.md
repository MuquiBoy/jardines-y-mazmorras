# Categorías de enemigos

- esbirros/: Básico, Tirador y Espiral. Se combinan en salas combat (la categoría simple actual) y combat-hard.
- mini-jefes/: enemigos que alteran posicionamiento o prioridades. Solo aparece uno por sala combat-hard, si existe una ubicación válida.
- El jefe convencional conserva su sala boss. La Cochinilla Perforamuros sigue siendo contenido de la sala de pruebas 0-0 mientras no se apruebe para la generación procedural.

catalog.js define los tipos y las reglas de aparición. index.html y server/simulation.js deben cargar enemy.js, los tres archivos de esbirros, los archivos de mini-jefes, catalog.js y después map.js.
