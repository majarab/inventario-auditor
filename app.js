import { INITIAL_PEDIDOS } from './pedidos_data.js';

// ========================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ========================================================
let pedidos = [];
let pedidoActualId = null;
let filtroActual = 'TODOS'; // 'TODOS' | 'PENDIENTES' | 'OK' | 'DIFERENCIAS'
let busquedaTexto = '';

// Usuario y Sala Multiusuario (Tiempo Real)
let currentUser = localStorage.getItem('contapro_username') || `Operador-${Math.floor(Math.random() * 900 + 100)}`;
let currentRoom = localStorage.getItem('contapro_room') || 'TARAPOTO-2026';
let mqttClient = null;
let isConnectedToRoom = false;

// Mapa de códigos de barras aprendidos: { "775123456789": "PEDIDO 001-1" }
let barcodesMap = JSON.parse(localStorage.getItem('contapro_barcodes') || '{}');

// Instancia del escáner de cámara
let html5QrCode = null;
let isScannerOpen = false;
let isTorchOn = false;
let ultimoCodigoEscaneado = null;
let cooldownEscaneo = 0; // Para evitar lecturas duplicadas en el mismo segundo

// ========================================================
// INICIALIZACIÓN
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  cargarPedidosDesdeStorage();
  inicializarSelectorPedidos();
  inicializarSincronizacion();
  configurarEventosExcel();
  renderizarPantalla();
});

// Guardar y cargar estado
function cargarPedidosDesdeStorage() {
  const guardado = localStorage.getItem('contapro_pedidos');
  if (guardado) {
    try {
      pedidos = JSON.parse(guardado);
    } catch (e) {
      console.warn('Error al leer storage, usando iniciales', e);
      pedidos = JSON.parse(JSON.stringify(INITIAL_PEDIDOS));
    }
  } else {
    pedidos = JSON.parse(JSON.stringify(INITIAL_PEDIDOS));
    guardarEnStorage();
  }

  // Cargar pedido seleccionado previamente o el primero
  const ultimoSel = localStorage.getItem('contapro_pedido_sel');
  if (ultimoSel && pedidos.some(p => p.id === ultimoSel)) {
    pedidoActualId = ultimoSel;
  } else if (pedidos.length > 0) {
    pedidoActualId = pedidos[0].id;
  }
}

function guardarEnStorage() {
  localStorage.setItem('contapro_pedidos', JSON.stringify(pedidos));
  localStorage.setItem('contapro_barcodes', JSON.stringify(barcodesMap));
}

