class ReportsView {
  constructor() {
    this.bound = false;
    this.bills = [];
    this.products = [];
    this.logs = [];
    this.expenses = [];
    this.auditLogs = [];
    this.notesLoaded = false;
  }

  fmtLkr(value) {
    return `LKR ${Money.round(value).toLocaleString()}`;
  }

  esc(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  getInputs() {
    return {
      reportType: document.getElementById('reports-type'),
      period: document.getElementById('reports-period'),
      from: document.getElementById('reports-date-from'),
      to: document.getElementById('reports-date-to'),
      customWrap: document.getElementById('reports-custom-dates'),
      view: document.getElementById('reports-view'),
      note: document.getElementById('reports-quick-note'),
      noteSave: document.getElementById('reports-note-save'),
      noteClear: document.getElementById('reports-note-clear'),
      noteStatus: document.getElementById('reports-note-status')
    };
  }

  setNoteStatus(message) {
    const { noteStatus } = this.getInputs();
    if (noteStatus) noteStatus.textContent = message;
  }

  async loadNotes() {
    const { note } = this.getInputs();
    if (!note || this.notesLoaded) return;
    try {
      const payload = await window.db.getSetting('reports_quick_note');
      note.value = payload?.text || '';
      this.setNoteStatus(payload?.savedAt
        ? `Saved ${new Date(payload.savedAt).toLocaleString()}`
        : 'No saved note');
      this.notesLoaded = true;
    } catch (error) {
      console.error('Failed to load report notes:', error);
      this.setNoteStatus('Unable to load note');
    }
  }

  async saveNotes() {
    const { note } = this.getInputs();
    if (!note) return;
    const payload = {
      text: String(note.value || '').trim(),
      savedAt: new Date().toISOString()
    };
    try {
      await window.db.saveSetting('reports_quick_note', payload);
      this.setNoteStatus(`Saved ${new Date(payload.savedAt).toLocaleString()}`);
    } catch (error) {
      console.error('Failed to save report notes:', error);
      alert('Unable to save note. Please try again.');
    }
  }

  async clearNotes() {
    const { note } = this.getInputs();
    if (!note) return;
    note.value = '';
    try {
      await window.db.saveSetting('reports_quick_note', { text: '', savedAt: new Date().toISOString() });
      this.setNoteStatus('Note cleared');
    } catch (error) {
      console.error('Failed to clear report notes:', error);
      alert('Unable to clear note. Please try again.');
    }
  }

  getRange() {
    const { period, from, to } = this.getInputs();
    const mode = period?.value || 'today';
    const now = new Date();

    if (mode === 'all') {
      return { from: null, to: null };
    }

    if (mode === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now.getTime() };
    }

    if (mode === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.getTime(), to: now.getTime() };
    }

    const fromTs = from?.value ? new Date(`${from.value}T00:00:00`).getTime() : null;
    const toTs = to?.value ? new Date(`${to.value}T23:59:59.999`).getTime() : null;

