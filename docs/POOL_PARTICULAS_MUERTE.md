# Pool de partículas de muerte

- Cada navegador prepara **256 partículas visuales** durante la pantalla de carga inicial y vuelve a dejar esa misma reserva lista durante cada transición de piso. Se reutiliza en impactos, transformación de Bastión y muertes; el servidor cooperativo no crea partículas gráficas.
- Una muerte de esbirro produce 8 partículas, una de mini jefe 12 y una de jefe 20. La composición ordinaria de una sala `combat-hard` del primer piso puede reunir seis esbirros y un mini jefe: si murieran a la vez necesitarían 60 partículas. La reserva de 256 deja espacio para impactos y varios efectos simultáneos.
- Cada partícula dura entre 20 y 35 ticks de simulación. Las activas regresan a la reserva cuando expiran, sin crear objetos nuevos durante el combate ni filtrar arrays en cada tick.
- Si la reserva está llena, se omiten primero los efectos comunes. Una muerte reutiliza una partícula activa, priorizando un impacto, para que la explosión siga visible sin ampliar la reserva en mitad de una pelea.
- El servidor envía a los clientes cooperativos un aviso de muerte con identificador, posición y color. Cada cliente lo reproduce una sola vez y actualiza las partículas según el tiempo transcurrido a 60 Hz, independientemente de la frecuencia del monitor.
- Al iniciar una partida nueva o pasar de piso se devuelven las partículas activas a la reserva antes de jugar. En solitario también se asegura la capacidad de la pool de proyectiles enemigos en cada generación de piso. En cooperativo esa pool pertenece al servidor y se asegura antes de preparar el mapa del piso; cada cliente prepara su propia pool visual al recibir la pantalla de carga. El historial breve de avisos de muerte se descarta después de 120 ticks.

La reserva de partículas es independiente de la pool de 512 proyectiles enemigos.
