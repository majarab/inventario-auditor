# 📦 ContaPro - Auditor de Inventario y Despacho Físico vs. Listas

Aplicación Web móvil (PWA) diseñada para auditar y conciliar en tiempo real el inventario físico contra las listas de pedidos en Excel, operada por **2 personas simultáneamente desde sus celulares con datos móviles**.

---

## 🚀 Características Principales

1. **Visor de Cámara con Lector de Códigos de Barras:**
   - Lee códigos EAN-13, EAN-8, UPC, Code-128 y QR.
   - Enfoque directo con cámara trasera, botón de linterna y pitido sonoro de confirmación (`beep`).
   - **Auto-Aprendizaje:** La primera vez que escanees un producto que no tenía código de barras en el Excel, la app te pregunta a qué producto pertenece y lo memoriza para siempre.

2. **Búsqueda Táctil Asistida (Para productos sin código):**
   - Productos como harinas, panetones o extractos se buscan escribiendo 2 o 3 letras.
   - Botones táctiles grandes para sumar con una mano: `+1`, `+2`, `✓ Todo` (completa la cantidad del pedido si el lote está conforme) y `✏️` para ingresar cantidad exacta.

3. **Sincronización en Vivo para 2 Personas (Con Datos Móviles):**
   - No requiere estar en la misma red Wi-Fi. Utiliza un canal seguro SSL vía WebSockets (`MQTT`) en la nube.
   - Ambos ingresan a la misma sala (por ejemplo: `TARAPOTO-2026`).
   - Cada producto que escanea o suma la Persona A aparece al instante en el celular de la Persona B, mostrando quién lo contó y la hora exacta.

4. **Semáforo y Conciliación Automática:**
   - 🟢 **✓ COMPLETO:** Físico coincide exactamente con la lista del Excel.
   - 🔴 **FALTANTE:** Faltan unidades físicas respecto a la lista (alerta visual y cálculo de valor económico faltante en Soles).
   - 🟡 **SOBRANTE:** Hay más unidades en físico que las pedidas.
   - ⚪ **PENDIENTE:** Ítems aún no revisados.

5. **Exportación e Informes:**
   - Descarga directa de archivo Excel (`.xlsx`) con el informe de diferencias, precios unitarios e impacto económico.
   - Botón *"Copiar para WhatsApp"*: genera un resumen en texto formateado con emojis listo para pegar en un chat de supervisión.

---

## 📱 ¿Cómo abrir la aplicación desde tus celulares con Datos Móviles?

Dado que ambos operadores usarán **datos móviles (4G/5G)** y la cámara del celular requiere una conexión **HTTPS** por seguridad:

### Opción 1: Túnel Rápido Gratuito (Recomendada desde tu computadora)
En la terminal de esta carpeta, ejecuta:
```bash
# 1. Iniciar el servidor local
node inventario-auditor/server.cjs
```
En otra terminal, abre un túnel HTTPS temporal gratuito con LocalTunnel o Cloudflare:
```bash
npx localtunnel --port 3000
```
Te dará un enlace seguro (ejemplo: `https://rapid-apple-42.loca.lt`).
Ese enlace lo abren las 2 personas desde el navegador de sus celulares (Chrome o Safari) y listo.

---

### Opción 2: Despliegue en la Nube con 1 Clic (100% Permanente y Gratis)
La carpeta `inventario-auditor` contiene archivos web estáticos listos. Puedes:
- Subirla a **Netlify Drop** (arrastrando la carpeta `inventario-auditor` a https://app.netlify.com/drop).
- O publicarla en **Vercel** o **GitHub Pages**.
Te entregará un enlace web que podrás usar hoy y en cualquier inventario futuro.

---

## 👥 Pasos para la Auditoría entre las 2 Personas

1. **Entrar a la misma Sala:**
   - Persona 1 entra a la app, pulsa el botón superior con el puntito verde/amarillo y escribe:
     - Nombre: `Operador 1`
     - Sala: `TARAPOTO-2026`
   - Persona 2 hace exactamente lo mismo:
     - Nombre: `Operador 2`
     - Sala: `TARAPOTO-2026`
2. **Seleccionar el Pedido:**
   - En el menú desplegable elijan el pedido a auditar (ej. `PEDIDO 001`, `PEDIDO 003`, etc.).
3. **Comenzar a Contar:**
   - **Persona 1:** Puede recorrer los estantes con el botón **"Escanear Código"**, apuntando la cámara a los frascos.
   - **Persona 2:** Puede buscar por nombre los productos que no tienen código o verificar las cajas grandes con los botones `+1` / `+2`.
   - La pantalla de ambos se actualizará en tiempo real.
4. **Finalizar y Descargar:**
   - Al terminar, pulsan **"📊 Reporte"** y descargan el Excel con las diferencias o copian el texto para WhatsApp.