    if (fromTs !== null && toTs !== null && fromTs > toTs) {
      return {
        from: new Date(`${to.value}T00:00:00`).getTime(),
        to: new Date(`${from.value}T23:59:59.999`).getTime()
      };
    }
    return { from: fromTs, to: toTs };
  }

  getChequeDateRange() {
    const { period, from, to } = this.getInputs();
    const mode = period?.value || 'today';
    const now = new Date();

    if (mode === 'all') {
      return { from: null, to: null };
    }

    if (mode === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { from: start.getTime(), to: end.getTime() };
    }

    if (mode === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: start.getTime(), to: end.getTime() };
    }

    const fromTs = from?.value ? new Date(`${from.value}T00:00:00`).getTime() : null;
    const toTs = to?.value ? new Date(`${to.value}T23:59:59.999`).getTime() : null;

    if (fromTs !== null && toTs !== null && fromTs > toTs) {
      return {
        from: new Date(`${to.value}T00:00:00`).getTime(),
        to: new Date(`${from.value}T23:59:59.999`).getTime()
      };
    }
    return { from: fromTs, to: toTs };
  }

  inRange(ts, range) {
    if (range.from !== null && ts < range.from) return false;
    if (range.to !== null && ts > range.to) return false;
    return true;
  }

  dateInRange(dateText, range) {
    const ts = dateText ? new Date(`${dateText}T12:00:00`).getTime() : 0;
    return this.inRange(ts, range);
  }

  getProductByItem(item) {
    if (!item) return null;
    if (item.productId !== undefined && item.productId !== null && item.productId !== '') {
      const id = Number(item.productId);
      const byId = this.products.find((p) => Number(p.id) === id);
      if (byId) return byId;
    }
    const name = String(item.name || '').trim().toLowerCase();
    if (!name) return null;
    return this.products.find((p) => String(p.name || '').trim().toLowerCase() === name) || null;
  }

  getCanonicalProductKey(item) {
    const matched = this.getProductByItem(item);
    if (matched && matched.id !== undefined && matched.id !== null) {
      return {
        key: `id:${Number(matched.id)}`,
        name: String(matched.name || item?.name || 'Unknown').trim() || 'Unknown'
      };
    }

    const rawName = String(item?.name || '').trim();
    const normalizedName = rawName.toLowerCase();
    return {
      key: `name:${normalizedName}`,
      name: rawName || 'Unknown'
    };
  }

  getItemCost(item) {
    if (Object.prototype.hasOwnProperty.call(item || {}, 'costPrice')) {
      const explicit = Number(item.costPrice);
      if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    }
    const p = this.getProductByItem(item);
    return Number(p?.invoicePrice) || 0;
  }

  getBillTotals(bill) {
    const total = Money.round(bill.total);
    const received = Money.round(bill.receivedAmount);
    const balance = Number.isFinite(Number(bill.balanceAmount))
      ? Money.clampZero(bill.balanceAmount)
      : Money.clampZero(Money.subtract(total, received));
    const change = Money.clampZero(bill.changeAmount || Money.subtract(received, total));
    const netReceived = Money.clampZero(Money.subtract(received, change));
    return { total, received, balance, change, netReceived };
  }

  getPaymentMethod(bill) {
    return String(bill?.paymentMethod || (bill?.markAsCredit ? 'credit' : '')).trim().toLowerCase();
  }

  getPaymentRows(bill) {
    if (Array.isArray(bill?.payments) && bill.payments.length) {
      return bill.payments.map((payment, index) => ({
        id: payment.id || `payment-${index + 1}`,
        method: String(payment.method || 'cash').toLowerCase(),
        amount: Math.max(0, Number(payment.amount) || 0),
        chequeAmount: Math.max(0, Number(payment.chequeAmount || payment.amount) || 0),
        chequeDate: payment.chequeDate || '',
        chequeNumber: payment.chequeNumber || '',
        chequeBank: payment.chequeBank || '',
        chequeStatus: payment.chequeStatus || ''
      }));
    }

    const method = this.getPaymentMethod(bill) || 'cash';
    const t = this.getBillTotals(bill);
    return [{
      id: 'legacy-payment-1',
      method,
      amount: method === 'cheque' ? (t.netReceived || t.total) : t.netReceived,
      chequeDate: bill?.chequeDate || '',
      chequeNumber: bill?.chequeNumber || '',
      chequeBank: bill?.chequeBank || '',
      chequeStatus: method === 'cheque' ? (bill?.chequeStatus || 'pending') : ''
    }];
  }

  getEffectivePaymentAmount(payment) {
    if (payment.method === 'credit') return 0;
    if (payment.method === 'cheque') {
      return ['bounced', 'returned'].includes(payment.chequeStatus)
        ? 0
        : (Number(payment.amount) || 0);
    }
    return Number(payment.amount) || 0;
  }
  isChequeBill(bill) {
    return this.getPaymentRows(bill).some((payment) => payment.method === 'cheque')
      || this.getPaymentMethod(bill) === 'cheque'
      || Boolean(bill?.chequeDate || bill?.chequeNumber || bill?.chequeBank);
  }

  getCollectionEntries(range) {
    const billHasAnyLog = new Set();
    this.logs.forEach((log) => {
      billHasAnyLog.add(Number(log.billId));
    });

    const entries = this.logs
      .filter((log) => {
        if (!this.inRange(log.timestamp || 0, range)) return false;
        const amount = Number(log.amount) || 0;
        if (amount === 0) return false;
        if (log.action === 'bill_cancel' || log.action === 'bill_return') return false;
        if (log.direction === 'refund_pending') return false;
        return true;
      })
      .map((log) => ({
        billId: Number(log.billId),
        amount: (() => {
          const raw = Number(log.amount) || 0;
          if (log.direction === 'decrease') return -Math.abs(raw);
          if (log.direction === 'reversal') return -Math.abs(raw);
          if (log.direction === 'increase') return Math.abs(raw);
          return raw;
        })(),
        method: String(log.method || 'unknown').toLowerCase(),
        action: log.action || 'collection'
      }));

    // Backfill old invoices created before collection log support.
    this.bills
      .filter((bill) => (bill.billStatus || 'active') === 'active')
      .filter((bill) => this.inRange(bill.timestamp || 0, range))
      .forEach((bill) => {
        const billId = Number(bill.id);
        if (billHasAnyLog.has(billId)) return;
        const totals = this.getBillTotals(bill);
        if (totals.netReceived <= 0) return;
        const payments = this.getPaymentRows(bill).filter((payment) => this.getEffectivePaymentAmount(payment) > 0);
        if (payments.length) {
          payments.forEach((payment) => entries.push({
            billId,
            amount: this.getEffectivePaymentAmount(payment),
            method: payment.method || 'unknown',
            action: 'invoice_payment'
          }));
          return;
        }
        entries.push({
          billId,
          amount: totals.netReceived,
          method: String(bill.paymentMethod || 'unknown').toLowerCase(),
          action: 'invoice_payment'
        });
      });

    return entries;
  }

  positiveCollectionLogs(range) {
    return this.logs.filter((log) => {
      if (!this.inRange(log.timestamp || 0, range)) return false;
      const amount = Number(log.amount) || 0;
      if (amount <= 0) return false;
      if (log.action === 'bill_cancel' || log.action === 'bill_return') return false;
      if (log.direction === 'decrease' || log.direction === 'reversal' || log.direction === 'refund_pending') return false;
      return true;
    });
  }

  metricGrid(items) {
    return `
      <div class="report-metrics">
        ${items.map((it) => `
          <div class="report-metric">
            <div class="report-metric-label">${this.esc(it.label)}</div>
            <div class="report-metric-value">${this.esc(it.value)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  simpleTable(headers, rows) {
    const colspan = headers.length || 1;
    return `
      <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr>${headers.map((h) => `<th>${this.esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${colspan}" class="report-empty">No data</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  getPrintViewerToolbar() {
    return `
      <div class="print-actions">
        <button type="button" onclick="doPrint()">Print</button>
        <button type="button" class="back-btn" onclick="backToApp()">Back to App</button>
      </div>
      <script>
        function doPrint() {
          var np = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
          if (np && typeof np.print === 'function') {
            np.print({ jobName: 'T Billing Report' }).catch(function () { window.print(); });
            return;
          }
          window.print();
        }
        function backToApp() {
          var isCap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
          if (isCap) {
            if (window.history.length > 1) { window.history.back(); } else { window.location.replace('index.html'); }
            return;
          }
          try { window.close(); } catch (e) {}
          setTimeout(function () {
            if (window.opener && !window.opener.closed) {
              try { window.opener.focus(); } catch (e) {}
            }
            if (!window.closed && window.history.length > 1) { window.history.back(); }
          }, 120);
        }
      <\/script>
    `;
  }

  getPrintViewerStyles() {
    return `
      .print-actions {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        gap: 8px;
        padding: 10px;
        margin: -4px -4px 12px;
        background: #fff;
        border-bottom: 1px solid #ddd;
      }
      .print-actions button {
        border: 1px solid #111;
        background: #fff;
        color: #111;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
      }
      .print-actions .back-btn {
        background: #111;
        color: #fff;
      }
      @media print { .print-actions { display: none !important; } }
    `;
  }
  isChequeRowInRange(bill, payment, range, chequeRange) {
    const billInRange = this.inRange(bill?.timestamp || 0, range);
    const chequeDateInRange = payment?.chequeDate
      ? this.dateInRange(payment.chequeDate, chequeRange)
      : false;
    return billInRange || chequeDateInRange;
  }

  getChequeRows(bills, range) {
    const chequeRange = this.getChequeDateRange();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bills.flatMap((bill) => this.getPaymentRows(bill)
      .filter((payment) => payment.method === 'cheque')
      .filter((payment) => this.isChequeRowInRange(bill, payment, range, chequeRange))
      .map((payment, index) => {
        const chequeDateTs = payment.chequeDate ? new Date(`${payment.chequeDate}T00:00:00`).getTime() : null;
        const status = payment.chequeStatus || 'pending';
        const isOverdue = chequeDateTs !== null
          && chequeDateTs < today.getTime()
          && ['pending', 'deposited'].includes(status);
        return {
          billId: bill.id,
          paymentId: payment.id,
          billNo: bill.billNumber || bill.id || '-',
          customer: bill.customerName || 'Walk-in Customer',
          amount: Number(payment.chequeAmount || payment.amount) || 0,
          chequeDate: payment.chequeDate || '-',
          chequeNumber: payment.chequeNumber || '-',
          chequeBank: payment.chequeBank || '-',
          status,
          isOverdue,
          label: `Cheque ${index + 1}`
        };
      }));
  }

  renderChequeReport(range) {
    const cheques = this.getChequeRows(this.bills, range);
    const total = cheques.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const overdue = cheques.filter((row) => row.isOverdue).length;
    const rows = cheques.map((row) => [
      this.esc(`#${row.billNo}`),
      this.esc(row.customer),
      this.esc(row.chequeDate),
      this.esc(row.chequeNumber),
      this.esc(row.chequeBank),
      this.esc(this.fmtLkr(row.amount)),
      `<select class="cheque-status-select" data-cheque-bill-id="${this.esc(row.billId)}" data-cheque-payment-id="${this.esc(row.paymentId)}">
        ${['pending', 'deposited', 'cleared', 'bounced', 'returned'].map((status) => `<option value="${status}"${row.status === status ? ' selected' : ''}>${this.esc(status)}</option>`).join('')}
      </select>`
    ]);

    return `
      <div class="report-title-row">
        <h3 class="report-title">Cheque Details</h3>
        <button class="btn-tool report-pdf-btn" onclick="reportsView.printChequeReport()">Download PDF</button>
      </div>
      ${this.metricGrid([
        { label: 'Cheque Bills', value: cheques.length.toLocaleString() },
        { label: 'Cheque Amount', value: this.fmtLkr(total) },
        { label: 'Overdue', value: overdue.toLocaleString() }
      ])}
      ${this.simpleTable(['Bill No.', 'C.Name', 'Cheque Date', 'Cheque No.', 'Bank', 'Amount', 'Status'], rows)}
    `;
  }

  buildChequePrintHtml(rows) {
    const date = new Date().toLocaleString();
    const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const bodyRows = rows.map((row) => `
      <tr>
        <td>#${this.esc(row.billNo)}</td>
        <td>${this.esc(row.customer)}</td>
        <td>${this.esc(row.chequeDate)}</td>
        <td>${this.esc(row.chequeNumber)}</td>
        <td>${this.esc(row.chequeBank)}</td>
        <td class="num">${this.esc(this.fmtLkr(row.amount))}</td>
        <td>${this.esc(row.status)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cheque Details Report</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .meta { margin-bottom: 14px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 6px; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; }
  .summary { margin: 10px 0 14px; font-weight: 700; }
  ${this.getPrintViewerStyles()}
</style>
</head>
<body>
  ${this.getPrintViewerToolbar()}
  <h1>Cheque Details Report</h1>
  <div class="meta">Generated: ${this.esc(date)}</div>
  <div class="summary">Cheque Bills: ${rows.length.toLocaleString()} | Cheque Amount: ${this.esc(this.fmtLkr(total))}</div>
  <table>
    <thead>
      <tr>
        <th>Bill</th>
        <th>C.Name</th>
        <th>Cheque Date</th>
        <th>Cheque No.</th>
        <th>Bank</th>
        <th>Amount</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="5">No cheque data</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
  }

  printChequeReport() {
    if (!window.pdfDownload) {
      alert('PDF downloader is still loading. Please try again.');
      return;
    }

    const range = this.getRange();
    const rows = this.getChequeRows(this.bills, range);
    const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    window.pdfDownload.downloadStructuredPdf('Cheque Details Report', {
      metrics: [
        { label: 'Cheque Bills', value: rows.length.toLocaleString() },
        { label: 'Cheque Amount', value: this.fmtLkr(total) }
      ],
      tables: [{
        headers: ['Bill', 'C.Name', 'Cheque Date', 'Cheque No.', 'Bank', 'Amount', 'Status'],
        rows: rows.map((row) => [
          `#${row.billNo}`,
          row.customer,
          row.chequeDate,
          row.chequeNumber,
          row.chequeBank,
          this.fmtLkr(row.amount),
          row.status
        ])
      }]
    }, `cheque-details-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  printCurrentReport(title = 'Report') {
    if (!window.pdfDownload) {
      alert('PDF downloader is still loading. Please try again.');
      return;
    }

    const view = document.getElementById('reports-view');
    if (!view) return;
    const fileName = `${window.pdfDownload.slug(title)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    window.pdfDownload.downloadElementPdf(title, view, fileName);
  }

  async updateChequeStatus(billId, status, paymentId = null) {
    const allowed = ['pending', 'deposited', 'cleared', 'bounced', 'returned'];
    if (!allowed.includes(status)) return;
    const bill = this.bills.find((item) => Number(item.id) === Number(billId));
    if (!bill) return;

    // For bills with a payments[] array, read the status from the specific
    // payment being changed — not from the top-level bill.chequeStatus which
    // is only reliable for single-cheque bills.
    const matchedPayment = Array.isArray(bill.payments) && paymentId
      ? bill.payments.find((p) => p.id === paymentId && String(p.method || '').toLowerCase() === 'cheque')
      : null;
    const currentStatus = (matchedPayment ? matchedPayment.chequeStatus : bill.chequeStatus) || 'pending';
    const validTransitions = {
      pending: ['deposited', 'bounced', 'returned'],
      deposited: ['cleared', 'bounced', 'returned'],
      cleared: [],
      bounced: ['pending'],
      returned: ['pending']
    };
    if (!(validTransitions[currentStatus] || []).includes(status)) {
      alert(`Cannot change cheque status from "${currentStatus}" to "${status}".`);
      await this.render();
      return;
    }

    const isSplitCheque = Array.isArray(bill.payments) && bill.payments.length && paymentId;
    const chequeAmount = Money.clampZero(
      matchedPayment
        ? (matchedPayment.chequeAmount || matchedPayment.amount || 0)
        : (bill.chequeAmount || bill.receivedAmount || 0)
    );
    const prevReceived = Money.round(bill.receivedAmount || 0);
    const updates = { chequeStatus: status };
    if (status === 'deposited' || status === 'cleared') {
      const depositDate = prompt('Bank deposit / clear date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (depositDate === null) {
        await this.render();
        return;
      }
      updates.chequeDepositDate = depositDate.trim();
    }

    if (status === 'cleared') {
      updates.paymentStatus = bill.paymentStatus || (Money.isPositive(bill.balanceAmount) ? 'due' : 'paid');
      updates.balanceAmount = Money.clampZero(bill.balanceAmount || 0);
    }

    if (['bounced', 'returned'].includes(currentStatus) && status === 'pending') {
      const total = Number(bill.total) || 0;
      const nextReceived = Money.add(prevReceived, chequeAmount);
      const nextBalance = Money.clampZero(Money.subtract(total, nextReceived));
      updates.receivedAmount = nextReceived;
      updates.balanceAmount = nextBalance;
      updates.changeAmount = Money.clampZero(Money.subtract(nextReceived, total));
      updates.paymentStatus = Money.isPositive(nextBalance) ? 'due' : 'paid';
      updates.chequeIssueReason = '';
    }

    if (status === 'bounced' || status === 'returned') {
      const reason = prompt('Cheque issue reason:', status === 'bounced' ? 'Bounced cheque' : 'Returned cheque');
      if (reason === null) {
        await this.render();
        return;
      }
      const total = Number(bill.total) || 0;
      const nextReceived = Money.clampZero(Money.subtract(prevReceived, chequeAmount));
      const nextBalance = Money.clampZero(Money.subtract(total, nextReceived));
      updates.chequeIssueReason = reason.trim();
      updates.receivedAmount = nextReceived;
      updates.balanceAmount = nextBalance;
      updates.changeAmount = 0;
      updates.paymentStatus = Money.isPositive(nextBalance) ? 'due' : 'paid';
    }

    // Sync the new status into bill.payments[] so receipt/cheque-report
    // (which reads payments[] first) also reflects the change.
    if (Array.isArray(bill.payments) && bill.payments.length) {
      updates.payments = bill.payments.map((payment) => {
        if (String(payment.method || '').toLowerCase() !== 'cheque') return payment;
        if (isSplitCheque && payment.id !== paymentId) return payment;
        const next = { ...payment, chequeStatus: status };
        if (updates.chequeDepositDate) next.chequeDepositDate = updates.chequeDepositDate;
        return next;
      });
    }

    await window.db.updateBill(Number(billId), updates);

    if ((status === 'bounced' || status === 'returned') && Money.isPositive(chequeAmount)) {
      await window.db.addCollectionLog({
        billId: Number(billId),
        customerName: bill.customerName || 'Walk-in Customer',
        amount: chequeAmount,
        method: 'cheque',
        action: `cheque_${status}`,
        direction: 'reversal',
        beforeReceived: prevReceived,
        afterReceived: Money.clampZero(Money.subtract(prevReceived, chequeAmount))
      });
    }

    if (['bounced', 'returned'].includes(currentStatus) && status === 'pending' && Money.isPositive(chequeAmount)) {
      await window.db.addCollectionLog({
        billId: Number(billId),
        customerName: bill.customerName || 'Walk-in Customer',
        amount: chequeAmount,
        method: 'cheque',
        action: 'cheque_reactivated',
        direction: 'increase',
        beforeReceived: prevReceived,
        afterReceived: Money.add(prevReceived, chequeAmount)
      });
    }

    await window.db.addAuditLog({
      action: 'cheque_status_update',
      entity: 'bill',
      entityId: Number(billId),
      details: { chequeStatus: status, previousStatus: currentStatus, customerName: bill.customerName || '' }
    });
    if (window.billing) {
      await window.billing.loadOutstandingDirectory();
      window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
    }
    await this.render();
  }

  renderDataAudit(range, rangeBills) {
    const issues = [];
    const billMap = new Map(this.bills.map((b) => [Number(b.id), b]));

    const pushIssue = (severity, area, record, issue) => {
      issues.push({ severity, area, record, issue });
    };

    rangeBills.forEach((bill) => {
      const idLabel = `Bill #${bill.id}`;
      const t = this.getBillTotals(bill);
      const items = Array.isArray(bill.items) ? bill.items : [];
      const lineTotal = items.reduce((sum, item) => {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        return sum + (qty * price);
      }, 0);

      if (Number(bill.total) < 0) pushIssue('Critical', 'Bills', idLabel, 'Negative total amount');
      if (Number(bill.receivedAmount) < 0) pushIssue('Critical', 'Bills', idLabel, 'Negative received amount');
      if (Number(bill.balanceAmount) < 0) pushIssue('Critical', 'Bills', idLabel, 'Negative balance amount');
      if (Number(bill.changeAmount) < 0) pushIssue('Critical', 'Bills', idLabel, 'Negative change amount');
      if (items.length === 0 && (bill.billStatus || 'active') === 'active') {
        pushIssue('Critical', 'Bills', idLabel, 'Active bill has no items');
      }

      if (Math.abs(Money.subtract(bill.total, lineTotal)) > 0.01) {
        pushIssue('Warning', 'Bills', idLabel, 'Bill total does not match item sum');
      }

      if (bill.paymentStatus === 'paid' && Money.isPositive(t.balance)) {
        pushIssue('Warning', 'Bills', idLabel, 'Status is paid but balance is still due');
      }
      if (bill.paymentStatus === 'due' && !Money.isPositive(t.balance) && (bill.billStatus || 'active') === 'active') {
        pushIssue('Warning', 'Bills', idLabel, 'Status is due but balance is zero');
      }

      items.forEach((item, idx) => {
        const iLabel = `${idLabel} Item ${idx + 1}`;
        if (!String(item.name || '').trim()) pushIssue('Critical', 'Bill Items', iLabel, 'Missing product name');
        if ((Number(item.qty) || 0) <= 0) pushIssue('Critical', 'Bill Items', iLabel, 'Quantity must be > 0');
        if ((Number(item.price) || 0) < 0) pushIssue('Critical', 'Bill Items', iLabel, 'Negative selling price');
        if (Object.prototype.hasOwnProperty.call(item, 'costPrice') && (Number(item.costPrice) || 0) < 0) {
          pushIssue('Critical', 'Bill Items', iLabel, 'Negative cost price');
        }
      });
    });

    this.logs
      .filter((log) => this.inRange(log.timestamp || 0, range))
      .forEach((log) => {
        const record = `Log #${log.id || '-'} (Bill #${log.billId || '-'})`;
        const amount = Number(log.amount) || 0;
        const hasBill = billMap.has(Number(log.billId));

        if (!hasBill) pushIssue('Critical', 'Collections', record, 'References a missing bill');
        if (!Number.isFinite(Number(log.timestamp)) || Number(log.timestamp) <= 0) {
          pushIssue('Critical', 'Collections', record, 'Invalid timestamp');
        }
        if (amount === 0) pushIssue('Warning', 'Collections', record, 'Zero amount log entry');
        if (!String(log.method || '').trim()) pushIssue('Warning', 'Collections', record, 'Missing payment method');
      });

    this.products.forEach((p) => {
      const record = `Product #${p.id} (${p.name || 'Unnamed'})`;
      const stock = Number(p.stock) || 0;
      const billingPrice = Number(p.billingPrice) || 0;
      const invoicePrice = Number(p.invoicePrice) || 0;

      if (!String(p.name || '').trim()) pushIssue('Critical', 'Inventory', record, 'Missing product name');
      if (stock < 0) pushIssue('Critical', 'Inventory', record, 'Negative stock');
      if (billingPrice < 0) pushIssue('Critical', 'Inventory', record, 'Negative selling price');
      if (invoicePrice < 0) pushIssue('Critical', 'Inventory', record, 'Negative purchase price');
      if (billingPrice > 0 && invoicePrice > billingPrice) {
        pushIssue('Warning', 'Inventory', record, 'Purchase price is higher than selling price');
      }
    });

    const criticalCount = issues.filter((i) => i.severity === 'Critical').length;
    const warningCount = issues.filter((i) => i.severity === 'Warning').length;

    const rows = issues
      .sort((a, b) => {
        if (a.severity === b.severity) return 0;
        return a.severity === 'Critical' ? -1 : 1;
      })
      .slice(0, 40)
      .map((i) => [
        this.esc(i.severity),
        this.esc(i.area),
        this.esc(i.record),
        this.esc(i.issue)
      ]);

    return `
      <h3 class="report-title">Data Audit</h3>
      ${this.metricGrid([
        { label: 'Records Checked', value: `${rangeBills.length + this.products.length + this.logs.filter((l) => this.inRange(l.timestamp || 0, range)).length}` },
        { label: 'Critical Issues', value: criticalCount.toLocaleString() },
        { label: 'Warnings', value: warningCount.toLocaleString() },
        { label: 'Audit Result', value: criticalCount === 0 ? 'OK' : 'Needs Review' }
      ])}
      ${this.simpleTable(['Severity', 'Area', 'Record', 'Issue'], rows)}
    `;
  }

  renderSalesReport(rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const invoices = active.length;
    const totals = active.reduce((acc, b) => {
      const t = this.getBillTotals(b);
      acc.sales = Money.add(acc.sales, t.total);
      acc.received = Money.add(acc.received, t.netReceived);
      acc.due = Money.add(acc.due, t.balance);
      acc.change = Money.add(acc.change, t.change);
      return acc;
    }, { sales: 0, received: 0, due: 0, change: 0 });

    return `
      <h3 class="report-title">Sales Summary</h3>
      ${this.metricGrid([
        { label: 'Invoices', value: invoices.toLocaleString() },
        { label: 'Gross Sales', value: this.fmtLkr(totals.sales) },
        { label: 'Received', value: this.fmtLkr(totals.received) },
        { label: 'Outstanding', value: this.fmtLkr(totals.due) },
        { label: 'Change Given', value: this.fmtLkr(totals.change) },
        { label: 'Avg Invoice', value: this.fmtLkr(invoices ? totals.sales / invoices : 0) }
      ])}
    `;
  }

  getRangeExpenses(range) {
    return this.expenses.filter((expense) => this.dateInRange(expense.date, range));
  }

  renderProfitReport(range, rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    let revenue = 0;
    let cogs = 0;
    let received = 0;
    const expenses = this.getRangeExpenses(range);
    const expenseTotal = expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

    active.forEach((bill) => {
      const t = this.getBillTotals(bill);
      revenue += t.total;
      received += t.netReceived;

      (bill.items || []).forEach((item) => {
        const qty = Math.max(0, parseFloat(item.qty) || 0);
        const unitCost = this.getItemCost(item);
        cogs += unitCost * qty;
      });
    });

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenseTotal;
    const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
    const clampedReceived = Math.min(revenue, Math.max(0, received));
    const realizedRatio = revenue > 0 ? clampedReceived / revenue : 0;
    const realizedProfit = netProfit * realizedRatio;

    return `
      <h3 class="report-title">Net Profit</h3>
      ${this.metricGrid([
        { label: 'Revenue', value: this.fmtLkr(revenue) },
        { label: 'COGS', value: this.fmtLkr(cogs) },
        { label: 'Gross Profit', value: this.fmtLkr(grossProfit) },
        { label: 'Expenses', value: this.fmtLkr(expenseTotal) },
        { label: 'Net Profit', value: this.fmtLkr(netProfit) },
        { label: 'Net Margin', value: `${margin.toFixed(2)}%` },
        { label: 'Realized Profit', value: this.fmtLkr(realizedProfit) },
        { label: 'Unrealized Profit', value: this.fmtLkr(netProfit - realizedProfit) }
      ])}
    `;
  }

  renderExpenseReport(range) {
    const expenses = this.getRangeExpenses(range);
    const total = expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const categoryMap = new Map();
    expenses.forEach((expense) => {
      const category = expense.category || 'Other';
      categoryMap.set(category, (categoryMap.get(category) || 0) + (Number(expense.amount) || 0));
    });
    const rows = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => [
        this.esc(category),
        this.esc(this.fmtLkr(amount)),
        this.esc(total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : '0%')
      ]);

    return `
      <div class="report-title-row">
        <h3 class="report-title">Expense Summary</h3>
        <button class="btn-tool report-pdf-btn" onclick="reportsView.printCurrentReport('Expense Summary')">Download PDF</button>
      </div>
      ${this.metricGrid([
        { label: 'Expenses', value: this.fmtLkr(total) },
        { label: 'Entries', value: expenses.length.toLocaleString() },
        { label: 'Categories', value: categoryMap.size.toLocaleString() }
      ])}
      ${this.simpleTable(['Category', 'Amount', 'Share'], rows)}
    `;
  }

  renderDayCloseReport(range, rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const expenses = this.getRangeExpenses(range);
    const collections = this.getCollectionEntries(range);
    const sales = active.reduce((sum, bill) => Money.add(sum, bill.total), 0);
    const received = collections.reduce((sum, row) => Money.add(sum, row.amount), 0);
    const expenseTotal = expenses.reduce((sum, expense) => Money.add(sum, expense.amount), 0);
    const outstanding = active.reduce((sum, bill) => Money.add(sum, this.getBillTotals(bill).balance), 0);
    const cashCollected = collections
      .filter((row) => row.method === 'cash')
      .reduce((sum, row) => Money.add(sum, row.amount), 0);
    const cashInHand = Money.subtract(cashCollected, expenseTotal);

    return `
      <div class="report-title-row">
        <h3 class="report-title">Day Close</h3>
        <button class="btn-tool report-pdf-btn" onclick="reportsView.printDayClose80mm()">Print 80mm</button>
        <button class="btn-tool report-pdf-btn" onclick="reportsView.printCurrentReport('Day Close')">Download PDF</button>
      </div>
      ${this.metricGrid([
        { label: 'Invoices', value: active.length.toLocaleString() },
        { label: 'Sales', value: this.fmtLkr(sales) },
        { label: 'Received', value: this.fmtLkr(received) },
        { label: 'Expenses', value: this.fmtLkr(expenseTotal) },
        { label: 'Cash In Hand', value: this.fmtLkr(cashInHand) },
        { label: 'Outstanding', value: this.fmtLkr(outstanding) }
      ])}
    `;
  }

  getDayClose80mmData(range) {
    const rangeBills = this.bills.filter((bill) => this.inRange(bill.timestamp || 0, range));
    const activeBills = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const expenses = this.getRangeExpenses(range);
    const collections = this.getCollectionEntries(range);
    const chequeRows = this.getChequeRows(this.bills, range);

    const soldQty = activeBills.reduce((sum, bill) => Money.add(
      sum,
      (bill.items || []).reduce((billSum, item) => Money.add(billSum, Number(item.qty) || 0), 0)
    ), 0);
    const itemQtyMap = new Map();
    activeBills.forEach((bill) => {
      (bill.items || []).forEach((item) => {
        const canonical = this.getCanonicalProductKey(item);
        const unit = String(item.unit || '').trim();
        const rowKey = `${canonical.key}|${unit}`;
        if (!itemQtyMap.has(rowKey)) {
          itemQtyMap.set(rowKey, {
            name: canonical.name,
            unit,
            qty: 0
          });
        }
        const row = itemQtyMap.get(rowKey);
        row.qty = Money.add(row.qty, Number(item.qty) || 0);
      });
    });
    const itemQtyRows = [...itemQtyMap.values()]
      .sort((a, b) => b.qty - a.qty || String(a.name || '').localeCompare(String(b.name || '')));

    const billRows = activeBills.map((bill) => {
      const totals = this.getBillTotals(bill);
      return {
        billNo: bill.billNumber || bill.id || '-',
        customer: bill.customerName || 'Walk-in Customer',
        total: totals.total,
        received: totals.netReceived,
        balance: totals.balance,
        method: String(bill.paymentMethod || 'cash').toUpperCase()
      };
    });

    const totalReceived = collections.reduce((sum, row) => Money.add(sum, row.amount), 0);
    const cashReceived = collections
      .filter((row) => row.method === 'cash')
      .reduce((sum, row) => Money.add(sum, row.amount), 0);
    const cardReceived = collections
      .filter((row) => row.method === 'card')
      .reduce((sum, row) => Money.add(sum, row.amount), 0);
    const bankReceived = collections
      .filter((row) => row.method === 'bank')
      .reduce((sum, row) => Money.add(sum, row.amount), 0);
    const chequeMethodTotal = collections
      .filter((row) => row.method === 'cheque')
      .reduce((sum, row) => Money.add(sum, row.amount), 0);
    const chequeReceivedTotal = chequeRows.reduce((sum, row) => Money.add(sum, row.amount), 0);

    const creditBills = activeBills
      .filter((bill) => {
        const method = this.getPaymentMethod(bill);
        return method === 'credit' || bill.markAsCredit;
      })
      .map((bill) => {
        const totals = this.getBillTotals(bill);
        return {
          billNo: bill.billNumber || bill.id || '-',
          customer: bill.customerName || 'Walk-in Customer',
          total: totals.total,
          received: totals.received,
          balance: totals.balance
        };
      });
    const creditGivenTotal = creditBills.reduce((sum, row) => Money.add(sum, row.total), 0);
    const creditOutstandingTotal = creditBills.reduce((sum, row) => Money.add(sum, row.balance), 0);

    const creditCollections = collections
      .filter((row) => row.action === 'collection')
      .map((row) => {
        const bill = this.bills.find((item) => Number(item.id) === Number(row.billId));
        const method = this.getPaymentMethod(bill);
        if (!bill || (method !== 'credit' && !bill.markAsCredit)) return null;
        return {
          billNo: bill?.billNumber || row.billId || '-',
          customer: bill?.customerName || 'Walk-in Customer',
          amount: Number(row.amount) || 0,
          method: String(row.method || 'cash').toUpperCase()
        };
      })
      .filter(Boolean);
    const creditCollectedTotal = creditCollections.reduce((sum, row) => Money.add(sum, row.amount), 0);
    const paymentMethodTotals = [
      { label: 'Cash', amount: cashReceived },
      { label: 'Card', amount: cardReceived },
      { label: 'Transfer', amount: bankReceived },
      { label: 'Cheque', amount: chequeMethodTotal },
      { label: 'Credit', amount: creditGivenTotal }
    ];

    let revenue = 0;
    let cogs = 0;
    activeBills.forEach((bill) => {
      const t = this.getBillTotals(bill);
      revenue = Money.add(revenue, t.total);
      (bill.items || []).forEach((item) => {
        const qty = Math.max(0, parseFloat(item.qty) || 0);
        const unitCost = this.getItemCost(item);
        cogs += unitCost * qty;
      });
    });
    const expenseTotal = expenses.reduce((sum, expense) => Money.add(sum, expense.amount), 0);
    const grossProfit = Money.subtract(revenue, cogs);
    const netProfit = Money.subtract(grossProfit, expenseTotal);

    return {
      range,
      generatedAt: new Date(),
      soldQty,
      itemQtyRows,
      billRows,
      totalReceived,
      cashReceived,
      cardReceived,
      bankReceived,
      paymentMethodTotals,
      chequeRows,
      chequeReceivedTotal,
      creditBills,
      creditGivenTotal,
      creditOutstandingTotal,
      creditCollections,
      creditCollectedTotal,
      netProfit,
      totalSales: revenue
    };
  }

  buildDayClose80mmHtml(data) {
    const esc = (value) => this.esc(value);
    const fmt = (value) => Money.round(value).toLocaleString();
    const rangeLabel = (() => {
      const { from, to } = data.range || {};
      if (from === null && to === null) return 'All Time';
      if (from !== null && to !== null) {
        return `${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}`;
      }
      return new Date().toLocaleDateString();
    })();
    const row = (label, value) => `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
    const billRows = data.billRows.length
      ? data.billRows.map((bill) => `
        <div class="block">
          ${row(`Bill #${bill.billNo}`, fmt(bill.total))}
          ${row('Customer', bill.customer)}
          ${row('Received', fmt(bill.received))}
          ${row('Balance', fmt(bill.balance))}
          ${row('Method', bill.method)}
        </div>`).join('')
      : '<div class="empty">No bill data</div>';
    const chequeRows = data.chequeRows.length
      ? data.chequeRows.map((cheque) => `
        <div class="block">
          ${row(`${cheque.label} #${cheque.billNo}`, fmt(cheque.amount))}
          ${row('Customer', cheque.customer)}
          ${row('Date', cheque.chequeDate)}
          ${row('No', cheque.chequeNumber)}
          ${row('Bank', cheque.chequeBank)}
          ${row('Status', cheque.status)}
        </div>`).join('')
      : '<div class="empty">No cheque data</div>';
    const creditBillRows = data.creditBills.length
      ? data.creditBills.map((bill) => `
        <div class="block">
          ${row(`Bill #${bill.billNo}`, fmt(bill.total))}
          ${row('Customer', bill.customer)}
          ${row('Received', fmt(bill.received))}
          ${row('Due', fmt(bill.balance))}
        </div>`).join('')
      : '<div class="empty">No credit bills</div>';
    const creditCollectionRows = data.creditCollections.length
      ? data.creditCollections.map((item) => `
        <div class="block">
          ${row(`Bill #${item.billNo}`, fmt(item.amount))}
          ${row('Customer', item.customer)}
          ${row('Method', item.method)}
        </div>`).join('')
      : '<div class="empty">No credit collections</div>';
    const paymentMethodRows = data.paymentMethodTotals.length
      ? data.paymentMethodTotals.map((item) => `
        <div class="block">
          ${row(item.label, fmt(item.amount))}
        </div>`).join('')
      : '<div class="empty">No payment data</div>';
    const itemQtyRows = data.itemQtyRows.length
      ? data.itemQtyRows.map((item) => `
        <div class="block">
          ${row(item.name, `${fmt(item.qty)}${item.unit ? ` ${item.unit}` : ''}`)}
        </div>`).join('')
      : '<div class="empty">No sold items</div>';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Day Close 80mm</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { width: 80mm; margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Courier New', monospace; font-size: 14px; font-weight: 700; color: #000; }
  .screen-actions { position: sticky; top: 0; background: #fff; padding: 10px; display: flex; gap: 8px; border-bottom: 1px solid #ddd; }
  .screen-actions button { border: 1px solid #111; background: #fff; color: #111; padding: 8px 10px; border-radius: 8px; font-size: 13px; font-weight: 700; }
  .screen-actions .back-btn { background: #111; color: #fff; }
  .sheet { width: 80mm; padding: 2mm 2.5mm 4mm; }
  .center { text-align: center; }
  .title { font-size: 16px; margin-bottom: 3px; }
  .sub { font-size: 12px; margin-bottom: 2px; }
  .rule { border-top: 1px dashed #000; margin: 7px 0; }
  .section-title { font-size: 14px; margin: 2px 0 5px; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 2px 0; }
  .row span:last-child { text-align: right; }
  .block { padding: 5px 0; border-bottom: 1px dotted #888; }
  .block:last-child { border-bottom: 0; }
  .empty { padding: 4px 0; font-size: 12px; }
  @media print { .screen-actions { display: none !important; } }
</style>
</head>
<body>
  <div class="screen-actions">
    <button onclick="doPrint()">Print</button>
    <button class="back-btn" onclick="backToApp()">Close</button>
  </div>
  <div class="sheet">
    <div class="center">
      <div class="title">Day Summary</div>
      <div class="sub">${esc(rangeLabel)}</div>
      <div class="sub">${esc(data.generatedAt.toLocaleString())}</div>
    </div>

    <div class="rule"></div>
    <div class="section-title">Sold Qty / Sales</div>
    ${row('Sold Qty', String(data.soldQty))}
    ${row('Sales Total', fmt(data.totalSales))}
    ${itemQtyRows}

    <div class="rule"></div>
    <div class="section-title">Bill Details</div>
    ${billRows}

    <div class="rule"></div>
    <div class="section-title">Payment Method Totals</div>
    ${paymentMethodRows}

    <div class="rule"></div>
    <div class="section-title">Received Amount</div>
    ${row('Total Received', fmt(data.totalReceived))}
    ${row('Cash Received', fmt(data.cashReceived))}
    ${row('Card Received', fmt(data.cardReceived))}
    ${row('Bank Received', fmt(data.bankReceived))}

    <div class="rule"></div>
    <div class="section-title">Cheque Received</div>
    ${row('Cheque Total', fmt(data.chequeReceivedTotal))}
    ${chequeRows}

    <div class="rule"></div>
    <div class="section-title">Credit Given</div>
    ${row('Credit Sale Total', fmt(data.creditGivenTotal))}
    ${row('Credit Outstanding', fmt(data.creditOutstandingTotal))}
    ${creditBillRows}

    <div class="rule"></div>
    <div class="section-title">Credit Collections</div>
    ${row('Collected Total', fmt(data.creditCollectedTotal))}
    ${creditCollectionRows}

    <div class="rule"></div>
    <div class="section-title">Profit</div>
    ${row('Day Profit', fmt(data.netProfit))}
  </div>
  <script>
    function doPrint() {
      var np = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
      if (np && typeof np.print === 'function') {
        np.print({ jobName: 'T Billing Day Close' }).catch(function () { window.print(); });
        return;
      }
      window.print();
    }
    function backToApp() {
      var isCap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      if (isCap) {
        if (window.history.length > 1) { window.history.back(); } else { window.location.replace('index.html'); }
        return;
      }
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (window.opener && !window.opener.closed) { try { window.opener.focus(); } catch (e) {} }
        if (!window.closed && window.history.length > 1) { window.history.back(); }
      }, 120);
    }
  <\/script>
</body>
</html>`;
  }

  printDayClose80mm() {
    const data = this.getDayClose80mmData(this.getRange());
    const html = this.buildDayClose80mmHtml(data);
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

    if (isCapacitor) {
      document.open();
      document.write(html);
      document.close();
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      document.open();
      document.write(html);
      document.close();
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  renderReceivablesReport(rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const dueMap = new Map();
    let dueBills = 0;
    let totalDue = 0;

    active.forEach((bill) => {
      const t = this.getBillTotals(bill);
      if (!Money.isPositive(t.balance)) return;
      dueBills += 1;
      totalDue = Money.add(totalDue, t.balance);
      const key = (bill.customerName || 'Walk-in Customer').trim() || 'Walk-in Customer';
      dueMap.set(key, Money.add(dueMap.get(key) || 0, t.balance));
    });

    const topRows = [...dueMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, due]) => [this.esc(name), this.esc(this.fmtLkr(due))]);

    return `
      <h3 class="report-title">Outstanding / Receivables</h3>
      ${this.metricGrid([
        { label: 'Due Bills', value: dueBills.toLocaleString() },
        { label: 'Total Outstanding', value: this.fmtLkr(totalDue) },
        { label: 'Customers with Due', value: dueMap.size.toLocaleString() },
        { label: 'Average Due/Bill', value: this.fmtLkr(dueBills ? totalDue / dueBills : 0) }
      ])}
      ${this.simpleTable(['Customer', 'Due Amount'], topRows)}
    `;
  }

  renderCollectionsReport(range) {
    const inflow = this.getCollectionEntries(range);
    const methodMap = new Map();
    let total = 0;
    let invoicePay = 0;
    let dueCollect = 0;

    inflow.forEach((log) => {
      const amount = Number(log.amount) || 0;
      total += amount;
      const method = String(log.method || 'unknown').toLowerCase();
      methodMap.set(method, (methodMap.get(method) || 0) + amount);
      if (log.action === 'invoice_payment') invoicePay += amount;
      if (log.action === 'collection') dueCollect += amount;
    });

    const rows = [...methodMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => [
        this.esc(method.toUpperCase()),
        this.esc(this.fmtLkr(amount)),
        this.esc(total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : '0%')
      ]);

    return `
      <h3 class="report-title">Collections Summary</h3>
      ${this.metricGrid([
        { label: 'Total Collected', value: this.fmtLkr(total) },
        { label: 'Entries', value: inflow.length.toLocaleString() },
        { label: 'Invoice Payments', value: this.fmtLkr(invoicePay) },
        { label: 'Due Collections', value: this.fmtLkr(dueCollect) },
        { label: 'Avg Collection', value: this.fmtLkr(inflow.length ? total / inflow.length : 0) }
      ])}
      ${this.simpleTable(['Method', 'Amount', 'Share'], rows)}
    `;
  }

  renderTopProductsReport(rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const map = new Map();

    active.forEach((bill) => {
      (bill.items || []).forEach((item) => {
        const canonical = this.getCanonicalProductKey(item);
        if (!map.has(canonical.key)) {
          map.set(canonical.key, { name: canonical.name, qty: 0, sales: 0, cost: 0 });
        }
        const row = map.get(canonical.key);
        const qty = Math.max(0, parseFloat(item.qty) || 0);
        const price = Number(item.price) || 0;
        const cost = this.getItemCost(item);

        if (!row.name || row.name === 'Unknown') {
          row.name = canonical.name;
        }
        row.qty += qty;
        row.sales += qty * price;
        row.cost += qty * cost;
      });
    });

    const rows = [...map.values()]
      .map((r) => ({ ...r, profit: r.sales - r.cost }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5)
      .map((r) => [
        this.esc(r.name),
        this.esc(String(r.qty)),
        this.esc(this.fmtLkr(r.sales)),
        this.esc(this.fmtLkr(r.profit))
      ]);

    return `
      <h3 class="report-title">Top Products</h3>
      ${this.simpleTable(['Product', 'Qty', 'Sales', 'Profit'], rows)}
    `;
  }

  renderStockReport() {
    let units = 0;
    let costValue = 0;
    let salesValue = 0;
    let out = 0;
    let low = 0;

    this.products.forEach((p) => {
      const stock = Number(p.stock) || 0;
      const cost = Number(p.invoicePrice) || 0;
      const sell = Number(p.billingPrice) || 0;

      if (stock <= 0) out += 1;
      if (stock > 0 && stock <= (Number(p.reorderLevel) || 5)) low += 1;

      units += Math.max(0, stock);
      costValue += Math.max(0, stock) * cost;
      salesValue += Math.max(0, stock) * sell;
    });

    return `
      <h3 class="report-title">Stock Valuation</h3>
      ${this.metricGrid([
        { label: 'Total Units', value: units.toLocaleString() },
        { label: 'Cost Value', value: this.fmtLkr(costValue) },
        { label: 'Sales Value', value: this.fmtLkr(salesValue) },
        { label: 'Expected Profit', value: this.fmtLkr(salesValue - costValue) },
        { label: 'Low Stock Items', value: low.toLocaleString() },
        { label: 'Out of Stock', value: out.toLocaleString() }
      ])}
    `;
  }

  renderLowStockReport() {
    const rows = this.products
      .filter((p) => {
        const stock = Number(p.stock) || 0;
        const reorderLevel = Number(p.reorderLevel) || 5;
        return stock <= reorderLevel;
      })
      .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
      .map((p) => [
        this.esc(p.name || '-'),
        this.esc(String(Number(p.stock) || 0)),
        this.esc(String(Number(p.reorderLevel) || 5)),
        this.esc((Number(p.stock) || 0) <= 0 ? 'Out of Stock' : 'Low Stock')
      ]);

    return `
      <div class="report-title-row">
        <h3 class="report-title">Low Stock</h3>
        <button class="btn-tool report-pdf-btn" onclick="reportsView.printCurrentReport('Low Stock')">Download PDF</button>
      </div>
      ${this.simpleTable(['Product', 'Stock', 'Reorder Level', 'Status'], rows)}
    `;
  }

  renderAuditLogReport(range) {
    const rows = this.auditLogs
      .filter((log) => this.inRange(log.timestamp || 0, range))
      .slice(0, 50)
      .map((log) => [
        this.esc(new Date(log.timestamp || Date.now()).toLocaleString()),
        this.esc(log.action || '-'),
        this.esc(log.entity || '-'),
        this.esc(log.entityId ?? '-')
      ]);

    return `
      <h3 class="report-title">Audit Log</h3>
      ${this.simpleTable(['Date', 'Action', 'Area', 'Record'], rows)}
    `;
  }

  renderPaymentMethodReport(range, rangeBills) {
    const inflow = this.getCollectionEntries(range);
    const methodMap = new Map();
    let total = 0;

    if (inflow.length > 0) {
      inflow.forEach((log) => {
        const amount = Number(log.amount) || 0;
        const method = String(log.method || 'unknown').toLowerCase();
        methodMap.set(method, (methodMap.get(method) || 0) + amount);
        total += amount;
      });
    } else {
      rangeBills
        .filter((b) => (b.billStatus || 'active') === 'active')
        .forEach((bill) => {
          const payments = this.getPaymentRows(bill).filter((payment) => this.getEffectivePaymentAmount(payment) > 0);
          if (payments.length) {
            payments.forEach((payment) => {
              const amount = this.getEffectivePaymentAmount(payment);
              const method = payment.method || 'unknown';
              methodMap.set(method, (methodMap.get(method) || 0) + amount);
              total += amount;
            });
            return;
          }
          const received = this.getBillTotals(bill).netReceived;
          if (received <= 0) return;
          const method = String(bill.paymentMethod || 'unknown').toLowerCase();
          methodMap.set(method, (methodMap.get(method) || 0) + received);
          total += received;
        });
    }

    const rows = [...methodMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => [
        this.esc(method.toUpperCase()),
        this.esc(this.fmtLkr(amount)),
        this.esc(total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : '0%')
      ]);

    return `
      <h3 class="report-title">Payment Method Breakdown</h3>
      ${this.metricGrid([
        { label: 'Total Received', value: this.fmtLkr(total) },
        { label: 'Methods Used', value: methodMap.size.toLocaleString() }
      ])}
      ${this.simpleTable(['Method', 'Amount', 'Share'], rows)}
    `;
  }

  renderCustomerSummary(rangeBills) {
    const active = rangeBills.filter((b) => (b.billStatus || 'active') === 'active');
    const map = new Map();

    active.forEach((bill) => {
      const key = (bill.customerName || 'Walk-in Customer').trim() || 'Walk-in Customer';
      if (!map.has(key)) {
        map.set(key, { bills: 0, sales: 0, received: 0, due: 0 });
      }
      const t = this.getBillTotals(bill);
      const row = map.get(key);
      row.bills += 1;
      row.sales = Money.add(row.sales, t.total);
      row.received = Money.add(row.received, t.netReceived);
      row.due = Money.add(row.due, t.balance);
    });

    const topRows = [...map.entries()]
      .sort((a, b) => b[1].sales - a[1].sales)
      .slice(0, 5)
      .map(([name, v]) => [
        this.esc(name),
        this.esc(this.fmtLkr(v.sales)),
        this.esc(this.fmtLkr(v.due))
      ]);

    const totalSales = [...map.values()].reduce((s, v) => s + v.sales, 0);
    return `
      <h3 class="report-title">Customer Summary</h3>
      ${this.metricGrid([
        { label: 'Active Customers', value: map.size.toLocaleString() },
        { label: 'Customer Sales', value: this.fmtLkr(totalSales) },
        { label: 'Avg Sales/Customer', value: this.fmtLkr(map.size ? totalSales / map.size : 0) }
      ])}
      ${this.simpleTable(['Customer', 'Sales', 'Outstanding'], topRows)}
    `;
  }

  getSelectedReportTitle() {
    const { reportType } = this.getInputs();
    const option = reportType?.selectedOptions?.[0];
    return option?.textContent?.trim() || 'Report';
  }

  printSelectedReport() {
    const { reportType } = this.getInputs();
    const selected = reportType?.value || 'sales';
    if (selected === 'cheques') {
      this.printChequeReport();
      return;
    }
    this.printCurrentReport(this.getSelectedReportTitle());
  }

  ensureReportPdfButton() {
    const { view } = this.getInputs();
    if (!view || view.querySelector('.report-pdf-btn')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-tool report-pdf-btn';
    button.textContent = 'Download PDF';
    button.addEventListener('click', () => this.printSelectedReport());

    const title = view.querySelector('.report-title');
    if (title) {
      const titleRow = document.createElement('div');
      titleRow.className = 'report-title-row';
      title.parentNode.insertBefore(titleRow, title);
      titleRow.appendChild(title);
      titleRow.appendChild(button);
      return;
    }

    const titleRow = document.createElement('div');
    titleRow.className = 'report-title-row';
    const heading = document.createElement('h3');
    heading.className = 'report-title';
    heading.textContent = this.getSelectedReportTitle();
    titleRow.appendChild(heading);
    titleRow.appendChild(button);
    view.prepend(titleRow);
  }
  renderSelected(range, rangeBills) {
    const { reportType, view } = this.getInputs();
    if (!view) return;
    const selected = reportType?.value || 'sales';

    if (selected === 'sales') {
      view.innerHTML = this.renderSalesReport(rangeBills);
      return;
    }
    if (selected === 'profit') {
      view.innerHTML = this.renderProfitReport(range, rangeBills);
      return;
    }
    if (selected === 'receivables') {
      view.innerHTML = this.renderReceivablesReport(rangeBills);
      return;
    }
    if (selected === 'collections') {
      view.innerHTML = this.renderCollectionsReport(range);
      return;
    }
    if (selected === 'products') {
      view.innerHTML = this.renderTopProductsReport(rangeBills);
      return;
    }
    if (selected === 'stock') {
      view.innerHTML = this.renderStockReport();
      return;
    }
    if (selected === 'payments') {
      view.innerHTML = this.renderPaymentMethodReport(range, rangeBills);
      return;
    }
    if (selected === 'cheques') {
      view.innerHTML = this.renderChequeReport(range);
      view.querySelectorAll('.cheque-status-select').forEach((select) => {
        select.addEventListener('change', async () => {
          await this.updateChequeStatus(select.getAttribute('data-cheque-bill-id'), select.value, select.getAttribute('data-cheque-payment-id'));
        });
      });
      return;
    }
    if (selected === 'expenses') {
      view.innerHTML = this.renderExpenseReport(range);
      return;
    }
    if (selected === 'dayclose') {
      view.innerHTML = this.renderDayCloseReport(range, rangeBills);
      return;
    }
    if (selected === 'lowstock') {
      view.innerHTML = this.renderLowStockReport();
      return;
    }
    if (selected === 'auditlog') {
      view.innerHTML = this.renderAuditLogReport(range);
      return;
    }
    if (selected === 'audit') {
      view.innerHTML = this.renderDataAudit(range, rangeBills);
      return;
    }
    view.innerHTML = this.renderCustomerSummary(rangeBills);
  }

  toggleCustomDates() {
    const { period, customWrap } = this.getInputs();
    if (!customWrap || !period) return;
    customWrap.classList.toggle('hidden', period.value !== 'custom');
  }

  bind() {
    if (this.bound) return;
    const { reportType, period, from, to, note, noteSave, noteClear } = this.getInputs();
    const onChange = () => {
      this.toggleCustomDates();
      this.render();
    };

    reportType?.addEventListener('change', onChange);
    period?.addEventListener('change', onChange);
    from?.addEventListener('change', onChange);
    to?.addEventListener('change', onChange);
    noteSave?.addEventListener('click', () => this.saveNotes());
    noteClear?.addEventListener('click', () => this.clearNotes());
    note?.addEventListener('input', () => this.setNoteStatus('Unsaved changes'));

    this.bound = true;
  }

  async render() {
    const { view } = this.getInputs();
    if (!view) return;
    view.innerHTML = '<div class="report-loading">Loading report...</div>';

    const [bills, products, logs, expenses, auditLogs] = await Promise.all([
      window.db.getBills(),
      window.db.getProducts(),
      window.db.getCollectionLogs(),
      window.db.getExpenses(),
      window.db.getAuditLogs()
    ]);
    this.bills = bills;
    this.products = products;
    this.logs = logs;
    this.expenses = expenses;
    this.auditLogs = auditLogs;

    const range = this.getRange();
    const rangeBills = this.bills.filter((bill) => this.inRange(bill.timestamp || 0, range));
    this.renderSelected(range, rangeBills);
    this.ensureReportPdfButton();
  }

  init() {
    this.bind();
    this.toggleCustomDates();
    this.loadNotes();
  }
}

window.reportsView = new ReportsView();