// ========================================================
// SELECTOR Y NAVEGACIÓN DE PEDIDOS
// ========================================================
function inicializarSelectorPedidos() {
  const select = document.getElementById('select-pedido');
  select.innerHTML = '';
  pedidos.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.id} - ${p.destino} (${p.items.length} ítems) [${p.fecha || 'Sin fecha'}]`;
    if (p.id === pedidoActualId) opt.selected = true;
    select.appendChild(opt);
  });
}

window.cambiarPedido = function(id) {
  pedidoActualId = id;
  localStorage.setItem('contapro_pedido_sel', id);
  busquedaTexto = '';
  document.getElementById('buscador-input').value = '';
  document.getElementById('btn-limpiar-busq').classList.add('hidden');
  renderizarPantalla();
};

function getPedidoActual() {
  return pedidos.find(p => p.id === pedidoActualId) || pedidos[0];
}

// ========================================================
// RENDERIZADO PRINCIPAL DE LA VISTA
// ========================================================
function renderizarPantalla() {
  const pedido = getPedidoActual();
  if (!pedido) return;

  // Actualizar subtítulo
  document.getElementById('pedido-subtitulo').textContent = `${pedido.cliente} | Destino: ${pedido.destino} | ${pedido.fecha || ''}`;

  // Calcular KPIs y totales
  let totalItems = pedido.items.length;
  let itemsCompletos = 0;
  let itemsDiferencias = 0;
  let itemsPendientes = 0;

  pedido.items.forEach(it => {
    const esperado = Number(it.cantidadEsperada) || 0;
    const fisico = Number(it.cantidadFisica) || 0;

    if (fisico === 0) {
      itemsPendientes++;
      it.estado = 'PENDIENTE';
    } else if (fisico === esperado) {
      itemsCompletos++;
      it.estado = 'OK';
    } else {
      itemsDiferencias++;
      it.estado = 'DIFERENCIA';
    }
  });

  const revisados = itemsCompletos + itemsDiferencias;
  const pct = totalItems > 0 ? Math.round((revisados / totalItems) * 100) : 0;
  const pctOk = totalItems > 0 ? (itemsCompletos / totalItems) * 100 : 0;
  const pctDiff = totalItems > 0 ? (itemsDiferencias / totalItems) * 100 : 0;

  // Actualizar indicadores numéricos
  document.getElementById('kpi-porcentaje').textContent = `${pct}%`;
  document.getElementById('kpi-contados').textContent = revisados;
  document.getElementById('kpi-total-items').textContent = totalItems;

  document.getElementById('progreso-ok').style.width = `${pctOk}%`;
  document.getElementById('progreso-diff').style.width = `${pctDiff}%`;

  document.getElementById('count-todos').textContent = totalItems;
  document.getElementById('count-pendientes').textContent = itemsPendientes;
  document.getElementById('count-ok').textContent = itemsCompletos;
  document.getElementById('count-diff').textContent = itemsDiferencias;

  actualizarEstiloBotonesFiltro();

  // Filtrar lista de productos
  const contenedor = document.getElementById('lista-productos');
  contenedor.innerHTML = '';

  const itemsFiltrados = pedido.items.filter(it => {
    // Filtro por estado
    if (filtroActual === 'PENDIENTES' && it.estado !== 'PENDIENTE') return false;
    if (filtroActual === 'OK' && it.estado !== 'OK') return false;
    if (filtroActual === 'DIFERENCIAS' && it.estado !== 'DIFERENCIA') return false;

    // Filtro por texto de búsqueda
    if (busquedaTexto.trim()) {
      const q = busquedaTexto.toLowerCase();
      const matchNom = it.producto.toLowerCase().includes(q);
      const matchNro = String(it.itemNro).includes(q);
      const matchCod = it.codigoBarra && it.codigoBarra.toLowerCase().includes(q);
      return matchNom || matchNro || matchCod;
    }
    return true;
  });

  if (itemsFiltrados.length === 0) {
    contenedor.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-slate-800/40 rounded-2xl border border-slate-700/60 my-4">
        <p class="text-2xl mb-1">🔍</p>
        <p class="text-sm font-semibold text-slate-300">No se encontraron productos</p>
        <p class="text-xs text-slate-500 mt-1">Prueba con otro término o cambia el filtro de arriba.</p>
      </div>
    `;
    return;
  }

  // Generar tarjetas de producto
  itemsFiltrados.forEach(it => {
    const card = crearTarjetaProducto(it);
    contenedor.appendChild(card);
  });
}

