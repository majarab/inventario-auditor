const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'raw_pedidos.csv'), 'utf8');
const lines = raw.split(/\r?\n/);

const pedidos = [];
let currentPedido = null;
let itemIndex = 1;

function parseCSVLine(line) {
  const tokens = [];
  let cur = '';
  let inQuotes = false;
  for (let c = 0; c < line.length; c++) {
    const char = line[c];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      tokens.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  tokens.push(cur.trim());
  return tokens;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  // Detectar inicio de un pedido (PEDIDO o PEDIDIO)
  if (/^PEDID?I?O\s+\d+/i.test(line)) {
    const tokens = parseCSVLine(line);
    const rawCode = tokens[0].trim().toUpperCase().replace('PEDIDIO', 'PEDIDO');
    // Buscar si hay fecha en la línea (YYYY-MM-DD)
    const fechaMatch = line.match(/\d{4}-\d{2}-\d{2}/);
    const fecha = fechaMatch ? fechaMatch[0] : '';

    currentPedido = {
      id: rawCode,
      rawCode: rawCode,
      fecha: fecha,
      destino: 'TARAPOTO',
      cliente: 'OSCAR TARAPOTO',
      items: [],
      subtotalOriginal: 0,
      totalOriginal: 0,
      gastosAdicionales: [],
      pagos: []
    };
    pedidos.push(currentPedido);
    itemIndex = 1;
    continue;
  }

  if (!currentPedido) continue;

  // Detectar destino o cliente
  if (line.includes('DESTINO')) {
    const tokens = parseCSVLine(line);
    const dest = tokens.find((p, idx) => idx >= 1 && p && !p.includes('DESTINO')) || '';
    if (dest) currentPedido.destino = dest.replace(/^[, ]+/, '');
    continue;
  }
  if (line.includes('CLIENTE:')) {
    currentPedido.cliente = line.replace(/.*CLIENTE:\s*/, '').replace(/,+.*$/, '').trim();
    continue;
  }

  if (/^,+.*(SUB\s*TOTAL|TOTAL)\b/i.test(line) && !line.includes('Magne Total')) {
    const tokens = parseCSVLine(line);
    const lastNum = parseFloat(tokens[tokens.length - 1]);
    if (!isNaN(lastNum)) {
      if (/SUB/i.test(line)) currentPedido.subtotalOriginal = lastNum;
      else currentPedido.totalOriginal = lastNum;
    }
    continue;
  }
  if (/DEPOSITO|SALDO/i.test(line)) {
    continue;
  }
  if (/NRO\s*,\s*Cantidad|Cotización\s+Oscar/i.test(line)) {
    continue;
  }

  // Procesar items de producto
  const tokens = parseCSVLine(line);

  let nro = 0;
  let cant = null;
  let prod = '';
  let precio = 0;
  let igv = 0;
  let precioUni = 0;
  let total = 0;

  if (tokens.length >= 6) {
    if (tokens[0] !== '' && !isNaN(Number(tokens[0])) && !isNaN(Number(tokens[1]))) {
      // Caso 1: NRO, Cantidad, Producto
      nro = parseInt(tokens[0]);
      cant = parseFloat(tokens[1]);
      prod = tokens[2];
      precio = parseFloat(tokens[3]) || 0;
      igv = parseFloat(tokens[4]) || 0;
      precioUni = parseFloat(tokens[5]) || 0;
      total = parseFloat(tokens[6]) || 0;
    } else if (tokens[0] === '' && tokens[1] !== '' && !isNaN(Number(tokens[1])) && tokens[2] && isNaN(Number(tokens[2]))) {
      // Caso 2: , Cantidad, Producto
      nro = itemIndex;
      cant = parseFloat(tokens[1]);
      prod = tokens[2];
      precio = parseFloat(tokens[3]) || 0;
      igv = parseFloat(tokens[4]) || 0;
      precioUni = parseFloat(tokens[5]) || 0;
      total = parseFloat(tokens[6]) || 0;
    }
  }

  if (prod && cant !== null && !isNaN(cant) && cant > 0) {
    // Evitar líneas que son meramente subtotales o totales
    const isTotalRow = prod.toUpperCase() === 'TOTAL' || prod.toUpperCase() === 'SUB TOTAL';
    if (!isTotalRow) {
      currentPedido.items.push({
        id: `${currentPedido.rawCode}-${nro || itemIndex}`,
        itemNro: nro || itemIndex,
        producto: prod.replace(/^"|"$/g, '').trim(),
        cantidadEsperada: cant,
        cantidadFisica: 0,
        estado: 'PENDIENTE',
        precioBase: precio,
        igv: igv,
        precioUnitario: precioUni,
        totalEsperado: total,
        codigoBarra: '',
        verificadoPor: null,
        fechaVerificacion: null,
        notas: ''
      });
      itemIndex++;
    }
  }
}

// Desambiguar IDs repetidos (ej. dos PEDIDO 004)
const counts = {};
pedidos.forEach(p => {
  counts[p.rawCode] = (counts[p.rawCode] || 0) + 1;
});
const tracker = {};
pedidos.forEach(p => {
  if (counts[p.rawCode] > 1) {
    tracker[p.rawCode] = (tracker[p.rawCode] || 0) + 1;
    const letter = String.fromCharCode(64 + tracker[p.rawCode]);
    p.id = `${p.rawCode}-${letter} (${p.fecha || p.destino})`;
  }
});

console.log(`Total pedidos procesados: ${pedidos.length}`);
let totalLineas = 0;
pedidos.forEach(p => {
  totalLineas += p.items.length;
  console.log(`- ${p.id} [${p.fecha}]: ${p.items.length} items | Destino: ${p.destino}`);
});
console.log(`Total acumulado de líneas de productos: ${totalLineas}`);

fs.writeFileSync(
  path.join(__dirname, 'pedidos_data.json'),
  JSON.stringify(pedidos, null, 2),
  'utf8'
);

const jsContent = `// Archivo autogenerado con los datos de pedidos iniciales
export const INITIAL_PEDIDOS = ${JSON.stringify(pedidos, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, 'pedidos_data.js'), jsContent, 'utf8');
