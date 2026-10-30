# Plantillas de salas

La generación del piso lee las salas directamente desde estas carpetas. Añadir, quitar o reemplazar un PNG actualiza el catálogo al iniciar el siguiente piso; no requiere editar código ni mantener una lista manual. En el juego local o en Render, el servidor escanea las carpetas. En un alojamiento estático, usa `manifest.json` como lista de respaldo.

## Categorías

- `entry/`: entrada única y aparición inicial.
- `combat/`: combate simple.
- `combat-hard/`: encuentro difícil.
- `hub/`: descanso seguro.
- `treasure/`: tesoro opcional cuando la geometría permite una rama; de lo contrario queda en la ruta alcanzable.
- `boss/`: sala final.

## Formato

Cada PNG es una máscara de colisión de losas de 40 × 40 px. El ancho y alto pueden variar: ambos deben ser múltiplos de 40 y equivaler como máximo a 64 losas. No se escala ni se recorta la plantilla. Usa colores RGB exactos y evita suavizado.

| Color | Significado | Navegable |
| --- | --- | --- |
| `#00FF00` | Suelo | Sí |
| `#FFFF00` | Puerta; pareja de dos losas en el borde | Sí |
| `#0000FF` | Obstáculo; el azul conectado al borde exterior se interpreta como muro | No |
| `#00FFFF` | Punto de aparición del jugador (opcional) | Sí |
| `#FF00FF` | Casilla de aparición de esbirro: cada casilla genera uno | Sí |
| `#FF0000` u otro color | Muro/sólido; sirve también como contorno visual de autoría | No |

Las puertas deben medir exactamente dos losas y el suelo interior debe formar una zona transitable conectada a todas ellas. El amarillo no se dibuja como pintura: el juego lo reemplaza por el suelo de su paleta. El azul exterior se convierte en muro; las áreas azules cerradas dentro de la sala se dibujan como obstáculos.

## Reglas de generación

Cada piso contiene una entrada, seis combates simples, uno o dos combates difíciles, dos hubs, un tesoro y un jefe. En el piso 1, la cantidad de encuentros difíciles es aleatoria 1–2; en pisos posteriores aumenta gradualmente la probabilidad de generar dos. Los tipos de esbirro se sortean según la tabla de la sala, pero las estadísticas individuales permanecen fijas.

En salas `combat` y `combat-hard`, cada loseta `#FF00FF` genera un esbirro y define su punto de aparición. Una sala `combat-hard` conserva además su único mini-jefe. Si una plantilla aún no tiene marcas magenta, se mantiene temporalmente la cantidad aleatoria anterior (incluido el ajuste por piso); al añadir marcadores, estos determinan la cantidad exacta y sustituyen esa cantidad aleatoria.

El generador rota cada plantilla en incrementos de 90° y solo conecta dos puertas si quedan enfrentadas (lado opuesto), con el mismo ancho de dos losas y el mismo desplazamiento sobre el borde. **La rotación es libre siempre que las puertas coincidan y queden alineadas**; nunca se recorta la sala ni se inventa una abertura.

Si un hub tiene tres puertas, la rama de exploración (encuentro difícil + tesoro) sale de él. Si todos los hubs son pasillos de dos puertas —como en el catálogo actual—, la sala `combat-hard` de tres puertas hace de cruce antes del jefe. En ambos casos se conserva la composición: una entrada, seis combates simples, uno o dos combates difíciles, dos hubs, un tesoro y un jefe.

Pulsa **F3** durante la partida para alternar los límites, identificadores, conexiones y puertas de depuración.

Las plantillas inválidas se omiten con un aviso y no impiden cargar las demás. Si falta una categoría imprescindible, el juego usa temporalmente el generador de respaldo para que la partida siga arrancando.
