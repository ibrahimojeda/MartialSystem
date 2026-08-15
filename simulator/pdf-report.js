// ══════════════════════════════════════════════════════════════
// pdf-report.js — Genera reporte PDF con usuarios y acciones
// ══════════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, 'reports');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('es-PA'); } catch (_) { return String(iso); }
}

/**
 * Genera un PDF con:
 *  - Resumen de la simulación
 *  - Usuarios creados (rol, nombre, usuario, contraseña, establecimiento)
 *  - Todas las operaciones/acciones realizadas
 *  - Errores encontrados
 *  - Ranking de endpoints
 *  - Anomalías
 *
 * @param {Object} options
 * @param {Object} options.summary - Resumen combinado de la simulación
 * @param {Array}  options.profiles - Perfiles creados [{ id, role, username, fullName, establishmentId, password }]
 * @param {Array}  options.establishments - [{ id, name, city, country }]
 * @param {Object} options.params - Parámetros de la simulación
 * @param {number} options.concurrency
 * @returns {string} Ruta del archivo PDF generado
 */
function generateSimulationPdf({ summary, profiles = [], establishments = [], params = {}, concurrency = 1 }) {
  ensureReportsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(REPORTS_DIR, `simulacion_${timestamp}.pdf`);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const MARGIN = 40;
  const PAGE_WIDTH = doc.page.width - MARGIN * 2;
  const PAGE_HEIGHT = doc.page.height;
  const BOTTOM_MARGIN = 50;

  // Cursor propio (doc.y puede devolver NaN en algunas versiones de pdfkit)
  let cursorY = MARGIN;

  function ensureSpace(needed) {
    if (cursorY + needed > PAGE_HEIGHT - BOTTOM_MARGIN) {
      doc.addPage();
      cursorY = MARGIN;
    }
  }

  function writeTitle(text, size = 16) {
    ensureSpace(30);
    doc.fillColor('#162233').fontSize(size).font('Helvetica-Bold');
    doc.text(text, MARGIN, cursorY, { width: PAGE_WIDTH });
    cursorY = doc.y + 8;
  }

  function writeSub(text) {
    ensureSpace(20);
    doc.fillColor('#60748f').fontSize(9).font('Helvetica');
    doc.text(text, MARGIN, cursorY, { width: PAGE_WIDTH });
    cursorY = doc.y + 6;
  }

  function drawTable(headers, rows, colWidths) {
    const cellPad = 4;
    const rowHeight = 18;
    const headerHeight = 20;
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const scale = PAGE_WIDTH / totalWidth;
    const widths = colWidths.map(w => w * scale);

    let y = cursorY;
    const startX = MARGIN;

    // Header
    ensureSpace(headerHeight + rowHeight);
    doc.rect(startX, y, PAGE_WIDTH, headerHeight).fill('#1a2230');
    let x = startX;
    headers.forEach((h, i) => {
      doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
      doc.text(h, x + cellPad, y + 6, { width: widths[i] - cellPad * 2, height: headerHeight - 8, ellipsis: true });
      x += widths[i];
    });
    y += headerHeight;

    // Rows
    rows.forEach((row, ri) => {
      if (y + rowHeight > PAGE_HEIGHT - BOTTOM_MARGIN) {
        doc.addPage();
        y = MARGIN;
        // Redraw header on new page
        doc.rect(startX, y, PAGE_WIDTH, headerHeight).fill('#1a2230');
        x = startX;
        headers.forEach((h, i) => {
          doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
          doc.text(h, x + cellPad, y + 6, { width: widths[i] - cellPad * 2, height: headerHeight - 8, ellipsis: true });
          x += widths[i];
        });
        y += headerHeight;
      }
      if (ri % 2 === 0) {
        doc.rect(startX, y, PAGE_WIDTH, rowHeight).fill('#f4f6fa');
      } else {
        doc.rect(startX, y, PAGE_WIDTH, rowHeight).fill('#ffffff');
      }
      x = startX;
      row.forEach((cell, i) => {
        doc.fillColor('#162233').fontSize(7.5).font('Helvetica');
        doc.text(String(cell ?? ''), x + cellPad, y + 5, { width: widths[i] - cellPad * 2, height: rowHeight - 8, ellipsis: true });
        x += widths[i];
      });
      y += rowHeight;
    });
    cursorY = y + 8;
  }

  // ─── Portada / Encabezado ───
  doc.rect(0, 0, doc.page.width, 90).fill('#0d0f14');
  doc.fillColor('#c9a227').fontSize(22).font('Helvetica-Bold');
  doc.text('MartialSystem — Reporte de Simulación', MARGIN, 24, { width: PAGE_WIDTH });
  doc.fillColor('#f0f0f0').fontSize(11).font('Helvetica');
  doc.text(`Generado: ${new Date().toLocaleString('es-PA')}`, MARGIN, 56);
  doc.text(`Concurrencia: ${concurrency}`, MARGIN, 72);

  cursorY = 110;

  // ─── Resumen ───
  writeTitle('Resumen de la Simulación', 14);

  const s = summary || {};
  const kpis = [
    ['Operaciones totales', String(s.totalOperations || 0)],
    ['Exitosas', String(s.successCount || 0)],
    ['Errores', String(s.errorCount || 0)],
    ['Tasa de éxito', (s.successRate ?? 0) + '%'],
    ['Establecimientos', String(s.establishments || 0)],
    ['Perfiles', String(s.profiles || 0)],
    ['Alumnos', String(s.students || 0)],
    ['Inscripciones', String(s.enrollments || 0)],
    ['Clases', String(s.classes || 0)],
    ['Duración', s.elapsedFormatted || '--'],
    ['Salud', s.healthStatus || 'idle']
  ];

  // KPI grid 2 columnas
  const kpiY = cursorY;
  kpis.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (PAGE_WIDTH / 2);
    const y = kpiY + row * 34;
    doc.rect(x, y, PAGE_WIDTH / 2 - 6, 28).fill('#f4f6fa');
    doc.rect(x, y, 3, 28).fill('#c9a227');
    doc.fillColor('#60748f').fontSize(8).font('Helvetica');
    doc.text(label, x + 10, y + 4, { width: PAGE_WIDTH / 2 - 20 });
    doc.fillColor('#162233').fontSize(12).font('Helvetica-Bold');
    doc.text(value, x + 10, y + 13, { width: PAGE_WIDTH / 2 - 20 });
  });
  cursorY = kpiY + Math.ceil(kpis.length / 2) * 34 + 10;

  // ─── Parámetros ───
  writeTitle('Parámetros de la Simulación', 14);
  const paramRows = Object.entries(params || {}).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  if (paramRows.length) {
    drawTable(['Parámetro', 'Valor'], paramRows, [180, 300]);
  } else {
    writeSub('Sin parámetros registrados.');
  }

  // ─── Usuarios y Contraseñas ───
  doc.addPage();
  cursorY = MARGIN;
  writeTitle('Usuarios y Contraseñas Creados');
  writeSub('Estas credenciales permiten iniciar sesión en el sistema con los roles creados por el simulador.');

  const estNameById = new Map((establishments || []).map(e => [e.id, e.name || e.id]));
  const userRows = (profiles || []).map(p => [
    p.role || '-',
    p.fullName || '-',
    p.username || '-',
    p.password || '-',
    estNameById.get(p.establishmentId) || p.establishmentId || '-'
  ]);

  if (userRows.length) {
    drawTable(['Rol', 'Nombre', 'Usuario', 'Contraseña', 'Establecimiento'], userRows, [80, 120, 100, 100, 120]);
  } else {
    writeSub('No se crearon usuarios.');
  }

  // ─── Operaciones / Acciones ───
  doc.addPage();
  cursorY = MARGIN;
  writeTitle('Todas las Acciones Realizadas');
  writeSub(`Total de operaciones registradas: ${(s.operations || []).length}`);

  const ops = (s.operations || []).slice(0, 500);
  if (ops.length) {
    const opRows = ops.map(op => [
      op.id || '-',
      op.endpoint || '-',
      op.method || '-',
      op.statusCode ?? '-',
      op.success ? 'OK' : 'ERROR',
      (op.responseTime ?? 0) + 'ms',
      formatDate(op.timestamp),
      op.requestData ? JSON.stringify(op.requestData).slice(0, 60) : ''
    ]);
    drawTable(['#', 'Endpoint', 'Método', 'HTTP', 'Estado', 'Tiempo', 'Fecha', 'Datos'], opRows, [25, 130, 45, 35, 40, 45, 80, 100]);
    if (ops.length < (s.operations || []).length) {
      writeSub(`... y ${(s.operations || []).length - ops.length} operaciones más.`);
    }
  } else {
    writeSub('Sin operaciones registradas.');
  }

  // ─── Errores ───
  doc.addPage();
  cursorY = MARGIN;
  writeTitle('Errores Encontrados');
  const errs = (s.errors || []).slice(0, 200);
  if (errs.length) {
    const errRows = errs.map(e => [
      e.id || '-',
      e.endpoint || '-',
      e.statusCode ?? '-',
      e.errorType || '-',
      String(e.message || '').slice(0, 60),
      formatDate(e.timestamp)
    ]);
    drawTable(['#', 'Endpoint', 'HTTP', 'Tipo', 'Mensaje', 'Fecha'], errRows, [25, 120, 40, 80, 160, 80]);
    if (errs.length < (s.errors || []).length) {
      writeSub(`... y ${(s.errors || []).length - errs.length} errores más.`);
    }
  } else {
    doc.fillColor('#2e8b57').fontSize(11).font('Helvetica');
    doc.text('✅ Sin errores registrados.', MARGIN, cursorY, { width: PAGE_WIDTH });
    cursorY = doc.y + 8;
  }

  // ─── Ranking de Endpoints ───
  ensureSpace(40);
  writeTitle('Ranking de Endpoints');
  const ranking = (s.endpointRanking || []).slice(0, 30);
  if (ranking.length) {
    const rankRows = ranking.map(r => [
      r.endpoint || '-',
      r.calls || 0,
      r.successes || 0,
      r.errors || 0,
      (r.successRate ?? 0) + '%',
      (r.avgResponseTime ?? 0) + 'ms'
    ]);
    drawTable(['Endpoint', 'Llamadas', 'OK', 'Errores', 'Tasa', 'Promedio'], rankRows, [180, 60, 50, 50, 50, 60]);
  } else {
    writeSub('Sin ranking de endpoints.');
  }

  // ─── Anomalías ───
  ensureSpace(40);
  writeTitle('Anomalías Detectadas');
  const anomalies = (s.anomalies || []).slice(0, 50);
  if (anomalies.length) {
    const anomRows = anomalies.map(a => [
      a.type || '-',
      a.severity || '-',
      a.endpoint || '-',
      String(a.message || '').slice(0, 80)
    ]);
    drawTable(['Tipo', 'Severidad', 'Endpoint', 'Mensaje'], anomRows, [100, 70, 120, 160]);
  } else {
    doc.fillColor('#2e8b57').fontSize(11).font('Helvetica');
    doc.text('✅ Sin anomalías detectadas.', MARGIN, cursorY, { width: PAGE_WIDTH });
    cursorY = doc.y + 8;
  }

  // ─── Pie de página ───
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#9a9a9a').fontSize(8).font('Helvetica');
    doc.text(`MartialSystem Simulator — Página ${i + 1} de ${pages.count}`, MARGIN, PAGE_HEIGHT - 30, { width: PAGE_WIDTH, align: 'center' });
  }

  doc.end();
  return filePath;
}

module.exports = { generateSimulationPdf, REPORTS_DIR };