function crearTarjetaProducto(it) {
  const div = document.createElement('div');
  const esperado = Number(it.cantidadEsperada) || 0;
  const fisico = Number(it.cantidadFisica) || 0;
  const diff = fisico - esperado;

  // Clases según semáforo
  let borderColor = 'border-slate-700';
  let badgeHtml = '';

  if (it.estado === 'OK') {
    borderColor = 'border-emerald-500/70 bg-emerald-950/20';
    badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">✓ COMPLETO</span>`;
  } else if (it.estado === 'DIFERENCIA') {
    if (diff < 0) {
      borderColor = 'border-rose-500/80 bg-rose-950/20';
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">FALTAN ${Math.abs(diff)}</span>`;
    } else {
      borderColor = 'border-amber-500/80 bg-amber-950/20';
      badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">SOBRAN +${diff}</span>`;
    }
  } else {
    borderColor = 'border-slate-700 bg-slate-800/50';
    badgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700 text-slate-400">PENDIENTE</span>`;
  }

  const verificadoInfo = it.verificadoPor ? `
    <div class="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
      <span>👤 Por: <strong class="text-slate-300">${it.verificadoPor}</strong></span>
      <span>•</span>
      <span>${it.fechaVerificacion || ''}</span>
    </div>
  ` : '';

  const barcodeInfo = it.codigoBarra ? `
    <span class="text-[10px] text-emerald-400 font-mono bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/60">
      🏷️ ${it.codigoBarra}
    </span>
  ` : '';

  div.className = `p-3 rounded-2xl border ${borderColor} transition shadow-sm space-y-2`;
  div.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">#${it.itemNro}</span>
          ${badgeHtml}
          ${barcodeInfo}
        </div>
        <h4 class="text-xs font-semibold text-white mt-1 leading-snug">${it.producto}</h4>
        <div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
          <span>P. Unit: <strong class="text-slate-300">S/ ${Number(it.precioUnitario).toFixed(2)}</strong></span>
          <span>•</span>
          <span>Total: <strong class="text-slate-300">S/ ${Number(it.totalEsperado).toFixed(2)}</strong></span>
        </div>
        ${verificadoInfo}
      </div>

      <!-- Conteo Esperado vs Físico -->
      <div class="text-right shrink-0 bg-slate-900/80 px-2.5 py-1.5 rounded-xl border border-slate-700/80">
        <div class="text-[9px] text-slate-400 font-medium">ESPERADO</div>
        <div class="text-sm font-bold text-slate-300">${esperado}</div>
        <div class="text-[9px] text-slate-400 font-medium mt-1">FÍSICO</div>
        <div class="text-base font-extrabold ${fisico === esperado ? 'text-emerald-400' : (fisico === 0 ? 'text-slate-400' : 'text-rose-400')}">
          ${fisico}
        </div>
      </div>
    </div>

    <!-- BOTONES TÁCTILES RÁPIDOS DE CONTEO -->
    <div class="pt-2 border-t border-slate-700/60 flex items-center gap-1.5">
      <!-- Botón -1 -->
      <button onclick="ajustarCantidad('${it.id}', -1)" class="touch-btn w-9 h-9 rounded-xl bg-slate-700 active:bg-slate-600 text-white font-bold text-sm flex items-center justify-center border border-slate-600">
        -1
      </button>

      <!-- Botón +1 -->
      <button onclick="ajustarCantidad('${it.id}', 1)" class="touch-btn flex-1 h-9 rounded-xl bg-emerald-600 active:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm">
        <span>+1</span>
      </button>

      <!-- Botón +2 (Común por las compras en pares) -->
      <button onclick="ajustarCantidad('${it.id}', 2)" class="touch-btn w-11 h-9 rounded-xl bg-slate-700 active:bg-slate-600 text-emerald-400 font-bold text-xs flex items-center justify-center border border-slate-600">
        +2
      </button>

      <!-- Botón Completar Todo (Físico = Esperado) -->
      <button onclick="completarProducto('${it.id}')" title="Completar todo lo esperado" class="touch-btn px-2.5 h-9 rounded-xl ${fisico === esperado ? 'bg-slate-800 text-slate-500 border border-slate-700' : 'bg-teal-600/30 hover:bg-teal-600/50 text-teal-300 border border-teal-500/50'} text-[11px] font-bold flex items-center justify-center">
        ✓ Todo
      </button>

      <!-- Botón Editar manual -->
      <button onclick="editarCantidadManual('${it.id}', ${fisico})" title="Ingresar número exacto" class="touch-btn w-9 h-9 rounded-xl bg-slate-700 active:bg-slate-600 text-slate-300 font-bold text-xs flex items-center justify-center border border-slate-600">
        ✏️
      </button>
    </div>
  `;
  return div;
}

// ========================================================
// OPERACIONES DE CONTEO FÍSICO
// ========================================================
window.ajustarCantidad = function(itemId, delta) {
  const pedido = getPedidoActual();
  const item = pedido.items.find(i => i.id === itemId);
  if (!item) return;

  const nuevaCant = Math.max(0, (Number(item.cantidadFisica) || 0) + delta);
  actualizarItemFisico(item, nuevaCant);
};

window.completarProducto = function(itemId) {
  const pedido = getPedidoActual();
  const item = pedido.items.find(i => i.id === itemId);
  if (!item) return;

  actualizarItemFisico(item, item.cantidadEsperada);
};

window.editarCantidadManual = function(itemId, actual) {
  const pedido = getPedidoActual();
  const item = pedido.items.find(i => i.id === itemId);
  if (!item) return;

  const val = prompt(`Ingresa la cantidad física contada para:\n"${item.producto}"`, actual);
  if (val !== null && !isNaN(Number(val))) {
    actualizarItemFisico(item, Math.max(0, parseInt(val)));
  }
};

function actualizarItemFisico(item, nuevaCant, originUser = currentUser) {
  item.cantidadFisica = nuevaCant;
  item.verificadoPor = originUser;
  const ahora = new Date();
  item.fechaVerificacion = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  guardarEnStorage();
  renderizarPantalla();

  // Si el cambio lo hizo el usuario local, avisar por MQTT a la otra persona
  if (originUser === currentUser) {
    playBeep();
    enviarEventoMQTT({
      type: 'ITEM_UPDATE',
      pedidoId: pedidoActualId,
      itemId: item.id,
      cantidadFisica: nuevaCant,
      user: currentUser,
      timestamp: item.fechaVerificacion
    });
  }
}

// ========================================================
// FILTROS Y BÚSQUEDA
// ========================================================
window.setFiltro = function(filtro) {
  filtroActual = filtro;
  renderizarPantalla();
};

function actualizarEstiloBotonesFiltro() {
  ['TODOS', 'PENDIENTES', 'OK', 'DIFERENCIAS'].forEach(f => {
    const btn = document.getElementById(`filtro-btn-${f}`);
    if (f === filtroActual) {
      btn.className = 'py-1 px-1.5 rounded bg-emerald-600 text-white font-bold border border-emerald-500 shadow-sm';
    } else {
      btn.className = 'py-1 px-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700';
    }
  });
}

window.filtrarProductos = function(texto) {
  busquedaTexto = texto;
  const btnLimpiar = document.getElementById('btn-limpiar-busq');
  if (texto.trim()) {
    btnLimpiar.classList.remove('hidden');
  } else {
    btnLimpiar.classList.add('hidden');
  }
  renderizarPantalla();
};

window.limpiarBuscador = function() {
  document.getElementById('buscador-input').value = '';
  window.filtrarProductos('');
};

// ========================================================
// LECTOR DE CÁMARA (HTML5-QRCODE + AUTOAPRENDIZAJE)
// ========================================================
window.abrirEscanerCamara = async function() {
  const modal = document.getElementById('modal-escaner');
  modal.classList.remove('hidden');
  isScannerOpen = true;

  const feedback = document.getElementById('scanner-feedback');
  feedback.textContent = 'Iniciando cámara trasera...';

  try {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("reader");
    }

    const config = {
      fps: 15,
      qrbox: { width: 260, height: 160 },
      aspectRatio: 1.0,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // BarcodeDetector nativo de alta velocidad en Android
      }
    };

    await html5QrCode.start(
      { facingMode: "environment" }, // Cámara trasera obligatoria
      config,
      onCodigoDetectado,
      (errorMessage) => {
        // Ignorar errores de frame vacío
      }
    );

    feedback.textContent = 'Cámara activa. Enfoca el código de barras.';
  } catch (err) {
    console.error('Error al iniciar cámara', err);
    feedback.innerHTML = `<span class="text-rose-400 font-bold">Error de acceso a la cámara. Concede permisos de cámara en tu navegador.</span>`;
  }
};

window.cerrarEscanerCamara = async function() {
  if (html5QrCode && isScannerOpen) {
    try {
      await html5QrCode.stop();
    } catch (e) {
      console.warn('Error al detener cámara', e);
    }
  }
  document.getElementById('modal-escaner').classList.add('hidden');
  isScannerOpen = false;
};

window.toggleFlash = async function() {
  if (!html5QrCode) return;
  try {
    isTorchOn = !isTorchOn;
    await html5QrCode.applyVideoConstraints({
      advanced: [{ torch: isTorchOn }]
    });
    document.getElementById('btn-flash').textContent = isTorchOn ? '🔦 Apagar Linterna' : '🔦 Linterna';
  } catch (e) {
    alert('La linterna no está disponible en este dispositivo o cámara.');
  }
};

// Manejo de lectura de código
function onCodigoDetectado(decodedText) {
  const now = Date.now();
  if (now - cooldownEscaneo < 1500 && ultimoCodigoEscaneado === decodedText) {
    return; // Evita doble lectura inmediata del mismo producto
  }
  cooldownEscaneo = now;
  ultimoCodigoEscaneado = decodedText;

  const feedback = document.getElementById('scanner-feedback');
  feedback.innerHTML = `<span class="text-emerald-400 font-bold">Leído: ${decodedText}</span>`;
  playBeep();

  // 1. Verificar si ya tenemos mapeado este código a un producto
  const itemIdMapeado = barcodesMap[decodedText];
  const pedido = getPedidoActual();

  let item = null;
  if (itemIdMapeado) {
    item = pedido.items.find(i => i.id === itemIdMapeado);
  }

  // 2. Si no estaba en el mapa, buscar si algún ítem ya tenía ese código
  if (!item) {
    item = pedido.items.find(i => i.codigoBarra === decodedText);
  }

  if (item) {
    // Producto ya conocido: Sumar +1 automáticamente
    const nuevaCant = (Number(item.cantidadFisica) || 0) + 1;
    actualizarItemFisico(item, nuevaCant);
    feedback.innerHTML = `<span class="text-emerald-300 font-bold">✓ +1 a "${item.producto}" (${nuevaCant}/${item.cantidadEsperada})</span>`;
  } else {
    // Código nuevo: Abrir diálogo de Auto-Aprendizaje
    abrirModalAsociarCodigo(decodedText);
  }
}

// Autoaprendizaje: Asociar código nuevo a un producto de la lista
let codigoNuevoPendiente = null;

function abrirModalAsociarCodigo(codigo) {
  codigoNuevoPendiente = codigo;
  document.getElementById('lbl-codigo-nuevo').textContent = codigo;
  document.getElementById('asociar-filtro').value = '';
  document.getElementById('modal-asociar-codigo').classList.remove('hidden');
  renderizarOpcionesAsociacion('');
}

window.cerrarModalAsociar = function() {
  document.getElementById('modal-asociar-codigo').classList.add('hidden');
  codigoNuevoPendiente = null;
};

window.filtrarParaAsociar = function(texto) {
  renderizarOpcionesAsociacion(texto);
};

function renderizarOpcionesAsociacion(filtro) {
  const contenedor = document.getElementById('asociar-lista');
  contenedor.innerHTML = '';
  const pedido = getPedidoActual();

  const filtrados = pedido.items.filter(it => {
    if (!filtro) return true;
    return it.producto.toLowerCase().includes(filtro.toLowerCase()) || String(it.itemNro).includes(filtro);
  });

  if (filtrados.length === 0) {
    contenedor.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs">No hay productos que coincidan.</div>`;
    return;
  }

  filtrados.forEach(it => {
    const btn = document.createElement('button');
    btn.className = 'w-full text-left p-2 rounded-lg bg-slate-900/80 hover:bg-emerald-950/60 border border-slate-700 hover:border-emerald-500/60 transition flex items-center justify-between';
    btn.innerHTML = `
      <div class="truncate pr-2">
        <span class="text-slate-400 font-mono text-[10px]">#${it.itemNro}</span>
        <strong class="text-white text-xs block truncate">${it.producto}</strong>
      </div>
      <span class="text-emerald-400 text-xs font-bold shrink-0">Vincular</span>
    `;
    btn.onclick = () => vincularCodigoAItem(it.id, codigoNuevoPendiente);
    contenedor.appendChild(btn);
  });
}

