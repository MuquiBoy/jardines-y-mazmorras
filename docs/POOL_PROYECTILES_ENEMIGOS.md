# Pool de proyectiles enemigos y validación de capacidad

## Funcionamiento

- La pool contiene únicamente proyectiles físicos disparados por enemigos. Los disparos de jugadores conservan su sistema actual; los láseres, avisos, partículas y demás efectos no se incluyen.
- En una partida sin conexión se crea una pool para la simulación local. En cooperativo hay una pool compartida por la simulación autoritativa del servidor; los clientes reciben sus snapshots y no crean otra pool por jugador.
- La capacidad inicial es de 512 objetos. Al agotarse, se amplía en bloques de 128 sin borrar objetos activos ni omitir disparos.
- Cada activación vuelve a configurar posición, dirección, velocidad, daño, color, facción, propietario, recorrido e impactos. Los valores de daño existentes se conservan: 6 HP para un proyectil normal y 12 HP para uno del jefe. La velocidad respeta la escala actual del enemigo.
- Todos los enemigos que disparan proyectiles usan por defecto `10x10_proyectil enemigo.aseprite`: 10 × 10 px de tamaño visual, radio de hitbox 4 px y los 3 fotogramas de 100 ms de la animación (10 FPS). `cochinilla_esquinero` y `babosa_persecucion` no disparan proyectiles. Un enemigo que necesite otro visual declara `projectileVisualType` y registra su animación desde su propio código.
- La animación se decodifica una sola vez y sus 3 lienzos se comparten en todos los disparos. La pool conserva 512 objetos iniciales y añade solo una referencia pequeña al tipo visual por proyectil; no asigna lienzos ni fotogramas a cada objeto. La selección de fotograma se calcula una vez por tipo visual y render, compartida por todos los proyectiles visibles.
- Al impactar con una pared, un jugador o una invocación, salir del mapa o cambiar de piso, el proyectil vuelve a estar disponible. Un impacto contra Bastión consume el proyectil y aplica el daño completo, igual que contra Pistolero. La inmunidad universal posterior al daño se aplica a ambos roles.
- Los proyectiles inactivos se retiran de la lista de simulación antes del siguiente ciclo; por ello no se mueven, dibujan, colisionan ni se envían en snapshots.

Las métricas están disponibles con `Game.getEnemyProjectilePoolStats()` en modo local y `Simulation.getProjectilePoolStats(run)` en el simulador del servidor. Incluyen capacidad, activos, disponibles, pico, ampliaciones, solicitudes sin espacio, disparos emitidos y objetos devueltos.

## Pantalla de inicio

Al iniciar una expedición local se muestra «Jardines y Mazmorras — Preparando mazmorra…» mientras se cargan las plantillas y se prepara la pool. Usa un indicador animado sin porcentaje inventado, bloquea el inicio del juego y desaparece cuando la primera sala está lista. En cooperativo, el servidor prepara mapa y pool antes de emitir `game_start`; cada cliente mantiene la pantalla hasta terminar de cargar las plantillas. Si la preparación falla, se muestra un mensaje y una opción para reintentar. No se muestra durante cambios de sala o piso.

## Validación de capacidad

Se ejecutaron ocho simulaciones con dos jugadores en el mismo `Simulation` autoritativo usado por el cooperativo: Pistolero y Bastión. Cada simulación avanzó 1.200 ticks. Se usaron salas `combat-hard` y de jefe en niveles de estadísticas 1, 5, 10 y 15. Estos registros son históricos y se conservan como referencia de capacidad; no representan el balance actual de los roles.

| Nivel de estadísticas | Encuentro y composición generada | Pico activo | Disparos emitidos / devueltos | Ampliaciones |
|---:|---|---:|---:|---:|
| 1 | Difícil: Cochinilla Esquinero, Esbirro Miedoso y 3 moscas tiradoras | 8 | 37 / 34 | 0 |
| 1 | Jefe: Jefe | 73 | 161 / 88 | 0 |
| 5 | Difícil: Cochinilla Esquinero, 3 Espirales y Esbirro Miedoso | 61 | 263 / 220 | 0 |
| 5 | Jefe: Jefe | 78 | 199 / 130 | 0 |
| 10 | Difícil: Cochinilla Esquinero, 3 Esbirros Miedosos, Espiral y Mosca Mosca Tirador | 29 | 189 / 167 | 0 |
| 10 | Jefe: Jefe | 92 | 300 / 218 | 0 |
| 15 | Difícil: Cochinilla Esquinero, Espiral y 4 moscas tiradoras | 52 | 242 / 199 | 0 |
| 15 | Jefe: Jefe | 100 | 348 / 248 | 0 |

En las ocho simulaciones se emitieron 1.739 proyectiles; 1.304 regresaron a la pool y 435 seguían activos al terminar sus respectivos encuentros. En cada tick se verificó que activos coincidiera con la lista de balas y que activos más disponibles coincidiera con la capacidad. No hubo solicitudes sin espacio, ampliaciones ni discrepancias.

También se hizo una prueba de saturación con 700 proyectiles simultáneos: la capacidad pasó de 512 a 768 en dos bloques de 128. Se conservaron los 700 proyectiles, se devolvieron todos y se reutilizó un objeto primero con 6 HP y luego con 12 HP; daño, propietario e impactos anteriores no persistieron.

Se conectaron dos clientes WebSocket al servidor local: ambos recibieron `game_start` para la misma partida de dos jugadores y el snapshot autoritativo siguiente. La simulación de capacidad usa esa misma ruta autoritativa; no multiplica la pool según los clientes.

## Recomendación

El máximo medido fue de 100 proyectiles activos, frente a 512 disponibles inicialmente: un margen de 5,1 veces el pico (412 espacios libres en el máximo observado). La capacidad inicial de 512 es suficiente para las composiciones probadas. Se recomienda conservarla por ahora: no hace falta aumentarla y estas ocho muestras no justifican reducirla antes de disponer de más patrones y minibosses. Si otro encuentro supera 512, la ampliación automática de 128 evita perder disparos.

Durante las ocho simulaciones no se observaron pausas anómalas del ciclo autoritativo, agotamiento de la pool ni disparos perdidos. Los encuentros avanzaron sin degradación perceptible de la simulación. Cada lote de 1.200 ticks tardó entre 96 y 185 ms en esta ejecución sin renderizado. La prueba headless no mide FPS del navegador y no hubo una línea base anterior a la pool; por tanto, estos datos validan que la capacidad no generó problemas en estas cargas, pero no permiten atribuir un porcentaje de mejora ni garantizar el rendimiento visual en todos los equipos.
