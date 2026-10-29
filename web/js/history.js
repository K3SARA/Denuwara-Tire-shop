class HistoryView {
  constructor() {
    this.bills = [];
    this.bound = false;
    this._processing = false;
    this._displayLimit = 50;
  }

  getFilterValues() {
    const searchInput = document.getElementById('history-search');
    const fromInput = document.getElementById('history-date-from');
    const toInput = document.getElementById('history-date-to');

    return {
      query: (searchInput?.value || '').trim().toLowerCase(),
      from: fromInput?.value || '',
      to: toInput?.value || ''
    };
  }

  getBillSummary(bill) {
    const total = Money.round(bill.total);
    const received = Money.round(bill.receivedAmount || 0);
    const balance = typeof bill.balanceAmount === 'number'
      ? Money.clampZero(bill.balanceAmount)
      : Money.clampZero(Money.subtract(total, received));
    const change = Money.clampZero(bill.changeAmount || 0);
    return { total, received, balance, change };
  }

  getBillStateLabel(bill) {
    const status = bill.billStatus || 'active';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'returned') return 'Returned';
    const { balance } = this.getBillSummary(bill);
    return Money.isPositive(balance) ? 'Due' : 'Paid';
  }

  getPaymentMethodLabel(bill) {
    const method = String(bill?.paymentMethod || (bill?.markAsCredit ? 'credit' : 'cash')).toLowerCase();
    const labels = {
      cash: 'CASH',
      card: 'CARD',
      bank: 'BANK',
      cheque: 'CHEQUE',
      credit: 'CREDIT',
      multiple: 'MULTIPLE'
    };
    return labels[method] || 'PAYMENT';
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  formatCompactDate(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit'
    }).replace(/^(\d{2})\s([A-Za-z]{3})\s(\d{2})$/, '$1 $2, $3');
  }

  formatRecordAmount(value) {
    return `&#3515;&#3540; ${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  getPrintIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg>';
  }

  getShareIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c5.8-5 10.4-5.3 14-3.2V7l4 6-4 6v-4.2C13.5 12.6 8.8 13.3 4 16z"/></svg>';
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
  async collectPaymentFromHistory(billId) {
    const bill = this.bills.find((b) => Number(b.id) === Number(billId));
    if (!bill) return;
    if ((bill.billStatus || 'active') !== 'active') {
      alert('Only active bills can be collected.');
      return;
    }

    const latestBill = await window.db.getBillById(Number(billId));
    if (!latestBill) return;
    if ((latestBill.billStatus || 'active') !== 'active') {
      alert('Only active bills can be collected.');
      return;
    }

    const total = Money.round(latestBill.total);
    const received = Money.round(latestBill.receivedAmount || 0);
    const balance = Money.clampZero(Money.subtract(total, received));

    if (!Money.isPositive(balance)) {
      alert('This bill is already fully paid.');
      return;
    }

    const amountText = prompt(`Collect amount for bill #${bill.id} (max LKR ${balance.toLocaleString()}):`, String(balance));
    if (amountText === null) return;
    const amount = Money.clampZero(amountText);
    if (!Money.isPositive(amount)) {
      alert('Enter a valid collection amount.');
      return;
    }
    if (Money.isGreaterThan(amount, balance)) {
      alert(`Amount is greater than due. Maximum collectable is LKR ${balance.toLocaleString()}.`);
      return;
    }

    const methodText = prompt('Payment method (cash/card/bank/cheque):', latestBill.lastCollectionMethod || latestBill.paymentMethod || 'cash');
    if (methodText === null) return;
    const method = String(methodText || 'cash').trim().toLowerCase();
    const allowedMethods = ['cash', 'card', 'bank', 'cheque'];
    const finalMethod = allowedMethods.includes(method) ? method : 'cash';
    const chequeDetails = {
      chequeDate: '',
      chequeNumber: '',
      chequeBank: ''
    };

    if (finalMethod === 'cheque') {
      const chequeDate = prompt('Cheque date (YYYY-MM-DD):', latestBill.chequeDate || '');
      if (chequeDate === null) return;
      const chequeNumber = prompt('Cheque number:', latestBill.chequeNumber || '');
      if (chequeNumber === null) return;
      const chequeBank = prompt('Bank:', latestBill.chequeBank || '');
      if (chequeBank === null) return;

      chequeDetails.chequeDate = chequeDate.trim();
      chequeDetails.chequeNumber = chequeNumber.trim();
      chequeDetails.chequeBank = chequeBank.trim();

      if (!chequeDetails.chequeDate || !chequeDetails.chequeNumber || !chequeDetails.chequeBank) {
        alert('Please fill cheque date, cheque number, and bank.');
        return;
      }
    }

    const newPayment = this.createCollectionPayment(finalMethod, amount, chequeDetails);
    try {
      await window.db.collectBillPaymentAtomic({
        billId: latestBill.id,
        amount,
        method: finalMethod,
        chequeDetails,
        payment: newPayment,
        auditLog: {
          action: 'collection_create',
          entity: 'bill',
          details: { customerName: latestBill.customerName || 'Walk-in Customer', amount, method: finalMethod }
        }
      });
    } catch (error) {
      alert(error?.message || 'Failed to collect payment. Please refresh and try again.');
      await this.render();
      return;
    }

    await this.render();
    if (window.collectionPage && window.app.currentPage === 'collection') await window.collectionPage.render();
    if (window.customersPage && window.app.currentPage === 'customers') await window.customersPage.render();
    if (window.billing) {
      await window.billing.loadOutstandingDirectory();
      window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
    }
  }

  filterBills() {
    const { query, from, to } = this.getFilterValues();
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;

    return this.bills.filter((bill) => {
      const name = (bill.customerName || '').toLowerCase();
      const searchOk = !query || name.includes(query);
      const fromOk = fromTs === null || bill.timestamp >= fromTs;
      const toOk = toTs === null || bill.timestamp <= toTs;
      return searchOk && fromOk && toOk;
    });
  }

  async editBill(billId) {
    const bill = this.bills.find((b) => Number(b.id) === Number(billId));
    if (!bill) return;
    if ((bill.billStatus || 'active') !== 'active') {
      alert('Only active bills can be edited.');
      return;
    }
    window.billing.setEditMode(bill);
  }

  async cancelOrReturnBill(billId, action) {
    if (this._processing) return;
    this._processing = true;
    try {
    const bill = await window.db.getBillById(Number(billId));
    if (!bill) return;

    if ((bill.billStatus || 'active') !== 'active') {
      alert('This bill is already closed.');
      return;
    }

    const verb = action === 'return' ? 'return' : 'cancel';
    const confirmed = confirm(`Are you sure you want to ${verb} bill #${bill.id}? Stock will be adjusted automatically.`);
    if (!confirmed) return;

    const received = Money.round(bill.receivedAmount || 0);
    const updated = await window.db.cancelBillAndReturnStock({
      billId: bill.id,
      updates: {
        billStatus: action === 'return' ? 'returned' : 'cancelled',
        paymentStatus: action === 'return' ? 'returned' : 'cancelled',
        balanceAmount: 0,
        receivedAmount: 0,
        changeAmount: 0,
        closedAt: new Date().getTime()
      },
      itemsToReturn: bill.items || []
    });

    if (Money.isPositive(received)) {
      await window.db.addCollectionLog({
        billId: bill.id,
        customerName: bill.customerName || 'Walk-in Customer',
        amount: received,
        method: bill.paymentMethod || 'cash',
        action: action === 'return' ? 'bill_return' : 'bill_cancel',
        direction: 'refund_pending',
        beforeReceived: received,
        afterReceived: 0
      });
    }

    if (updated) {
      window.share.currentBill = updated;
    }
    await window.db.addAuditLog({
      action: action === 'return' ? 'bill_return' : 'bill_cancel',
      entity: 'bill',
      entityId: bill.id,
      details: { customerName: bill.customerName || '', total: bill.total || 0 }
    });

    await this.render();
    if (window.inventory) await window.inventory.render();
    if (window.collectionPage && window.app.currentPage === 'collection') await window.collectionPage.render();
    if (window.customersPage && window.app.currentPage === 'customers') await window.customersPage.render();
    if (window.billing) {
      await window.billing.loadOutstandingDirectory();
      window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
    }
    } finally {
      this._processing = false;
    }
  }

  async deleteBill(billId) {
    if (this._processing) return;
    this._processing = true;
    try {
    const bill = await window.db.getBillById(Number(billId));
    if (!bill) return;

    const confirmed = confirm(`Delete bill #${bill.id}? This permanently removes the bill and its collection records.`);
    if (!confirmed) return;

    const shouldReturnStock = confirm('Return stock to inventory?');
    if (shouldReturnStock === null) return; // User cancelled

    // Write the audit log BEFORE deleting so the action is always recorded
    // even if the app closes immediately after the delete completes.
    await window.db.addAuditLog({
      action: 'bill_delete',
      entity: 'bill',
      entityId: bill.id,
      details: { customerName: bill.customerName || '', total: bill.total || 0, returnStock: shouldReturnStock }
    });

    const deleted = await window.db.deleteBillAndReturnStock({
      billId: bill.id,
      returnStock: Boolean(shouldReturnStock)
    });
    if (!deleted) {
      alert('Failed to delete bill.');
      return;
    }

    if (window.share.currentBill && Number(window.share.currentBill.id) === Number(bill.id)) {
      window.share.currentBill = null;
    }

    await this.render();
    if (window.inventory) await window.inventory.render();
    if (window.collectionPage && window.app.currentPage === 'collection') await window.collectionPage.render();
    if (window.customersPage && window.app.currentPage === 'customers') await window.customersPage.render();
    if (window.reportsView && window.app.currentPage === 'reports') await window.reportsView.render();
    if (window.billing) {
      await window.billing.loadOutstandingDirectory();
      window.billing.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
    }
    } finally {
      this._processing = false;
    }
  }

  renderBillsList(bills) {
    const container = document.getElementById('history-list');
    if (!container) return;

    if (this.bills.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No bills found.</div>';
      return;
    }

    if (bills.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No bills match the selected filters.</div>';
      return;
    }

    const displayBills = bills.slice(0, this._displayLimit);
    container.innerHTML = '';
    displayBills.forEach((bill) => {
      const el = document.createElement('div');
      el.className = 'history-sale-card';

      const dateStr = this.formatCompactDate(bill.timestamp);
      const { total, balance } = this.getBillSummary(bill);
      const billStatus = bill.billStatus || 'active';

      let statusLabel = this.getPaymentMethodLabel(bill);
      let statusClass = 'sale';
      if (billStatus === 'returned') {
        statusLabel = 'RETURNED';
        statusClass = 'returned';
      } else if (billStatus === 'cancelled') {
        statusLabel = 'CANCELLED';
        statusClass = 'cancelled';
      }

      el.innerHTML = `
        <div class="history-sale-top">
          <div class="history-customer-wrap">
            <div class="history-customer">${this.escapeHtml(bill.customerName || 'Walk-in Customer')}</div>
            <span class="history-sale-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="history-sale-id">#${this.escapeHtml(bill.id || '')}</div>
        </div>
        <div class="history-sale-date">${dateStr}</div>
        <div class="history-sale-content">
          <div class="history-sale-metrics">
            <div class="history-sale-metric">
              <div class="history-sale-label">Total</div>
              <div class="history-sale-value">${this.formatRecordAmount(total)}</div>
            </div>
            <div class="history-sale-metric">
              <div class="history-sale-label">Balance</div>
              <div class="history-sale-value">${this.formatRecordAmount(balance)}</div>
            </div>
          </div>
          <div class="history-sale-actions">
            <button class="history-icon-btn" data-history-action="print" data-bill-id="${bill.id}" title="Print">${this.getPrintIcon()}</button>
            <button class="history-icon-btn" data-history-action="share" data-bill-id="${bill.id}" title="Share">${this.getShareIcon()}</button>
            <button class="history-pdf-btn" data-history-action="pdf" data-bill-id="${bill.id}">Pdf</button>
            <button class="history-delete-btn" data-history-action="delete" data-bill-id="${bill.id}" title="Delete bill">Del</button>
            <button class="history-menu-btn" data-history-action="edit" data-bill-id="${bill.id}" title="Edit bill" ${(billStatus !== 'active') ? 'disabled' : ''}>
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
      `;

      container.appendChild(el);
    });

    container.querySelectorAll('[data-history-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const billId = Number(btn.getAttribute('data-bill-id'));
        const action = btn.getAttribute('data-history-action');
        const bill = this.bills.find((b) => Number(b.id) === billId);
        if (!bill) return;

        if (action === 'print' || action === 'pdf') {
          window.share.currentBill = bill;
          window.share.printReceipt();
          return;
        }
        if (action === 'share') {
          window.share.currentBill = bill;
          window.app.openModal('share-modal');
          return;
        }
        if (action === 'edit') {
          await this.editBill(billId);
          return;
        }
        if (action === 'delete') {
          await this.deleteBill(billId);
        }
      });
    });

    if (bills.length > this._displayLimit) {
      const loadMore = document.createElement('button');
      loadMore.className = 'btn-tool';
      loadMore.style.cssText = 'display:block; width:calc(100% - 40px); margin:16px 20px; padding:12px; text-align:center;';
      loadMore.textContent = `Load More (${bills.length - this._displayLimit} remaining)`;
      loadMore.addEventListener('click', () => {
        this._displayLimit += 50;
        this.applyFiltersAndRender();
      });
      container.appendChild(loadMore);
    }
  }

  applyFiltersAndRender() {
    const filtered = this.filterBills();
    this.renderBillsList(filtered);
  }

  async exportBackup() {
    await window.app.exportBackup('history');
  }

  summarizeBackup(payload) {
    const data = payload?.data || {};
    return [
      `Bills: ${(data.bills || []).length}`,
      `Products: ${(data.products || []).length}`,
      `Customers: ${(data.customers || []).length}`,
      `Collections: ${(data.collectionLogs || []).length}`,
      `Expenses: ${(data.expenses || []).length}`,
      `Inventory Logs: ${(data.inventoryLogs || []).length}`,
      `Audit Logs: ${(data.auditLogs || []).length}`
    ].join('\n');
  }

  getBackupCounts(payload) {
    const data = payload?.data || {};
    return {
      bills: (data.bills || []).length,
      products: (data.products || []).length,
      customers: (data.customers || []).length,
      collections: (data.collectionLogs || []).length,
      expenses: (data.expenses || []).length,
      inventoryLogs: (data.inventoryLogs || []).length,
      auditLogs: (data.auditLogs || []).length
    };
  }

  buildImportPreview(currentPayload, incomingPayload, fileName) {
    const current = this.getBackupCounts(currentPayload);
    const incoming = this.getBackupCounts(incomingPayload);
    const lines = [
      `File: ${fileName || 'backup.json'}`,
      `Exported: ${incomingPayload.exportedAt || '-'}`,
      '',
      'Current -> Import',
      `Bills: ${current.bills} -> ${incoming.bills}`,
      `Products: ${current.products} -> ${incoming.products}`,
      `Customers: ${current.customers} -> ${incoming.customers}`,
      `Collections: ${current.collections} -> ${incoming.collections}`,
      `Expenses: ${current.expenses} -> ${incoming.expenses}`,
      `Inventory Logs: ${current.inventoryLogs} -> ${incoming.inventoryLogs}`,
      `Audit Logs: ${current.auditLogs} -> ${incoming.auditLogs}`,
      '',
      'Import will replace current app data.'
    ];
    return lines.join('\n');
  }

  async importBackup(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !payload.data || typeof payload.data !== 'object') {
        alert('Invalid backup file structure.');
        return;
      }
      window.db.validateBackupPayload(payload);
      const currentPayload = await window.db.exportAllData();
      const preview = this.buildImportPreview(currentPayload, payload, file.name);
      const previewConfirmed = confirm(`Import Preview\n\n${preview}\n\nContinue to pre-import backup?`);
      if (!previewConfirmed) return;

      const exported = await window.app.exportBackup('before_import');
      if (!exported) return;

      const backupConfirmed = confirm('A pre-import backup download has started. Confirm only after the backup file is saved. Continue with import now?');
      if (!backupConfirmed) return;

      await window.db.saveImportRollback(currentPayload);
      await window.db.importAllData(payload);
      await window.db.addAuditLog({
        action: 'backup_import',
        entity: 'backup',
        details: { fileName: file.name || 'backup.json' }
      });

      if (window.billing) {
        await window.billing.refreshProducts();
        await window.billing.loadCustomerDirectory();
        await window.billing.loadOutstandingDirectory();
        window.billing.renderItems();
      }
      if (window.inventory) await window.inventory.render();
      if (window.customersPage) await window.customersPage.render();
      if (window.collectionPage) await window.collectionPage.render();
      if (window.expensesPage) await window.expensesPage.render();
      if (window.reportsView && window.app.currentPage === 'reports') await window.reportsView.render();
      await this.render();

      alert('Backup imported successfully.');
    } catch (err) {
      alert(err?.message || 'Invalid backup file.');
      console.error(err);
    } finally {
      const input = document.getElementById('backup-import-file');
      if (input) input.value = '';
    }
  }

  async rollbackLastImport() {
    const snapshots = await window.db.getImportRollbacks();
    if (!snapshots.length) {
      alert('No rollback backup found.');
      return;
    }

    let selected = snapshots[0];
    if (snapshots.length > 1) {
      const options = snapshots.map((snapshot, index) => {
        const label = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString() : 'Unknown time';
        const counts = this.getBackupCounts(snapshot.payload);
        return `${index + 1}. ${label} - Bills: ${counts.bills}, Products: ${counts.products}`;
      }).join('\n');
      const choice = prompt(`Choose rollback snapshot:\n\n${options}`, '1');
      if (choice === null) return;
      const index = Number(choice) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= snapshots.length) {
        alert('Invalid rollback selection.');
        return;
      }
      selected = snapshots[index];
    }

    const payload = selected.payload;
    const confirmed = confirm(`Rollback to selected pre-import data?\n\n${this.summarizeBackup(payload)}`);
    if (!confirmed) return;

    try {
      await window.db.importAllData(payload);
      await window.db.addAuditLog({
        action: 'backup_rollback',
        entity: 'backup',
        details: {}
      });
      await window.db.clearImportRollback();

      if (window.billing) {
        await window.billing.refreshProducts();
        await window.billing.loadCustomerDirectory();
        await window.billing.loadOutstandingDirectory();
        window.billing.renderItems();
      }
      if (window.inventory) await window.inventory.render();
      if (window.customersPage) await window.customersPage.render();
      if (window.collectionPage) await window.collectionPage.render();
      if (window.expensesPage) await window.expensesPage.render();
      if (window.reportsView && window.app.currentPage === 'reports') await window.reportsView.render();
      await this.render();
      alert('Rollback completed.');
    } catch (err) {
      alert('Rollback failed.');
      console.error(err);
    }
  }

  bindFilters() {
    if (this.bound) return;

    const searchInput = document.getElementById('history-search');
    const fromInput = document.getElementById('history-date-from');
    const toInput = document.getElementById('history-date-to');
    const exportBtn = document.getElementById('btn-export-backup');
    const importBtn = document.getElementById('btn-import-backup');
    const rollbackBtn = document.getElementById('btn-rollback-import');
    const importInput = document.getElementById('backup-import-file');

    const onFilterChange = () => { this._displayLimit = 50; this.applyFiltersAndRender(); };
    searchInput?.addEventListener('input', onFilterChange);
    fromInput?.addEventListener('change', onFilterChange);
    toInput?.addEventListener('change', onFilterChange);

    exportBtn?.addEventListener('click', () => this.exportBackup());
    importBtn?.addEventListener('click', () => importInput?.click());
    rollbackBtn?.addEventListener('click', () => this.rollbackLastImport());
    importInput?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      await this.importBackup(file);
    });

    this.bound = true;
  }

  async render() {
    const container = document.getElementById('history-list');
    this.bindFilters();

    if (container) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    }

    this._displayLimit = 50;
    this.bills = await window.db.getBills();
    this.applyFiltersAndRender();
  }

  init() {
    // Initialized from app.js
  }
}

window.historyView = new HistoryView();

