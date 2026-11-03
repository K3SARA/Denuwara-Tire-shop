class CollectionPage {
  constructor() {
    this.bills = [];
    this.logs = [];
    this.customers = [];
    this.bound = false;
    this.activeTab = 'pending';
    this.editingLog = null;
  }

  getQuery() {
    const input = document.getElementById('collection-search');
    return (input?.value || '').trim().toLowerCase();
  }

  switchTab(tab) {
    this.activeTab = tab;
    const pendingBtn = document.getElementById('tab-collection-pending');
    const completedBtn = document.getElementById('tab-collection-completed');
    const listSection = document.getElementById('collection-list-section');
    const completedCard = document.getElementById('collection-completed-card');
    if (pendingBtn) pendingBtn.classList.toggle('active', tab === 'pending');
    if (completedBtn) completedBtn.classList.toggle('active', tab === 'completed');
    if (listSection) listSection.style.display = tab === 'completed' ? 'none' : 'block';
    if (completedCard) completedCard.style.display = tab === 'pending' ? 'none' : 'block';
  }

  toggleChequeDetails(billId) {
    const method = document.getElementById(`collect-method-${billId}`);
    const details = document.getElementById(`collect-cheque-details-${billId}`);
    if (!method || !details) return;
    details.classList.toggle('hidden', method.value !== 'cheque');
  }

  toggleEditChequeDetails(method) {
    const details = document.getElementById('edit-collection-cheque-details');
    if (!details) return;
    details.classList.toggle('hidden', method !== 'cheque');
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
    const billItems = this.bills
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
      .map((bill) => ({
        ...bill,
        isOpeningBalance: false,
        keyId: String(bill.id),
        balance: typeof bill.balanceAmount === 'number'
          ? Money.clampZero(bill.balanceAmount)
          : Money.clampZero(Money.subtract(Money.round(bill.total), Money.round(bill.receivedAmount || 0)))
      }));

    const openingItems = (this.customers || [])
      .filter((c) => {
        const op = Money.clampZero(c.openingBalance || 0);
        if (!Money.isPositive(op)) return false;
        if (!query) return true;
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        return name.includes(query) || phone.includes(query);
      })
      .map((c) => ({
        id: `ob-${c.id}`,
        customerId: c.id,
        customerName: c.name,
        customerPhone: c.phone,
        customerAddress: c.address,
        isOpeningBalance: true,
        keyId: `ob-${c.id}`,
        total: Money.round(c.openingBalance),
        receivedAmount: 0,
        balance: Money.round(c.openingBalance),
        timestamp: c.created_at || Date.now()
      }));

    return [...openingItems, ...billItems].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  getFilteredLogs() {
    const query = this.getQuery();
    if (!query) return this.logs;
    return this.logs.filter((log) => {
      const customer = (log.customerName || '').toLowerCase();
      const billId = String(log.billId || '').toLowerCase();
      const method = String(log.method || '').toLowerCase();
      const chequeNumber = String(log.chequeNumber || '').toLowerCase();
      const isOpening = log.isOpeningBalance ? 'opening balance' : '';
      return customer.includes(query) || billId.includes(query) || method.includes(query) || chequeNumber.includes(query) || isOpening.includes(query);
    });
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

    await window.app.withLoading(async () => {
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
    }, 'Recording collection...', 'Updating bill and balance');
  }

  async collectOpeningPayment(customerId, keyId) {
    const amountInput = document.getElementById(`collect-amount-${keyId}`);
    const methodInput = document.getElementById(`collect-method-${keyId}`);
    const amount = Money.clampZero(amountInput?.value || '0');
    const method = methodInput?.value || 'cash';
    const chequeDetails = this.getChequeDetails(keyId, method);

    if (!Money.isPositive(amount)) {
      alert('Enter a valid collection amount.');
      return;
    }

    if (method === 'cheque' && !this.validateChequeDetails(chequeDetails)) return;

    await window.app.withLoading(async () => {
      try {
        await window.db.collectCustomerOpeningBalanceAtomic({
          customerId,
          amount,
          method,
          chequeDetails
        });
      } catch (error) {
        alert(error?.message || 'Failed to collect payment. Please refresh and try again.');
        await this.render();
        return;
      }

      await this.render();
      if (window.customersPage && window.app.currentPage === 'customers') await window.customersPage.render();
      if (window.billing) {
        await window.billing.loadOutstandingDirectory();
        window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
      }
    }, 'Recording collection...', 'Updating customer opening balance');
  }

  openEditModal(logId) {
    const log = this.logs.find((l) => l.id === logId);
    if (!log) return;
    this.editingLog = log;

    const customerEl = document.getElementById('edit-collection-customer');
    const billInfoEl = document.getElementById('edit-collection-bill-info');
    const amountEl = document.getElementById('edit-collection-amount');
    const methodEl = document.getElementById('edit-collection-method');
    const chequeDateEl = document.getElementById('edit-collection-cheque-date');
    const chequeNumEl = document.getElementById('edit-collection-cheque-number');
    const chequeBankEl = document.getElementById('edit-collection-cheque-bank');

    if (customerEl) customerEl.textContent = log.customerName || 'Walk-in Customer';
    const dateStr = new Date(log.timestamp).toLocaleString();
    if (billInfoEl) {
      billInfoEl.textContent = log.isOpeningBalance
        ? `Opening Balance • ${dateStr}`
        : `Bill #${log.billId} • ${dateStr}`;
    }
    if (amountEl) amountEl.value = log.amount || 0;
    if (methodEl) methodEl.value = (log.method || 'cash').toLowerCase();
    if (chequeDateEl) chequeDateEl.value = log.chequeDate || '';
    if (chequeNumEl) chequeNumEl.value = log.chequeNumber || '';
    if (chequeBankEl) chequeBankEl.value = log.chequeBank || '';

    this.toggleEditChequeDetails(methodEl ? methodEl.value : 'cash');

    window.app?.openModal('collection-edit-modal');
  }

  closeEditModal() {
    this.editingLog = null;
    window.app?.closeModal('collection-edit-modal');
  }

  async saveCollectionEdit() {
    if (!this.editingLog) return;
    const log = this.editingLog;
    const amountInput = document.getElementById('edit-collection-amount');
    const methodInput = document.getElementById('edit-collection-method');
    const amount = Money.clampZero(amountInput?.value || '0');
    const method = methodInput?.value || 'cash';

    if (!Money.isPositive(amount)) {
      alert('Please enter a valid collection amount.');
      return;
    }

    const chequeDetails = {
      chequeDate: document.getElementById('edit-collection-cheque-date')?.value || '',
      chequeNumber: (document.getElementById('edit-collection-cheque-number')?.value || '').trim(),
      chequeBank: (document.getElementById('edit-collection-cheque-bank')?.value || '').trim()
    };

    if (method === 'cheque' && !this.validateChequeDetails(chequeDetails)) {
      return;
    }

    await window.app.withLoading(async () => {
      try {
        if (log.isOpeningBalance) {
          await window.db.updateOpeningBalanceCollectionAtomic({
            logId: log.id,
            customerId: log.customerId,
            amount,
            method,
            chequeDetails
          });
        } else {
          await window.db.updateCollectionPaymentAtomic({
            logId: log.id,
            billId: log.billId,
            amount,
            method,
            chequeDetails
          });
        }
      } catch (err) {
        alert(err?.message || 'Failed to update collection.');
        return;
      }

      this.closeEditModal();
      await this.render();
      if (window.historyView && window.app?.currentPage === 'history') await window.historyView.render();
      if (window.customersPage && window.app?.currentPage === 'customers') await window.customersPage.render();
      if (window.billing) {
        await window.billing.loadOutstandingDirectory();
        window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
      }
    }, 'Updating collection...', 'Recalculating payments');
  }

  async deleteCollection() {
    if (!this.editingLog) return;
    const log = this.editingLog;
    const formattedAmount = (Number(log.amount) || 0).toLocaleString();
    const targetDesc = log.isOpeningBalance
      ? `Opening Balance of ${log.customerName || 'Customer'}`
      : `Bill #${log.billId}`;
    if (!confirm(`Are you sure you want to delete this collection of LKR ${formattedAmount} for ${targetDesc}? The balance will be restored.`)) {
      return;
    }

    await window.app.withLoading(async () => {
      try {
        if (log.isOpeningBalance) {
          await window.db.deleteOpeningBalanceCollectionAtomic({
            logId: log.id,
            customerId: log.customerId
          });
        } else {
          await window.db.deleteCollectionPaymentAtomic({
            logId: log.id,
            billId: log.billId
          });
        }
      } catch (err) {
        alert(err?.message || 'Failed to delete collection.');
        return;
      }

      this.closeEditModal();
      await this.render();
      if (window.historyView && window.app?.currentPage === 'history') await window.historyView.render();
      if (window.customersPage && window.app?.currentPage === 'customers') await window.customersPage.render();
      if (window.billing) {
        await window.billing.loadOutstandingDirectory();
        window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
      }
    }, 'Deleting collection...', 'Restoring balance');
  }

  renderList(items) {
    const list = document.getElementById('collection-list');
    if (!list) return;

    if (!items || items.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No pending collections.</div>';
      return;
    }

    list.innerHTML = '';
    items.forEach((item) => {
      const isOpening = Boolean(item.isOpeningBalance);
      const keyId = item.keyId || String(item.id);
      const total = Money.round(item.total);
      const received = Money.round(item.receivedAmount || 0);
      const balance = typeof item.balanceAmount === 'number'
        ? Money.clampZero(item.balanceAmount)
        : (typeof item.balance === 'number' ? Money.clampZero(item.balance) : Money.clampZero(Money.subtract(total, received)));
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Customer Profile';
      const subtitle = isOpening
        ? `${this.escapeHtml(dateStr)} | Customer Opening Balance`
        : `${this.escapeHtml(dateStr)} | Bill #${this.escapeHtml(item.id)}`;

      const headerTitle = isOpening
        ? `<div style="display:flex; align-items:center; gap:8px;">
            <div style="font-weight:600;">${this.escapeHtml(item.customerName || 'Customer')}</div>
            <span style="background:#e0f2fe; color:#0369a1; font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px;">Opening Balance</span>
          </div>`
        : `<div style="font-weight:600;">${this.escapeHtml(item.customerName || 'Walk-in Customer')}</div>`;

      const statsGrid = isOpening
        ? `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:12px;">
            <div><div class="history-date">Opening Due</div><div style="font-weight:600;">LKR ${balance.toLocaleString()}</div></div>
            <div><div class="history-date">Customer Phone</div><div style="font-weight:600;">${this.escapeHtml(item.customerPhone || '-')}</div></div>
          </div>`
        : `<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-bottom:12px;">
            <div><div class="history-date">Total</div><div style="font-weight:600;">${total.toLocaleString()}</div></div>
            <div><div class="history-date">Received</div><div style="font-weight:600;">${received.toLocaleString()}</div></div>
            <div><div class="history-date">Balance</div><div style="font-weight:600;">${balance.toLocaleString()}</div></div>
          </div>`;

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          ${headerTitle}
          <div class="collection-badge">Due LKR ${balance.toLocaleString()}</div>
        </div>
        <div class="history-date" style="margin-bottom:12px;">${subtitle}</div>
        ${statsGrid}
        <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:8px; align-items:end;">
          <div class="input-group" style="margin-bottom:0;">
            <label>Collect Amount</label>
            <input type="number" id="collect-amount-${keyId}" class="input-field" placeholder="0" step="0.01">
          </div>
          <div class="input-group" style="margin-bottom:0;">
            <label>Method</label>
            <select id="collect-method-${keyId}" class="input-field">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <button class="btn-primary" style="margin:0; width:auto; padding:10px 16px;" data-collect-key="${keyId}" data-is-opening="${isOpening}" data-customer-id="${item.customerId || ''}">Collect</button>
        </div>
        <div id="collect-cheque-details-${keyId}" class="cheque-details hidden" style="margin-top:10px;">
          <div class="input-group">
            <label>Cheque Date</label>
            <input type="date" id="collect-cheque-date-${keyId}" class="input-field">
          </div>
          <div class="input-group">
            <label>Cheque Number</label>
            <input type="text" id="collect-cheque-number-${keyId}" class="input-field" placeholder="Enter cheque number">
          </div>
          <div class="input-group" style="margin-bottom:0;">
            <label>Bank</label>
            <input type="text" id="collect-cheque-bank-${keyId}" class="input-field" placeholder="Enter bank name">
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[id^="collect-method-"]').forEach((select) => {
      select.addEventListener('change', () => {
        const keyId = select.id.replace('collect-method-', '');
        this.toggleChequeDetails(keyId);
      });
    });

    list.querySelectorAll('[data-collect-key]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const keyId = btn.getAttribute('data-collect-key');
        const isOpening = btn.getAttribute('data-is-opening') === 'true';
        if (isOpening) {
          const customerId = Number(btn.getAttribute('data-customer-id'));
          await this.collectOpeningPayment(customerId, keyId);
        } else {
          const billId = Number(keyId);
          await this.collectPayment(billId);
        }
      });
    });
  }

  renderAuditTrail() {
    const trail = document.getElementById('collection-audit-list');
    const pendingCount = document.getElementById('count-pending-collections');
    const completedCount = document.getElementById('count-completed-collections');

    if (pendingCount) pendingCount.textContent = this.getDueBills().length;
    if (completedCount) completedCount.textContent = this.logs.length;

    if (!trail) return;

    const filteredLogs = this.getFilteredLogs();
    if (!filteredLogs.length) {
      trail.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-muted)">No collection records found.</div>';
      return;
    }

    trail.innerHTML = '';
    filteredLogs.slice(0, 50).forEach((log) => {
      const row = document.createElement('div');
      row.className = 'collection-log-row';
      const date = new Date(log.timestamp).toLocaleString();
      const action = log.action === 'collection_edited' ? 'Edited' : (log.action === 'opening_collection' ? 'Opening Collection' : (log.action || 'Collection'));
      const billTag = log.isOpeningBalance
        ? '<span style="background:#e0f2fe; color:#0369a1; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:600;">Opening Balance</span>'
        : `Bill #${this.escapeHtml(log.billId)}`;
      row.innerHTML = `
        <div class="collection-log-info" style="flex: 1;">
          <div class="collection-log-main">
            <strong>${this.escapeHtml(log.customerName || 'Customer')}</strong> &bull; ${billTag}
          </div>
          <div class="collection-log-sub">
            ${this.escapeHtml(date)} &bull; ${this.escapeHtml(action)} &bull; <span style="text-transform: capitalize;">${this.escapeHtml(log.method || '-')}</span> &bull; <span class="amount-highlight">LKR ${(Number(log.amount) || 0).toLocaleString()}</span>${log.method === 'cheque' && log.chequeNumber ? ` &bull; Chq #${this.escapeHtml(log.chequeNumber)}` : ''}
          </div>
        </div>
        <button type="button" class="btn-edit-collection" data-edit-log-id="${log.id}">Edit</button>
      `;
      trail.appendChild(row);
    });

    trail.querySelectorAll('[data-edit-log-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const logId = Number(btn.getAttribute('data-edit-log-id'));
        this.openEditModal(logId);
      });
    });
  }

  bind() {
    if (this.bound) return;
    const search = document.getElementById('collection-search');
    search?.addEventListener('input', () => {
      this.renderList(this.getDueBills());
      this.renderAuditTrail();
    });

    const editMethod = document.getElementById('edit-collection-method');
    editMethod?.addEventListener('change', () => {
      this.toggleEditChequeDetails(editMethod.value);
    });

    const btnSaveEdit = document.getElementById('btn-save-collection-edit');
    btnSaveEdit?.addEventListener('click', async () => {
      await this.saveCollectionEdit();
    });

    const btnDelete = document.getElementById('btn-delete-collection');
    btnDelete?.addEventListener('click', async () => {
      await this.deleteCollection();
    });

    this.bound = true;
  }

  async render() {
    const list = document.getElementById('collection-list');
    if (list) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    }
    this.bind();
    const [bills, logs, customers] = await Promise.all([
      window.db.getBills(),
      window.db.getCollectionLogs(),
      window.db.getCustomers()
    ]);
    this.bills = bills;
    this.logs = logs;
    this.customers = customers;
    this.renderList(this.getDueBills());
    this.renderAuditTrail();
    this.switchTab(this.activeTab);
  }

  init() {
    // Initialized from app.js
  }
}

window.collectionPage = new CollectionPage();



