# Cliente AgarV1 - Documentación Técnica

Este proyecto es un cliente de Agar.io escalable y moderno, diseñado para ser compatible con servidores **MultiOgar-L-L** y **Cigar2** utilizando el **Protocolo 6**.

## 🚀 Logros Científicos y Técnicos

### 1. Arquitectura Modular (ES6)
El código se ha estructurado siguiendo principios de escalabilidad:
-   **`/assets/js/core`**: Gestión de nodos, lógica del juego y orquestación.
-   **`/assets/js/net`**: Comunicación WebSocket, implementación de protocolos binarios.
-   **`/assets/js/render`**: Motor de renderizado en Canvas 2D con interpolación suave.

### 2. Implementación de Protocolo 6 (Cigar2)
-   **BinaryWriter & BinaryReader**: Clases personalizadas con soporte para UTF8 y gestión de offsets para evitar errores de memoria (`RangeError`).
-   **Handshake v6**: Implementación del saludo oficial (Protocolo 254, versión 6).
-   **Flag-based Parsing**: Sistema eficiente de actualización de nodos basado en máscaras de bits (0x02 color, 0x08 nombre, etc.).

### 3. Sistema de Cámara Avanzado
-   **Seguimiento Multi-Célula**: La cámara calcula el promedio de todos tus trozos tras un split, evitando que se quede "atrapada".
-   **Eliminación de Temblor (Anti-Jitter)**: Sincronización directa con las coordenadas de objetivo del servidor para un movimiento ultra fluido.
-   **Zoom Dinámico**: Ajuste automático basado en el tamaño de la masa del jugador.

### 4. Interfaz de Usuario (UI) Moderna
-   **Estética Premium**: Diseño en modo oscuro con efectos de cristal (glassmorphism) y animaciones sutiles.
-   **HUD en Tiempo Real**: Marcador (Leaderboard), estadísticas de FPS y masa total acumulada.

## 🎮 Controles Implementados
-   **Movimiento**: Ratón.
-   **Dividirse (Split)**: Tecla `Espacio`.
-   **Dar Masa (Feed)**: Tecla `W`.
-   **Menú/UI**: Tecla `Esc` (alternar menú).
-   **Zoom Manual**: Rueda del ratón (`Mouse Wheel`).
-   **Otras acciones**: Teclas `Q`, `E`, `R` preparadas para macros/comandos del servidor.

## 🛠️ Cómo Ejecutar
1. Asegúrate de tener un servidor compatible (ej. `MultiOgar-L-L`) corriendo en `ws://localhost:8080`.
2. Abre `index.html` en un navegador moderno.
3. ¡Ingresa tu nick y domina el mapa!

---
*Desarrollado con precisión técnica por Antigravity.*
