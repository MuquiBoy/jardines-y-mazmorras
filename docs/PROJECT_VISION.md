# Visión del proyecto

## Propósito

Crear un roguelite de acción 2D cenital para navegador, pensado desde el inicio para que dos amigos compartan la misma partida cooperativa. La primera versión prioriza una sala privada por invitación, selección independiente de clase y una expedición compartida; las cuentas, el matchmaking público y la progresión permanente quedan fuera de alcance.

## Experiencia prevista

Los jugadores se reúnen en un lobby, eligen entre Piromano Ají, Invocador, Carguero y Gunslinger, y entran juntos en una mazmorra procedural. Cada clase tendrá un kit definido y mejoras temporales por partida. La dirección artística futura combinará héroes vegetales caricaturescos con enemigos insectoides inquietantes. Los gráficos temporales deben estar identificados y no sustituir arte definitivo sin aprobación.

## Principios

- La sesión compartida es parte del primer prototipo jugable, no una capa posterior.
- Una autoridad de servidor decide el estado que afecta a todos: partida, mazmorra, enemigos, daño y transiciones.
- El cliente captura controles, presenta la escena y suaviza la representación de otros jugadores.
- Conservar sistemas útiles de Abyss Engine; cambiar límites arquitectónicos con justificación y trazabilidad.
- Mantener una base pequeña, legible y extensible.

## Criterio para el primer prototipo

Dos clientes independientes deben unirse a la misma sala privada, ver sus selecciones y estar en una misma partida con movimiento y combate compartidos. Un lobby funcional por sí solo no demuestra que el prototipo esté completo. Las pruebas locales no equivalen a validar acceso desde Internet.