function vincularCodigoAItem(itemId, codigo) {
  const pedido = getPedidoActual();
  const item = pedido.items.find(i => i.id === itemId);
  if (!item) return;

  // Guardar en el mapa
  barcodesMap[codigo] = item.id;
  item.codigoBarra = codigo;

  // Sumar 1 de inmediato al asociar
  const nuevaCant = (Number(item.cantidadFisica) || 0) + 1;
  actualizarItemFisico(item, nuevaCant);

  // Avisar por MQTT la nueva vinculación
  enviarEventoMQTT({
    type: 'BIND_BARCODE',
    codigo: codigo,
    itemId: item.id
  });

  cerrarModalAsociar();
  guardarEnStorage();

  const feedback = document.getElementById('scanner-feedback');
  feedback.innerHTML = `<span class="text-emerald-300 font-bold">✓ Vinculado a "${item.producto}" (+1 sumado)</span>`;
}

// ========================================================
// SINCRONIZACIÓN EN TIEMPO REAL VÍA MQTT WEBSOCKETS (SSL)
// ========================================================
function inicializarSincronizacion() {
  document.getElementById('input-username').value = currentUser;
  document.getElementById('input-room').value = currentRoom;

  conectarBrokerMQTT();
}

function conectarBrokerMQTT() {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const statusText = document.getElementById('room-status-text');

  dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
  label.textContent = 'Conectando...';
  if (statusText) statusText.textContent = 'Conectando a sala...';

  // Usamos el broker MQTT público de alta disponibilidad sobre WebSockets SSL (puerto 8084)
  const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  const clientId = `contapro_${Math.random().toString(16).substring(2, 10)}`;

  try {
    if (mqttClient) {
      mqttClient.end(true);
    }

    mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });

    const topic = `contapro/inventario/${currentRoom.toLowerCase()}`;

    mqttClient.on('connect', () => {
      isConnectedToRoom = true;
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      label.textContent = `${currentUser} (${currentRoom})`;
      if (statusText) statusText.textContent = `🟢 En línea en sala: ${currentRoom}`;

      // Suscribirse a la sala
      mqttClient.subscribe(topic, (err) => {
        if (!err) {
          // Solicitar estado a otros miembros si ya estaban adentro
          enviarEventoMQTT({ type: 'SYNC_REQUEST', user: currentUser });
        }
      });
    });

    mqttClient.on('message', (top, message) => {
      try {
        const payload = JSON.parse(message.toString());
        procesarEventoRemoto(payload);
      } catch (e) {
        console.warn('Error al procesar mensaje MQTT', e);
      }
    });

    mqttClient.on('error', (err) => {
      console.warn('Error de conexión MQTT', err);
      dot.className = 'w-2 h-2 rounded-full bg-rose-500';
      label.textContent = 'Sin conexión';
      if (statusText) statusText.textContent = '🔴 Error al conectar con sala';
    });

    mqttClient.on('offline', () => {
      dot.className = 'w-2 h-2 rounded-full bg-slate-500';
      label.textContent = 'Offline';
      if (statusText) statusText.textContent = '⚪ Desconectado';
    });

  } catch (e) {
    console.error('Fallo al inicializar cliente MQTT', e);
  }
}

