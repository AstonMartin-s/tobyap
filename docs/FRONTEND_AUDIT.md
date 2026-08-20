# Auditoría y Mejoras de Frontend (2026-08-20)

Hice una auditoría completa de los estilos y la interfaz actual. La aplicación ya tiene una buena base funcional y de diseño con CSS puro y variables nativas. Sin embargo, para darle un toque más "premium" y fluido (tipo SaaS moderno), detecté varios puntos de mejora que apliqué directamente en el archivo `globals.css` para que podamos probarlos.

## 🎨 1. Mejoras visuales aplicadas

### a. Elevación y Sombras (Profundidad)
- **Tarjetas (`.card`):** Agregué un efecto de _hover_ sutil que levanta la tarjeta (`transform: translateY(-2px)`) y proyecta una sombra difuminada. Esto le da vida al panel y quita la sensación de "cajas planas".
- **Botones (`.btn`):** Las sombras de los botones principales ahora son más elegantes y el efecto de presionado (active) es más responsivo y fluido.
- **KPIs:** Refiné los bordes e iluminación interior para que destaquen mejor sin ser agresivos.

### b. Transiciones y Fluidez
- Todas las interacciones de entrada (`.input`, `.select`), botones y tarjetas ahora tienen transiciones ( `transition: all 0.2s ease-in-out` ) en lugar de cambios bruscos de estado.
- **Tablas:** Agregué un `hover` en las filas de las tablas ( `tr:hover` ) con un sutil cambio de fondo, lo cual ayuda mucho a seguir la línea visual al leer datos numéricos.

### c. Tipografía y Espaciados
- Aumenté ligeramente la altura de línea (`line-height`) en textos largos para una lectura más descansada.
- Suavizado extra de fuentes (ya estaba configurado, pero se potenció el espaciado).
- Redondeo de bordes (`--radius`) más unificado en componentes chicos y grandes (de 14px a 16px en las cards para un look más moderno).

### d. Interfaz del Chat (Simulador WhatsApp)
- Se añadieron sombras más precisas que imitan mejor el comportamiento nativo de los mensajes flotantes de los móviles.

## 🛠 2. Preguntas para definir pasos siguientes

1. **Colores primarios:** Actualmente el `--accent` (violeta) domina. ¿Estás conforme con este color principal o te gustaría que el panel herede dinámicamente colores de marca del cliente (si es que la herramienta terminará siendo white-label)?
2. **Modo claro vs Oscuro:** ¿Notaste si la mayoría de los administradores prefieren el modo oscuro? Si es así, podemos forzar un contraste ligeramente superior en los textos secundarios (`--muted`) que a veces en monitores de gama media pueden perderse un poco.
3. **Métricas en tiempo real:** ¿Los reportes y KPIs parpadean o cambian al vuelo (sockets)? Si es así, se le puede agregar un pequeño brillo verde temporal a los números cuando incrementan.

---
**Acción:** He aplicado las mejoras en `app/globals.css`. Probá navegar por el panel (Panel de chats, Reportes, Ajustes de chat). Si te gusta el nuevo *feel* (hover, transiciones, sombras y refinamientos), lo dejamos. Si lo sentís distinto a lo que buscabas, deshacemos este paso.