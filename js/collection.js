class CollectionPage {
  constructor() {
    this.bills = [];
    this.logs = [];
    this.bound = false;
  }

  getQuery() {
    const input = document.getElementById('collection-search');
    return (input?.value || '').trim().toLowerCase();
  }

  toggleChequeDetails(billId) {
    const method = document.getElementById(`collect-method-${billId}`);
    const details = document.getElementById(`collect-cheque-details-${billId}`);
    if (!method || !details) return;
    details.classList.toggle('hidden', method.value !== 'cheque');
  }

  getChequeDetails(billId, method) {
    if (method !== 'cheque') {
      return {
        chequeDate: '',
        chequeNumber: '',
        chequeBank: ''
      };
    }

    return {
      chequeDate: document.getElementById(`collect-cheque-date-${billId}`)?.value || '',
      chequeNumber: (document.getElementById(`collect-cheque-number-${billId}`)?.value || '').trim(),
      chequeBank: (document.getElementById(`collect-cheque-bank-${billId}`)?.value || '').trim()
    };
  }

  validateChequeDetails(details) {
    if (!details.chequeDate || !details.chequeNumber || !details.chequeBank) {
      alert('Please fill cheque date, cheque number, and bank.');
      return false;
    }
    return true;
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  getBillPayments(bill) {
    if (Array.isArray(bill?.payments) && bill.payments.length) return bill.payments;
    const method = String(bill?.paymentMethod || 'cash').toLowerCase();
    const amount = Money.clampZero(bill?.receivedAmount || 0);
    return Money.isPositive(amount) ? [{
      id: 'legacy-payment-1',
      method,
      amount,
      chequeDate: bill?.chequeDate || '',
      chequeNumber: bill?.chequeNumber || '',
      chequeBank: bill?.chequeBank || '',
      chequeStatus: method === 'cheque' ? (bill?.chequeStatus || 'pending') : ''
    }] : [];
  }

  createCollectionPayment(method, amount, chequeDetails = {}) {
    return {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      method,
      amount: Money.clampZero(amount),
      chequeDate: method === 'cheque' ? chequeDetails.chequeDate : '',
      chequeNumber: method === 'cheque' ? chequeDetails.chequeNumber : '',
      chequeBank: method === 'cheque' ? chequeDetails.chequeBank : '',
      chequeStatus: method === 'cheque' ? 'pending' : ''
    };
  }
  getDueBills() {
    const query = this.getQuery();
    return this.bills
      .filter((bill) => {
        if ((bill.billStatus || 'active') !== 'active') return false;

        const total = Money.round(bill.total);
        const received = Money.round(bill.receivedAmount || 0);
        const storedBalance = typeof bill.balanceAmount === 'number' ? Money.round(bill.balanceAmount) : null;
        const balance = storedBalance !== null ? Money.clampZero(storedBalance) : Money.clampZero(Money.subtract(total, received));
        if (!Money.isPositive(balance)) return false;
        if (!query) return true;
        return (bill.customerName || '').toLowerCase().includes(query);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async collectPayment(billId) {
    const amountInput = document.getElementById(`collect-amount-${billId}`);
    const methodInput = document.getElementById(`collect-method-${billId}`);
    const amount = Money.clampZero(amountInput?.value || '0');
    const method = methodInput?.value || 'cash';
    const chequeDetails = this.getChequeDetails(billId, method);

    if (!Money.isPositive(amount)) {
      alert('Enter a valid collection amount.');
      return;
    }

    if (method === 'cheque' && !this.validateChequeDetails(chequeDetails)) return;

    const newPayment = this.createCollectionPayment(method, amount, chequeDetails);

    try {
      await window.db.collectBillPaymentAtomic({
        billId,
        amount,
        method,
        chequeDetails,
        payment: newPayment,
        auditLog: {
          action: 'collection_create',
          entity: 'bill',
          details: { amount, method }
        }
      });
    } catch (error) {
      alert(error?.message || 'Failed to collect payment. Please refresh and try again.');
      await this.render();
      return;
    }

    await this.render();
    if (window.historyView && window.app.currentPage === 'history') await window.historyView.render();
    if (window.customersPage && window.app.currentPage === 'customers') await window.customersPage.render();
    if (window.billing) {
      await window.billing.loadOutstandingDirectory();
      window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
    }
  }

  renderList(bills) {
    const list = document.getElementById('collection-list');
    if (!list) return;

    if (bills.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No pending collections.</div>';
      return;
    }

    list.innerHTML = '';
    bills.forEach((bill) => {
      const total = Money.round(bill.total);
      const received = Money.round(bill.receivedAmount || 0);
      const balance = typeof bill.balanceAmount === 'number'
        ? Money.clampZero(bill.balanceAmount)
        : Money.clampZero(Money.subtract(total, received));
      const dateStr = new Date(bill.timestamp).toLocaleString();

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-weight:600;">${this.escapeHtml(bill.customerName || 'Walk-in Customer')}</div>
          <div class="collection-badge">Due LKR ${balance.toLocaleString()}</div>
        </div>
        <div class="history-date" style="margin-bottom:12px;">${this.escapeHtml(dateStr)} | Bill #${this.escapeHtml(bill.id)}</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-bottom:12px;">
          <div><div class="history-date">Total</div><div style="font-weight:600;">${total.toLocaleString()}</div></div>
          <div><div class="history-date">Received</div><div style="font-weight:600;">${received.toLocaleString()}</div></div>
          <div><div class="history-date">Balance</div><div style="font-weight:600;">${balance.toLocaleString()}</div></div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:8px; align-items:end;">
          <div class="input-group" style="margin-bottom:0;">
            <label>Collect Amount</label>
            <input type="number" id="collect-amount-${bill.id}" class="input-field" placeholder="0" step="0.01">
          </div>
          <div class="input-group" style="margin-bottom:0;">
            <label>Method</label>
            <select id="collect-method-${bill.id}" class="input-field">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <button class="btn-primary" style="margin:0; width:auto; padding:10px 16px;" data-collect-id="${bill.id}">Collect</button>
        </div>
        <div id="collect-cheque-details-${bill.id}" class="cheque-details hidden" style="margin-top:10px;">
          <div class="input-group">
            <label>Cheque Date</label>
            <input type="date" id="collect-cheque-date-${bill.id}" class="input-field">
          </div>
          <div class="input-group">
            <label>Cheque Number</label>
            <input type="text" id="collect-cheque-number-${bill.id}" class="input-field" placeholder="Enter cheque number">
          </div>
          <div class="input-group" style="margin-bottom:0;">
            <label>Bank</label>
            <input type="text" id="collect-cheque-bank-${bill.id}" class="input-field" placeholder="Enter bank name">
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[id^="collect-method-"]').forEach((select) => {
      select.addEventListener('change', () => {
        const billId = Number(select.id.replace('collect-method-', ''));
        this.toggleChequeDetails(billId);
      });
    });

    list.querySelectorAll('[data-collect-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const billId = Number(btn.getAttribute('data-collect-id'));
        await this.collectPayment(billId);
      });
    });
  }

  renderAuditTrail() {
    const trail = document.getElementById('collection-audit-list');
    if (!trail) return;

    if (!this.logs.length) {
      trail.innerHTML = '<div style="text-align:center; padding:12px; color:var(--text-muted)">No collection activity yet.</div>';
      return;
    }

    trail.innerHTML = '';
    this.logs.slice(0, 30).forEach((log) => {
      const row = document.createElement('div');
      row.className = 'collection-log-row';
      const date = new Date(log.timestamp).toLocaleString();
      const action = log.action || 'collection';
      row.innerHTML = `
        <div class="collection-log-main">
          <strong>${this.escapeHtml(log.customerName || 'Customer')}</strong> &bull; Bill #${this.escapeHtml(log.billId)}
        </div>
        <div class="collection-log-sub">
          ${this.escapeHtml(date)} &bull; ${this.escapeHtml(action)} &bull; ${this.escapeHtml(log.method || '-')} &bull; LKR ${(Number(log.amount) || 0).toLocaleString()}
        </div>
      `;
      trail.appendChild(row);
    });
  }

  bind() {
    if (this.bound) return;
    const search = document.getElementById('collection-search');
    search?.addEventListener('input', () => {
      this.renderList(this.getDueBills());
    });
    this.bound = true;
  }

  async render() {
    const list = document.getElementById('collection-list');
    if (list) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    }
    this.bind();
    const [bills, logs] = await Promise.all([window.db.getBills(), window.db.getCollectionLogs()]);
    this.bills = bills;
    this.logs = logs;
    this.renderList(this.getDueBills());
    this.renderAuditTrail();
  }

  init() {
    // Initialized from app.js
  }
}

window.collectionPage = new CollectionPage();