function enviarEventoMQTT(evento) {
  if (!mqttClient || !mqttClient.connected) return;
  const topic = `contapro/inventario/${currentRoom.toLowerCase()}`;
  mqttClient.publish(topic, JSON.stringify(evento), { qos: 1 });
}

function procesarEventoRemoto(evento) {
  // Ignorar los eventos que uno mismo emitió
  if (evento.user === currentUser && evento.type !== 'SYNC_REQUEST') return;

  if (evento.type === 'ITEM_UPDATE') {
    const pedido = pedidos.find(p => p.id === evento.pedidoId);
    if (!pedido) return;
    const item = pedido.items.find(i => i.id === evento.itemId);
    if (!item) return;

    item.cantidadFisica = evento.cantidadFisica;
    item.verificadoPor = evento.user;
    item.fechaVerificacion = evento.timestamp;

    guardarEnStorage();
    renderizarPantalla();

    // Mostrar Toast de notificación
    mostrarToast(`👥 ${evento.user} actualizó "${item.producto}" a ${evento.cantidadFisica}`);
  }

  if (evento.type === 'BIND_BARCODE') {
    barcodesMap[evento.codigo] = evento.itemId;
    guardarEnStorage();
    mostrarToast(`🏷️ ${evento.user} vinculó nuevo código de barra`);
  }

  if (evento.type === 'SYNC_REQUEST') {
    // Si otro compañero recién entra, le enviamos nuestro estado para que esté al día
    if (evento.user !== currentUser) {
      enviarEventoMQTT({
        type: 'SYNC_RESPONSE',
        toUser: evento.user,
        pedidos: pedidos,
        barcodesMap: barcodesMap,
        user: currentUser
      });
    }
  }

  if (evento.type === 'SYNC_RESPONSE' && evento.toUser === currentUser) {
    // Recibimos la sincronización inicial del compañero
    if (evento.pedidos && evento.pedidos.length > 0) {
      pedidos = evento.pedidos;
      barcodesMap = Object.assign({}, barcodesMap, evento.barcodesMap || {});
      guardarEnStorage();
      renderizarPantalla();
      mostrarToast(`⚡ Sincronizado con datos de ${evento.user}`);
    }
  }
}

