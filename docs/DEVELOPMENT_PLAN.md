# Plan de desarrollo

## Etapa 0 — Base y auditoría

- Importar y preservar Abyss Engine y su licencia MIT.
- Revisar dependencias, estructura y estado ejecutable.
- Aceptación: se documentan partes reutilizables, límites de autoridad y riesgos de recursos externos.

## Etapa 1 — Salas y lobby

- Añadir transporte WebSocket, crear/unirse a sala por enlace, roster, selección individual y acción de inicio exclusiva del host.
- Aceptación: dos clientes separados ven el mismo ID de sesión, jugadores y clases; el enlace entra a esa sesión.

## Etapa 2 — Estado compartido de juego

- Extraer generación de mazmorra con semilla; autoridad de servidor para controles, movimiento, enemigo, daño y muerte.
- Cliente renderiza snapshots usando las primitivas y entidades migradas de Abyss.
- Aceptación: misma sala/habitación/enemigo; un impacto y muerte observados por ambos; transición común.

## Etapa 3 — Robustez cooperativa

- Validación de comandos, secuencia de snapshots, límites de tasas, reconexión y salida; cobertura de desconexión de host/invitado.
- Aceptación: desconexión no congela ni duplica la simulación; sesión inválida produce mensaje entendible.

## Etapa 4 — Contenido y publicación

- Kits de clases, jefes, mejoras compartidas o individuales según diseño, dificultad y arte original.
- Despliegue con WebSocket seguro, prueba externa real y configuración documentada.

## Verificación

Cada etapa registra comando/entorno y resultado real. Probar con dos clientes independientes antes de afirmar sincronización. Distinguir siempre pruebas locales de conectividad pública. No considerar validado un componente solo porque se muestra en la pantalla.

## Progreso del prototipo

- Etapa 0: repositorio clonado, estructura principal y licencia de código auditadas; procedencia/licencia de los tres MP3 pendiente de confirmar.
- Etapa 1: `server.js` sirve el proyecto y mantiene salas efímeras de hasta tres jugadores; invitación por `?room=...`, selección individual y roster compartidos.
- Etapa 2: simulación autoritativa básica reutiliza DungeonMap, Player, Enemy y colisiones de Abyss Engine; admite sala de hasta tres, partida individual alojada por servidor, movimiento, proyectiles, daño, habitaciones y transición de piso compartidas. Requiere más validación de combate, final de partida y reconexión.
- Ruta individual sin conexión: reutiliza el arranque original del motor; disponible desde `file://` con el botón «Jugar sin conexión».
- No se ha probado conectividad desde Internet; el servidor escucha en localhost y las salas desaparecen al cerrarlo.
