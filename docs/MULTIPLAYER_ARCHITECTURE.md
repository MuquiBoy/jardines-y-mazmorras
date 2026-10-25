# Arquitectura multijugador

## Modelo

Servidor autoritativo de sala sobre WebSocket. Un proceso Node mantiene sesiones en memoria para el prototipo. Cada sala tiene identificador aleatorio no secuencial, host, miembros, clase por miembro, etapa y estado del encuentro. La URL `/?room=<id>` resuelve una invitación concreta. Una sala es privada por posesión del enlace; el identificador funciona como capacidad de acceso y no se deben incluir datos personales. Para despliegue público se exigirían límites de frecuencia, expiración/limpieza de salas y protección de origen.

## Responsabilidades

- Cliente: lobby, selección de clase, captura de controles, interpolación/render y efectos locales no deterministas.
- Servidor: membresía y host, autorización de acciones, estado canónico de sesión, semilla/geometría de mazmorra, movimiento validado, IA, balas/impactos/vida, resultado del encuentro y transiciones.
- Mensajes: eventos de lobby y comandos acotados del cliente; snapshots/eventos versionados del servidor. El cliente no envía “vida nueva” ni puede declarar daño o victoria.

## Flujo

1. Conectar y crear sala; el servidor asigna player ID y token de sesión efímero.
2. Compartir URL de invitación; invitado conecta con el código y recibe snapshot.
3. Elegir clase individualmente; el servidor valida roster y refleja cambios.
4. Solo el host puede iniciar cuando hay al menos dos participantes.
5. Servidor genera una mazmorra con semilla y entidades comunes. Entrada de controles limitada (dirección/apuntado/disparo) y simulación fija; difundir snapshots a ritmo menor, con secuencia y reconciliación.
6. Desconexión: retirar input inmediatamente, conservar jugador como reconectable por un plazo corto o eliminarlo; el anfitrión saliente puede transferirse o cerrar la sesión. Definir antes de añadir persistencia.

## Sincronización del motor

No se debe ejecutar `Game.update()` completo en los navegadores. Separar `Player` en estado, movimiento y aplicación de comandos; separar `DungeonMap.generate(seed)` de efectos del navegador; hacer que el servidor determine spawns/target/daño/muerte/transiciones. Clientes interpolan snapshots y predicen únicamente su movimiento si se valida una reconciliación simple. Empezar con autoridad completa y snapshots antes de añadir predicción.

## Riesgos y despliegue

Las salas en memoria desaparecen al reiniciar y no funcionan entre varios procesos sin afinidad o almacén compartido. Para un prototipo personal, un proceso WebSocket es suficiente. Internet requiere host con WebSocket/HTTPS, dominio público y configuración CORS/origin; localhost no prueba eso. Nunca poner credenciales en el frontend. Un invitado necesita enlace y servidor accesibles desde fuera de la máquina anfitriona.

## Estado actual

`server.js` y `js/coop-lobby.js` implementan salas en memoria para hasta tres jugadores, invitación por `?room=<id>`, selección de clase y comienzo exclusivo por anfitrión. `server/simulation.js` ejecuta el estado autoritativo sobre las clases originales de Abyss Engine: jugador, mazmorra, enemigos, proyectiles, daño y pisos. Cada navegador presenta snapshots de la misma partida. «Jugar sin conexión» inicia el flujo individual original, sin depender del socket. Las sesiones cooperativas siguen siendo locales al proceso; los enlaces `localhost` no funcionan entre redes.

Prueba local realizada: dos pestañas de navegador independientes en `localhost` crearon y unieron una sala, reflejaron la selección Gunslinger en ambos rosters y recibieron el estado de sala lista. También se verificó el protocolo con dos clientes WebSocket independientes. Esto no valida gameplay compartido ni conectividad desde Internet.