function mostrarToast(texto) {
  const toast = document.getElementById('activity-toast');
  const msg = document.getElementById('toast-text');
  msg.textContent = texto;
  toast.classList.remove('hidden');

  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

window.ocultarToast = function() {
  document.getElementById('activity-toast').classList.add('hidden');
};

// ========================================================
// MODAL DE SALA
// ========================================================
window.openRoomModal = function() {
  document.getElementById('modal-room').classList.remove('hidden');
};

window.closeRoomModal = function() {
  document.getElementById('modal-room').classList.add('hidden');
};

window.generarSalaAleatoria = function() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  document.getElementById('input-room').value = `INV-${rand}`;
};

window.guardarYConectarSala = function() {
  const user = document.getElementById('input-username').value.trim() || `Usuario-${Math.floor(Math.random() * 100)}`;
  const room = document.getElementById('input-room').value.trim().toUpperCase() || 'TARAPOTO-2026';

  currentUser = user;
  currentRoom = room;

  localStorage.setItem('contapro_username', currentUser);
  localStorage.setItem('contapro_room', currentRoom);

  conectarBrokerMQTT();
  closeRoomModal();
};

// ========================================================
// REPORTE DE DISCREPANCIAS Y EXPORTACIÓN
// ========================================================
window.openResumenModal = function() {
  const pedido = getPedidoActual();
  const modal = document.getElementById('modal-resumen');
  modal.classList.remove('hidden');

  let ok = 0;
  let falt = 0;
  let sob = 0;
  let perdidaSoles = 0;

  const lista = document.getElementById('resumen-lista-diferencias');
  lista.innerHTML = '';

  const diferencias = [];

  pedido.items.forEach(it => {
    const esp = Number(it.cantidadEsperada) || 0;
    const fis = Number(it.cantidadFisica) || 0;
    const diff = fis - esp;

    if (fis === esp) {
      ok++;
    } else if (diff < 0) {
      falt++;
      const valFalt = Math.abs(diff) * Number(it.precioUnitario);
      perdidaSoles += valFalt;
      diferencias.push({ ...it, diff, valDiff: valFalt, tipo: 'FALTANTE' });
    } else {
      sob++;
      const valSob = diff * Number(it.precioUnitario);
      diferencias.push({ ...it, diff, valDiff: valSob, tipo: 'SOBRANTE' });
    }
  });

  document.getElementById('resumen-ok').textContent = ok;
  document.getElementById('resumen-faltantes').textContent = falt;
  document.getElementById('resumen-sobrantes').textContent = sob;
  document.getElementById('resumen-total-diff-val').textContent = `Diferencia Valorizada: S/ ${perdidaSoles.toFixed(2)}`;

  if (diferencias.length === 0) {
    lista.innerHTML = `
      <div class="p-4 text-center text-emerald-400 font-semibold">
        🎉 ¡Excelente! No hay discrepancias en este pedido. Todo el físico coincide con la lista del Excel.
      </div>
    `;
    return;
  }

  diferencias.forEach(d => {
    const row = document.createElement('div');
    const isFalt = d.tipo === 'FALTANTE';
    row.className = `p-2 rounded-lg border ${isFalt ? 'border-rose-700/60 bg-rose-950/30' : 'border-amber-700/60 bg-amber-950/30'} flex items-center justify-between gap-2`;
    row.innerHTML = `
      <div class="truncate">
        <span class="text-[10px] font-bold px-1 rounded ${isFalt ? 'bg-rose-900 text-rose-300' : 'bg-amber-900 text-amber-300'}">
          ${isFalt ? `FALTAN ${Math.abs(d.diff)}` : `SOBRAN +${d.diff}`}
        </span>
        <strong class="text-white text-xs block truncate mt-0.5">${d.producto}</strong>
        <span class="text-[10px] text-slate-400">Esperado: ${d.cantidadEsperada} | Físico: ${d.cantidadFisica}</span>
      </div>
      <div class="text-right shrink-0">
        <div class="text-xs font-bold ${isFalt ? 'text-rose-400' : 'text-amber-400'}">
          S/ ${d.valDiff.toFixed(2)}
        </div>
        <div class="text-[9px] text-slate-400">P.U: S/ ${Number(d.precioUnitario).toFixed(2)}</div>
      </div>
    `;
    lista.appendChild(row);
  });
};

