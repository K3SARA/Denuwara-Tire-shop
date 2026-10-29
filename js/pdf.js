(function () {
  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const MARGIN = 36;
  const INNER_WIDTH = PAGE_WIDTH - (MARGIN * 2);
  const BOTTOM_MARGIN = 42;

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E]/g, ' ')
      .trim();
  }

  function escapePdfText(value) {
    return normalizeText(value)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function slug(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
  }

  function escapeHtml(value) {
    return normalizeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function openPdfPreview(title, blob, filename) {
    const pdfUrl = URL.createObjectURL(blob);
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      alert('Popup blocked. Please allow popups to preview PDF.');
      downloadBlob(blob, filename);
      return;
    }

    const safeTitle = escapeHtml(title || 'PDF Preview');
    const safeFilename = escapeHtml(filename || 'report.pdf');
    previewWindow.document.open();
    previewWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; background: #f3f4f6; color: #111; font-family: Arial, sans-serif; }
  body { display: flex; flex-direction: column; }
  .pdf-actions {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: calc(10px + env(safe-area-inset-top)) 10px 10px;
    background: #fff;
    border-bottom: 1px solid #d7d7d7;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .pdf-actions button {
    border: 1px solid #111;
    background: #fff;
    color: #111;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  .pdf-actions .download-btn { background: #111; color: #fff; }
  .pdf-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
  }
  .pdf-frame {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: 0;
    background: #fff;
  }
  .pdf-fallback { padding: 18px; font-size: 14px; }
  .pdf-fallback a { color: #111; font-weight: 700; }
  @media print { .pdf-actions, .pdf-fallback { display: none !important; } .pdf-frame { height: 100vh; } }
</style>
</head>
<body>
  <div class="pdf-actions">
    <button type="button" class="download-btn" onclick="downloadPdf()">Download PDF</button>
    <button type="button" onclick="printPdf()">Print</button>
    <button type="button" onclick="backToApp()">Back to App</button>
    <div class="pdf-title">${safeFilename}</div>
  </div>
  <iframe id="pdf-frame" class="pdf-frame" src="${pdfUrl}" title="${safeTitle}"></iframe>
  <div class="pdf-fallback">If the preview is blank, use <a id="fallback-link" href="${pdfUrl}" download="${safeFilename}">Download PDF</a>.</div>
  <script>
    const pdfUrl = ${JSON.stringify(pdfUrl)};
    const pdfFilename = ${JSON.stringify(filename || 'report.pdf')};
    function downloadPdf() {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = pdfFilename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    function printPdf() {
      const frame = document.getElementById('pdf-frame');
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) {
        window.open(pdfUrl, '_blank');
      }
    }
    function backToApp() {
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (window.opener && !window.opener.closed) {
          try { window.opener.focus(); } catch (e) {}
        }
      }, 120);
    }
    window.addEventListener('beforeunload', function () {
      try { URL.revokeObjectURL(pdfUrl); } catch (e) {}
    });
  <\/script>
</body>
</html>`);
    previewWindow.document.close();
  }

  function wrapText(value, width, fontSize) {
    const text = normalizeText(value);
    const maxChars = Math.max(6, Math.floor(width / (fontSize * 0.52)));
    if (!text) return [''];
    if (text.length <= maxChars) return [text];

    const lines = [];
    let current = '';
    text.split(' ').forEach((word) => {
      if (!word) return;
      if (word.length > maxChars) {
        if (current) {
          lines.push(current);
          current = '';
        }
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars));
        }
        return;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function escapeCommand(text) {
    return `(${escapePdfText(text)})`;
  }

  function createPageBuilder() {
    const pages = [];
    let commands = [];
    let y = PAGE_HEIGHT - MARGIN;

    function startPage() {
      if (commands.length) pages.push(commands.join('\n'));
      commands = [];
      y = PAGE_HEIGHT - MARGIN;
      commands.push('0 0 0 RG');
      commands.push('0 0 0 rg');
      commands.push('0.5 w');
    }

    function ensureSpace(height) {
      if (y - height < BOTTOM_MARGIN) startPage();
    }

    function text(value, x, ty, size = 10, bold = false) {
      const font = bold ? 'F2' : 'F1';
      commands.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${ty.toFixed(2)} Td ${escapeCommand(value)} Tj ET`);
    }

    function line(x1, y1, x2, y2, gray = 0.72) {
      commands.push(`${gray} ${gray} ${gray} RG`);
      commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
      commands.push('0 0 0 RG');
    }

    function rect(x, ry, w, h, fillGray) {
      if (typeof fillGray === 'number') {
        commands.push(`${fillGray} ${fillGray} ${fillGray} rg`);
        commands.push(`${x.toFixed(2)} ${ry.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
        commands.push('0 0 0 rg');
      }
      commands.push('0.72 0.72 0.72 RG');
      commands.push(`${x.toFixed(2)} ${ry.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
      commands.push('0 0 0 RG');
    }

    function moveDown(amount) {
      y -= amount;
    }

    function finish() {
      if (commands.length) pages.push(commands.join('\n'));
      return pages.length ? pages : [''];
    }

    startPage();
    return { pages, get y() { return y; }, set y(value) { y = value; }, startPage, ensureSpace, text, line, rect, moveDown, finish };
  }

  function columnWidths(headers, rows) {
    const count = Math.max(1, headers.length || (rows[0] ? rows[0].length : 1));
    const weights = Array.from({ length: count }, (_, index) => {
      const values = [headers[index] || '', ...rows.slice(0, 30).map((row) => row[index] || '')];
      const longest = values.reduce((max, value) => Math.max(max, normalizeText(value).length), 0);
      return Math.max(8, Math.min(28, longest || 8));
    });
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    return weights.map((weight) => (weight / total) * INNER_WIDTH);
  }

  function drawTitle(builder, title) {
    builder.ensureSpace(50);
    builder.text(title, MARGIN, builder.y, 17, true);
    builder.moveDown(18);
    builder.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, builder.y, 9, false);
    builder.moveDown(18);
    builder.line(MARGIN, builder.y, PAGE_WIDTH - MARGIN, builder.y, 0.82);
    builder.moveDown(16);
  }

  function drawMetrics(builder, metrics) {
    if (!metrics || !metrics.length) return;
    const gap = 7;
    const columns = Math.min(3, metrics.length);
    const width = (INNER_WIDTH - (gap * (columns - 1))) / columns;
    let x = MARGIN;
    let yTop = builder.y;
    const rows = [];

    for (let i = 0; i < metrics.length; i += columns) {
      rows.push(metrics.slice(i, i + columns));
    }

    rows.forEach((metricRow) => {
      builder.ensureSpace(44);
      x = MARGIN;
      yTop = builder.y;
      metricRow.forEach((metric) => {
        builder.rect(x, yTop - 34, width, 34, 0.96);
        builder.text(metric.label, x + 6, yTop - 13, 7.5, false);
        builder.text(metric.value, x + 6, yTop - 27, 10, true);
        x += width + gap;
      });
      builder.moveDown(42);
    });
  }

  function drawTableHeader(builder, headers, widths) {
    const headerLines = headers.map((header, index) => wrapText(header, widths[index] - 8, 8));
    const maxLines = Math.max(1, ...headerLines.map((lines) => lines.length));
    const height = Math.max(24, 10 + (maxLines * 9));
    let x = MARGIN;
    const yTop = builder.y;

    headers.forEach((header, index) => {
      builder.rect(x, yTop - height, widths[index], height, 0.92);
      headerLines[index].forEach((line, lineIndex) => {
        builder.text(line, x + 4, yTop - 13 - (lineIndex * 9), 8, true);
      });
      x += widths[index];
    });
    builder.moveDown(height);
  }

  function drawTable(builder, table) {
    const headers = (table.headers || []).map(normalizeText);
    const rows = (table.rows || []).map((row) => row.map(normalizeText));
    const widths = columnWidths(headers, rows);

    builder.ensureSpace(48);
    drawTableHeader(builder, headers.length ? headers : ['Data'], widths);

    if (!rows.length) {
      builder.ensureSpace(24);
      builder.rect(MARGIN, builder.y - 22, INNER_WIDTH, 22, null);
      builder.text('No data', MARGIN + 6, builder.y - 15, 9, false);
      builder.moveDown(22);
      builder.moveDown(12);
      return;
    }

    rows.forEach((row) => {
      const wrappedCells = widths.map((width, index) => wrapText(row[index] || '', width - 8, 8.5));
      const lineCount = Math.max(1, ...wrappedCells.map((lines) => lines.length));
      const rowHeight = Math.max(23, 10 + (lineCount * 9));

      if (builder.y - rowHeight < BOTTOM_MARGIN) {
        builder.startPage();
        drawTableHeader(builder, headers.length ? headers : ['Data'], widths);
      }

      let x = MARGIN;
      const yTop = builder.y;
      widths.forEach((width, index) => {
        builder.rect(x, yTop - rowHeight, width, rowHeight, null);
        wrappedCells[index].forEach((line, lineIndex) => {
          builder.text(line, x + 4, yTop - 13 - (lineIndex * 9), 8.5, false);
        });
        x += width;
      });
      builder.moveDown(rowHeight);
    });
    builder.moveDown(12);
  }

  function drawLines(builder, lines) {
    (lines || []).map(normalizeText).filter(Boolean).forEach((line) => {
      wrapText(line, INNER_WIDTH, 10).forEach((part) => {
        builder.ensureSpace(14);
        builder.text(part, MARGIN, builder.y, 10, false);
        builder.moveDown(14);
      });
    });
    builder.moveDown(8);
  }

  function createStructuredPdfBlob(report) {
    const builder = createPageBuilder();
    drawTitle(builder, normalizeText(report.title || 'Report') || 'Report');
    drawMetrics(builder, report.metrics || []);
    drawLines(builder, report.lines || []);
    (report.tables || []).forEach((table) => drawTable(builder, table));
    const pageContents = builder.finish();

    const objects = [''];
    objects[1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    objects[3] = '';

    const pageRefs = [];
    pageContents.forEach((content) => {
      const contentRef = objects.length;
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pageRef = objects.length;
      objects.push(`<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentRef} 0 R >>`);
      pageRefs.push(pageRef);
    });

    objects[3] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
    const catalogRef = objects.length;
    objects.push('<< /Type /Catalog /Pages 3 0 R >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 1; i < objects.length; i += 1) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
  }

  function tableFromElement(table) {
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => normalizeText(cell.textContent));
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => (
      Array.from(row.querySelectorAll('th, td')).map((cell) => normalizeText(cell.textContent))
    )).filter((row) => row.some(Boolean));
    return { headers, rows };
  }

  function reportFromElement(element, title) {
    const report = {
      title: normalizeText(title || 'Report') || 'Report',
      metrics: [],
      lines: [],
      tables: []
    };
    if (!element) return report;

    report.metrics = Array.from(element.querySelectorAll('.report-metric')).map((metric) => ({
      label: normalizeText(metric.querySelector('.report-metric-label')?.textContent || ''),
      value: normalizeText(metric.querySelector('.report-metric-value')?.textContent || '')
    })).filter((metric) => metric.label || metric.value);

    report.tables = Array.from(element.querySelectorAll('table')).map(tableFromElement);

    if (!report.tables.length) {
      const clone = element.cloneNode(true);
      clone.querySelectorAll('button, select, input, script, style, .report-metric').forEach((node) => node.remove());
      normalizeText(clone.innerText || clone.textContent || '')
        .split(/\s{2,}|\n/)
        .map(normalizeText)
        .filter(Boolean)
        .forEach((line) => report.lines.push(line));
    }

    return report;
  }

  function linesFromElement(element, title) {
    const report = reportFromElement(element, title);
    const lines = [report.title, `Generated: ${new Date().toLocaleString()}`, ''];
    report.metrics.forEach((metric) => lines.push(`${metric.label}: ${metric.value}`));
    if (report.metrics.length) lines.push('');
    report.lines.forEach((line) => lines.push(line));
    report.tables.forEach((table) => {
      if (table.headers.length) lines.push(table.headers.join(' | '));
      table.rows.forEach((row) => lines.push(row.join(' | ')));
    });
    return lines;
  }

  function downloadStructuredPdf(title, report, filename) {
    const safeTitle = normalizeText(title || report?.title || 'Report') || 'Report';
    const safeFilename = filename || `${slug(safeTitle)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    openPdfPreview(safeTitle, createStructuredPdfBlob({ ...report, title: safeTitle }), safeFilename);
  }

  function downloadElementPdf(title, element, filename) {
    downloadStructuredPdf(title, reportFromElement(element, title), filename);
  }

  function downloadTextPdf(title, lines, filename) {
    downloadStructuredPdf(title, { title, lines: lines && lines.length ? lines : ['No data'], tables: [] }, filename);
  }

  window.pdfDownload = {
    downloadElementPdf,
    downloadStructuredPdf,
    downloadTextPdf,
    linesFromElement,
    reportFromElement,
    slug
  };
}());