window.closeResumenModal = function() {
  document.getElementById('modal-resumen').classList.add('hidden');
};

window.exportarExcelAuditoria = function() {
  const pedido = getPedidoActual();

  const dataRows = [
    ["INFORME DE AUDITORÍA Y CONCILIACIÓN FÍSICO VS LISTA"],
    [`Pedido: ${pedido.id}`, `Cliente: ${pedido.cliente}`, `Destino: ${pedido.destino}`, `Fecha: ${pedido.fecha || ''}`],
    [`Generado: ${new Date().toLocaleString()}`, `Auditor: ${currentUser}`, `Sala: ${currentRoom}`],
    [],
    [
      "NRO",
      "PRODUCTO",
      "CANT. ESPERADA (EXCEL)",
      "CANT. FÍSICA (CONTEO)",
      "DIFERENCIA",
      "ESTADO",
      "PRECIO BASE",
      "IGV (18%)",
      "PRECIO UNITARIO",
      "TOTAL ESPERADO",
      "TOTAL FÍSICO VALORIZADO",
      "IMPACTO ECONÓMICO",
      "CÓDIGO BARRA",
      "AUDITADO POR",
      "HORA AUDITORÍA"
    ]
  ];

  pedido.items.forEach(it => {
    const esp = Number(it.cantidadEsperada) || 0;
    const fis = Number(it.cantidadFisica) || 0;
    const diff = fis - esp;
    const pu = Number(it.precioUnitario) || 0;
    const totalFisico = fis * pu;
    const impacto = diff * pu;

    dataRows.push([
      it.itemNro,
      it.producto,
      esp,
      fis,
      diff,
      it.estado,
      Number(it.precioBase).toFixed(2),
      Number(it.igv).toFixed(2),
      pu.toFixed(2),
      Number(it.totalEsperado).toFixed(2),
      totalFisico.toFixed(2),
      impacto.toFixed(2),
      it.codigoBarra || '',
      it.verificadoPor || '',
      it.fechaVerificacion || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Auditoria_Inventario");

  const cleanName = pedido.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `Auditoria_${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

window.copiarReportePortapapeles = function() {
  const pedido = getPedidoActual();
  let txt = `📦 *REPORTE DE AUDITORÍA - ${pedido.id}*\n`;
  txt += `👤 Cliente: ${pedido.cliente} | Destino: ${pedido.destino}\n`;
  txt += `📅 Fecha: ${pedido.fecha || ''} | Auditor: ${currentUser}\n\n`;

  let faltantes = 0;
  let sobrantes = 0;
  let ok = 0;

  pedido.items.forEach(it => {
    const esp = Number(it.cantidadEsperada) || 0;
    const fis = Number(it.cantidadFisica) || 0;
    const diff = fis - esp;

    if (diff === 0) ok++;
    else if (diff < 0) {
      faltantes++;
      txt += `❌ FALTAN ${Math.abs(diff)}: ${it.producto} (Esperado: ${esp}, Físico: ${fis})\n`;
    } else {
      sobrantes++;
      txt += `⚠️ SOBRAN +${diff}: ${it.producto} (Esperado: ${esp}, Físico: ${fis})\n`;
    }
  });

  txt += `\n📊 *Resumen*: ${ok} Conformes | ${faltantes} Faltantes | ${sobrantes} Sobrantes.`;

  navigator.clipboard.writeText(txt).then(() => {
    alert('¡Reporte copiado al portapapeles! Puedes pegarlo directamente en WhatsApp.');
  }).catch(() => {
    prompt('Copia el reporte aquí:', txt);
  });
};

window.confirmarReinicioPedido = function() {
  const pedido = getPedidoActual();
  if (confirm(`¿Estás seguro de reiniciar a CERO todos los conteos físicos de "${pedido.id}"? Esta acción borrará los registros del pedido actual.`)) {
    pedido.items.forEach(it => {
      it.cantidadFisica = 0;
      it.verificadoPor = null;
      it.fechaVerificacion = null;
    });
    guardarEnStorage();
    renderizarPantalla();
    closeResumenModal();

    enviarEventoMQTT({
      type: 'SYNC_RESPONSE',
      toUser: 'ALL',
      pedidos: pedidos,
      barcodesMap: barcodesMap,
      user: currentUser
    });
  }
};

// ========================================================
// IMPORTACIÓN DE ARCHIVOS EXCEL NUEVOS
// ========================================================
function configurarEventosExcel() {
  const input = document.getElementById('file-excel-import');
  if (!input) return;

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        procesarExcelImportado(file.name, json);
      } catch (err) {
        alert('Error al leer el archivo Excel: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function procesarExcelImportado(filename, rows) {
  if (rows.length < 2) {
    alert('El archivo no contiene suficientes filas.');
    return;
  }

  const nuevoId = filename.replace(/\.[^/.]+$/, "").toUpperCase();
  const nuevoPedido = {
    id: `IMPORTADO: ${nuevoId}`,
    rawCode: nuevoId,
    fecha: new Date().toISOString().slice(0, 10),
    destino: 'ALMACEN',
    cliente: 'CLIENTE IMPORTADO',
    items: [],
    subtotalOriginal: 0,
    totalOriginal: 0,
    gastosAdicionales: [],
    pagos: []
  };

  let itemIdx = 1;

  rows.forEach((r, idx) => {
    if (idx === 0) return; // Cabecera
    // Detectar producto y cantidad en las columnas
    const prod = r.find(col => typeof col === 'string' && col.trim().length > 2 && !/total|precio|cantidad/i.test(col));
    const cant = r.find(col => typeof col === 'number' && col > 0) || 1;
    const precio = r.find((col, i) => typeof col === 'number' && i > 2) || 0;

    if (prod) {
      nuevoPedido.items.push({
        id: `${nuevoId}-${itemIdx}`,
        itemNro: itemIdx,
        producto: String(prod).trim(),
        cantidadEsperada: Number(cant),
        cantidadFisica: 0,
        estado: 'PENDIENTE',
        precioBase: Number(precio),
        igv: Number(precio) * 0.18,
        precioUnitario: Number(precio) * 1.18,
        totalEsperado: Number(cant) * (Number(precio) * 1.18),
        codigoBarra: '',
        verificadoPor: null,
        fechaVerificacion: null,
        notas: ''
      });
      itemIdx++;
    }
  });

  if (nuevoPedido.items.length === 0) {
    alert('No se pudieron extraer productos válidos del archivo.');
    return;
  }

  pedidos.unshift(nuevoPedido);
  pedidoActualId = nuevoPedido.id;
  guardarEnStorage();
  inicializarSelectorPedidos();
  renderizarPantalla();
  closeMenuModal();
  alert(`¡Pedido "${nuevoPedido.id}" importado exitosamente con ${nuevoPedido.items.length} productos!`);
}

// Modal Menu
window.openMenuModal = function() {
  document.getElementById('modal-menu').classList.remove('hidden');
};

window.closeMenuModal = function() {
  document.getElementById('modal-menu').classList.add('hidden');
};
