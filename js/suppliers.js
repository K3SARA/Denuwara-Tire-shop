class SuppliersPage {
  constructor() {
    this.suppliers = [];
    this.purchases = [];
    this.payments = [];
    this.filter = 'all';
    this.sortBy = 'due_desc';
    this.searchQuery = '';
    this.currentProfileSupplierId = null;
    this.currentProfilePurchases = [];
    this.currentProfilePayments = [];
    this.purchaseRowCounter = 0;
    this.productsCache = [];
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatAmount(val) {
    return (Number(val) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  init() {
    const searchInput = document.getElementById('suppliers-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target.value || '').trim().toLowerCase();
        this.renderList(this.getFilteredSuppliers());
      });
    }

    const filterPills = document.getElementById('supplier-filter-pills');
    if (filterPills) {
      filterPills.addEventListener('click', (e) => {
        const btn = e.target.closest('.cust-filter-pill');
        if (!btn) return;
        filterPills.querySelectorAll('.cust-filter-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.getAttribute('data-supp-filter') || 'all';
        this.renderList(this.getFilteredSuppliers());
      });
    }

    const sortSelect = document.getElementById('suppliers-sort-select');
    if (sortSelect) {
      const updateSortTitle = () => {
        const text = sortSelect.options[sortSelect.selectedIndex]?.text || '';
        const wrap = sortSelect.closest('.supp-sort-btn-wrap');
        if (wrap) wrap.title = `Sort: ${text}`;
      };
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value || 'due_desc';
        updateSortTitle();
        this.renderList(this.getFilteredSuppliers());
      });
      updateSortTitle();
    }
  }

  async render() {
    if (!window.db) return;
    try {
      const [suppliers, purchases, payments, products] = await Promise.all([
        window.db.getSuppliers(),
        window.db.getPurchases(),
        window.db.getSupplierPayments(),
        window.db.getProducts(true)
      ]);
      this.suppliers = suppliers || [];
      this.purchases = purchases || [];
      this.payments = payments || [];
      this.productsCache = products || [];

      this.updateMetrics();
      this.updateFilterBadges();
      this.renderList(this.getFilteredSuppliers());
    } catch (err) {
      console.error('Failed to render suppliers:', err);
    }
  }

  computeSupplierBalance(supplier) {
    const opening = Money.round(supplier.openingBalance || 0);
    const suppPurchases = this.purchases.filter((p) => Number(p.supplierId) === Number(supplier.id));
    const suppPayments = this.payments.filter((p) => Number(p.supplierId) === Number(supplier.id));

    // Total inward stock value
    const totalPurchased = suppPurchases.reduce((sum, p) => Money.add(sum, p.totalAmount || 0), 0);
    // Initial payments recorded on purchase bills
    const purchasePaid = suppPurchases.reduce((sum, p) => Money.add(sum, p.paidAmount || 0), 0);
    // Additional payments recorded separately
    const standalonePaid = suppPayments.reduce((sum, p) => Money.add(sum, p.amount || 0), 0);

    const totalPaid = Money.add(purchasePaid, standalonePaid);
    const totalPayable = Money.add(opening, totalPurchased);
    const balance = Money.subtract(totalPayable, totalPaid);

    return {
      opening,
      totalPurchased,
      totalPaid,
      balance,
      purchasesCount: suppPurchases.length,
      paymentsCount: suppPayments.length
    };
  }

  updateMetrics() {
    const totalCountEl = document.getElementById('supp-metric-count');
    const totalDueEl = document.getElementById('supp-metric-due');
    const totalPurchasesEl = document.getElementById('supp-metric-purchases');

    let totalDueSum = 0;
    let dueCount = 0;

    this.suppliers.forEach((s) => {
      const info = this.computeSupplierBalance(s);
      if (Money.isPositive(info.balance)) {
        totalDueSum = Money.add(totalDueSum, info.balance);
        dueCount += 1;
      }
    });

    const allPurchasesTotal = this.purchases.reduce((sum, p) => Money.add(sum, p.totalAmount || 0), 0);

    if (totalCountEl) totalCountEl.textContent = this.suppliers.length;
    if (totalDueEl) totalDueEl.textContent = `LKR ${this.formatAmount(totalDueSum)}`;
    if (totalPurchasesEl) totalPurchasesEl.textContent = `LKR ${this.formatAmount(allPurchasesTotal)}`;
  }

  updateFilterBadges() {
    let dueCount = 0;
    let paidCount = 0;

    this.suppliers.forEach((s) => {
      const info = this.computeSupplierBalance(s);
      if (Money.isPositive(info.balance)) {
        dueCount += 1;
      } else {
        paidCount += 1;
      }
    });

    const allBadge = document.getElementById('supp-pill-all');
    const dueBadge = document.getElementById('supp-pill-due');
    const paidBadge = document.getElementById('supp-pill-paid');

    if (allBadge) allBadge.textContent = this.suppliers.length;
    if (dueBadge) dueBadge.textContent = dueCount;
    if (paidBadge) paidBadge.textContent = paidCount;
  }

  getFilteredSuppliers() {
    let list = [...this.suppliers];

    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const phone = (s.phone || '').toLowerCase();
        const contact = (s.contactPerson || '').toLowerCase();
        const address = (s.address || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || contact.includes(q) || address.includes(q);
      });
    }

    if (this.filter === 'due') {
      list = list.filter((s) => {
        const info = this.computeSupplierBalance(s);
        return Money.isPositive(info.balance);
      });
    } else if (this.filter === 'paid') {
      list = list.filter((s) => {
        const info = this.computeSupplierBalance(s);
        return !Money.isPositive(info.balance);
      });
    }

    list.sort((a, b) => {
      if (this.sortBy === 'due_desc') {
        const balA = this.computeSupplierBalance(a).balance;
        const balB = this.computeSupplierBalance(b).balance;
        return balB - balA;
      }
      if (this.sortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '');
      }
      return (b.created_at || 0) - (a.created_at || 0);
    });

    return list;
  }

  renderList(suppliers) {
    const container = document.getElementById('suppliers-list');
    if (!container) return;

    if (!suppliers.length) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🚚</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-main);">No suppliers found</div>
          <div style="font-size: 0.85rem; margin-top: 4px;">Tap "+ Add Supplier" or "+ Record Stock-In" to register suppliers.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = suppliers.map((s) => {
      const info = this.computeSupplierBalance(s);
      const isDue = Money.isPositive(info.balance);
      const isAdvance = info.balance < 0;

      let badgeHtml = '';
      if (isDue) {
        badgeHtml = `<span class="customers-due" style="font-weight: 800; font-size: 0.85rem;">Due LKR ${this.formatAmount(info.balance)}</span>`;
      } else if (isAdvance) {
        badgeHtml = `<span class="customers-advance" style="font-weight: 800; font-size: 0.85rem;">Advance LKR ${this.formatAmount(Math.abs(info.balance))}</span>`;
      } else {
        badgeHtml = `<span class="customers-paid" style="font-weight: 800; font-size: 0.85rem;">Clear / Paid &#10003;</span>`;
      }

      const metaParts = [];
      if (s.contactPerson) metaParts.push(this.escapeHtml(s.contactPerson));
      if (s.address) metaParts.push(this.escapeHtml(s.address));
      const metaText = metaParts.join(' &bull; ') || 'No address provided';

      return `
        <div class="card" style="margin-bottom: 12px; border-radius: 14px; padding: 14px 16px; transition: transform 0.15s ease, box-shadow 0.15s ease;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <div style="flex: 1; min-width: 0;" onclick="suppliersPage.openProfileModal(${s.id})" role="button" tabindex="0">
              <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;">
                ${this.escapeHtml(s.name)}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                ${metaText}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              ${badgeHtml}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid var(--border-color, rgba(0,0,0,0.06)); margin-top: 6px; font-size: 0.8rem; color: var(--text-muted);">
            <div>
              ${s.phone ? `<a href="tel:${this.escapeHtml(s.phone)}" style="color: var(--accent-color, #059669); font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">📞 ${this.escapeHtml(s.phone)}</a>` : '<span>No phone</span>'}
            </div>
            <div>
              <span>Purchases: <strong>LKR ${this.formatAmount(info.totalPurchased)}</strong> (${info.purchasesCount})</span>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            ${isDue ? `
              <button type="button" class="btn-primary" style="flex: 1; padding: 7px 12px; font-size: 0.82rem; font-weight: 700; border-radius: 8px;" onclick="suppliersPage.openPaymentModal(${s.id})">
                💳 Pay Due
              </button>
            ` : ''}
            <button type="button" class="btn-tool" style="flex: 1; padding: 7px 12px; font-size: 0.82rem; font-weight: 700; border-radius: 8px;" onclick="suppliersPage.openPurchaseModal(${s.id})">
              📦 + Stock-In
            </button>
            <button type="button" class="btn-tool" style="padding: 7px 14px; font-size: 0.82rem; font-weight: 700; border-radius: 8px;" onclick="suppliersPage.openProfileModal(${s.id})" title="View Ledger">
              Profile &rarr;
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // =================== ADD / EDIT SUPPLIER ===================
  openSupplierModal(supplierId = null) {
    const titleEl = document.getElementById('supplier-modal-title');
    const idInput = document.getElementById('supplier-modal-id');
    const nameInput = document.getElementById('supplier-modal-name');
    const phoneInput = document.getElementById('supplier-modal-phone');
    const contactInput = document.getElementById('supplier-modal-contact');
    const addressInput = document.getElementById('supplier-modal-address');
    const bankInput = document.getElementById('supplier-modal-bank');
    const openingInput = document.getElementById('supplier-modal-opening');
    const openingWrap = document.getElementById('supplier-modal-opening-wrap');

    if (supplierId) {
      const s = this.suppliers.find((item) => Number(item.id) === Number(supplierId));
      if (!s) return;
      if (titleEl) titleEl.textContent = 'Edit Supplier';
      if (idInput) idInput.value = s.id;
      if (nameInput) nameInput.value = s.name || '';
      if (phoneInput) phoneInput.value = s.phone || '';
      if (contactInput) contactInput.value = s.contactPerson || '';
      if (addressInput) addressInput.value = s.address || '';
      if (bankInput) bankInput.value = s.bankDetails || '';
      if (openingInput) openingInput.value = s.openingBalance || '';
      if (openingWrap) openingWrap.style.display = 'none'; // Don't allow editing opening after creation
    } else {
      if (titleEl) titleEl.textContent = 'Add New Supplier';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (phoneInput) phoneInput.value = '';
      if (contactInput) contactInput.value = '';
      if (addressInput) addressInput.value = '';
      if (bankInput) bankInput.value = '';
      if (openingInput) openingInput.value = '';
      if (openingWrap) openingWrap.style.display = 'block';
    }

    window.app?.openModal('supplier-modal');
  }

  async saveSupplier() {
    const idInput = document.getElementById('supplier-modal-id');
    const nameInput = document.getElementById('supplier-modal-name');
    const phoneInput = document.getElementById('supplier-modal-phone');
    const contactInput = document.getElementById('supplier-modal-contact');
    const addressInput = document.getElementById('supplier-modal-address');
    const bankInput = document.getElementById('supplier-modal-bank');
    const openingInput = document.getElementById('supplier-modal-opening');

    const name = (nameInput?.value || '').trim();
    if (!name) {
      alert('Please enter a supplier or company name.');
      nameInput?.focus();
      return;
    }

    const id = idInput?.value ? Number(idInput.value) : null;
    const phone = (phoneInput?.value || '').trim();
    const contact = (contactInput?.value || '').trim();
    const address = (addressInput?.value || '').trim();
    const bank = (bankInput?.value || '').trim();
    const opening = parseFloat(openingInput?.value || '0') || 0;

    await window.app?.withLoading(async () => {
      if (id) {
        await window.db.updateSupplier(id, {
          name,
          phone,
          contactPerson: contact,
          address,
          bankDetails: bank
        });
      } else {
        const res = await window.db.addSupplier(name, phone, address, contact, bank, opening);
        if (!res.ok) {
          alert(res.error || 'Failed to add supplier.');
          return;
        }
      }
      window.app?.closeModal('supplier-modal');
      await this.render();
      if (this.currentProfileSupplierId === id) {
        await this.openProfileModal(id);
      }
    }, 'Saving supplier...', 'Updating directory');
  }

  // =================== RECORD PURCHASE / STOCK IN ===================
  openPurchaseModal(preselectedSupplierId = null) {
    const select = document.getElementById('purchase-supplier-select');
    if (select) {
      select.innerHTML = '<option value="">Select Supplier...</option>' + this.suppliers.map((s) => `
        <option value="${s.id}" ${Number(preselectedSupplierId) === Number(s.id) ? 'selected' : ''}>${this.escapeHtml(s.name)}</option>
      `).join('');
    }

    const dateInput = document.getElementById('purchase-date');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

    const invNoInput = document.getElementById('purchase-invoice-no');
    if (invNoInput) invNoInput.value = '';

    const paidInput = document.getElementById('purchase-paid-amount');
    if (paidInput) paidInput.value = '';

    const notesInput = document.getElementById('purchase-notes');
    if (notesInput) notesInput.value = '';

    const itemsContainer = document.getElementById('purchase-items-list');
    if (itemsContainer) itemsContainer.innerHTML = '';
    this.purchaseRowCounter = 0;

    // Start with 1 empty item row
    this.addPurchaseItemRow();

    this.updatePurchaseTotals();
    window.app?.openModal('purchase-modal');
  }

  addPurchaseItemRow(initial = {}) {
    const container = document.getElementById('purchase-items-list');
    if (!container) return;

    this.purchaseRowCounter += 1;
    const rowId = `pur-item-row-${this.purchaseRowCounter}`;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'purchase-item-row';
    row.style.cssText = 'background: var(--bg-surface, #f9fafb); border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 10px; display: grid; grid-template-columns: 2fr 1fr 1.2fr auto; gap: 8px; align-items: end;';

    row.innerHTML = `
      <div style="position: relative;">
        <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;">Product</label>
        <input type="text" class="input-field pur-item-name" placeholder="Type or select product..." value="${this.escapeHtml(initial.name || '')}" style="font-size: 0.85rem;" autocomplete="off" />
        <div class="pur-product-dropdown customer-dropdown" style="display: none; position: absolute; left: 0; right: 0; z-index: 100; max-height: 180px; overflow-y: auto;"></div>
      </div>
      <div>
        <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;">Qty</label>
        <input type="number" class="input-field pur-item-qty" placeholder="1" value="${initial.qty || '1'}" min="1" step="1" style="font-size: 0.85rem;" oninput="suppliersPage.updatePurchaseTotals()" />
      </div>
      <div>
        <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;">Cost Rate (LKR)</label>
        <input type="number" class="input-field pur-item-cost" placeholder="0.00" value="${initial.cost || ''}" step="0.01" style="font-size: 0.85rem;" oninput="suppliersPage.updatePurchaseTotals()" />
      </div>
      <div>
        <button type="button" class="btn-tool" onclick="suppliersPage.removePurchaseItemRow('${rowId}')" title="Remove Item" style="color: #ef4444; padding: 7px 10px; height: 38px;">&times;</button>
      </div>
    `;

    container.appendChild(row);

    // Bind product autocomplete on the row
    const nameInput = row.querySelector('.pur-item-name');
    const dropdown = row.querySelector('.pur-product-dropdown');
    const costInput = row.querySelector('.pur-item-cost');

    if (nameInput && dropdown) {
      nameInput.addEventListener('input', () => {
        const val = nameInput.value.trim().toLowerCase();
        if (!val) {
          dropdown.style.display = 'none';
          return;
        }
        const matches = this.productsCache.filter((p) => (p.name || '').toLowerCase().includes(val)).slice(0, 6);
        if (!matches.length) {
          dropdown.style.display = 'none';
          return;
        }
        dropdown.innerHTML = matches.map((p) => `
          <div class="customer-dropdown-item" style="padding: 6px 10px; cursor: pointer; border-bottom: 1px solid var(--border-color, #eee);" data-name="${this.escapeHtml(p.name)}" data-cost="${p.invoicePrice || 0}">
            <div style="font-weight: 600; font-size: 0.85rem;">${this.escapeHtml(p.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Stock: ${p.stock || 0} &bull; Last Cost: LKR ${this.formatAmount(p.invoicePrice || 0)}</div>
          </div>
        `).join('');
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.customer-dropdown-item').forEach((item) => {
          item.addEventListener('click', () => {
            nameInput.value = item.getAttribute('data-name');
            const c = Number(item.getAttribute('data-cost')) || 0;
            if (c > 0 && costInput && !costInput.value) {
              costInput.value = c;
            }
            dropdown.style.display = 'none';
            this.updatePurchaseTotals();
          });
        });
      });

      document.addEventListener('click', (e) => {
        if (!row.contains(e.target)) dropdown.style.display = 'none';
      });
    }
  }

  removePurchaseItemRow(rowId) {
    const el = document.getElementById(rowId);
    if (el) el.remove();
    this.updatePurchaseTotals();
  }

  updatePurchaseTotals() {
    const rows = document.querySelectorAll('.purchase-item-row');
    let total = 0;

    rows.forEach((row) => {
      const qty = parseFloat(row.querySelector('.pur-item-qty')?.value || '0') || 0;
      const cost = parseFloat(row.querySelector('.pur-item-cost')?.value || '0') || 0;
      total = Money.add(total, Money.multiply(cost, qty));
    });

    const totalEl = document.getElementById('purchase-total-display');
    if (totalEl) totalEl.textContent = `LKR ${this.formatAmount(total)}`;

    this.updatePurchaseBalance();
  }

  updatePurchaseBalance() {
    const rows = document.querySelectorAll('.purchase-item-row');
    let total = 0;
    rows.forEach((row) => {
      const qty = parseFloat(row.querySelector('.pur-item-qty')?.value || '0') || 0;
      const cost = parseFloat(row.querySelector('.pur-item-cost')?.value || '0') || 0;
      total = Money.add(total, Money.multiply(cost, qty));
    });

    const paidInput = document.getElementById('purchase-paid-amount');
    const paid = parseFloat(paidInput?.value || '0') || 0;
    const due = Money.clampZero(Money.subtract(total, paid));

    const dueEl = document.getElementById('purchase-due-display');
    if (dueEl) {
      dueEl.textContent = `LKR ${this.formatAmount(due)}`;
      dueEl.style.color = due > 0 ? '#dc2626' : '#059669';
    }
  }

  async savePurchase() {
    const supplierSelect = document.getElementById('purchase-supplier-select');
    const supplierId = supplierSelect ? Number(supplierSelect.value) : 0;
    if (!supplierId) {
      alert('Please select a supplier.');
      supplierSelect?.focus();
      return;
    }

    const supplier = this.suppliers.find((s) => Number(s.id) === supplierId);
    const supplierName = supplier ? supplier.name : 'Supplier';

    const dateInput = document.getElementById('purchase-date');
    const date = dateInput?.value || new Date().toISOString().slice(0, 10);
    const invoiceNo = (document.getElementById('purchase-invoice-no')?.value || '').trim();
    const autoUpdateStock = document.getElementById('purchase-auto-stock')?.checked !== false;
    const paymentMethod = document.getElementById('purchase-payment-method')?.value || 'cash';
    const notes = (document.getElementById('purchase-notes')?.value || '').trim();

    const rows = document.querySelectorAll('.purchase-item-row');
    const items = [];
    let total = 0;

    rows.forEach((row) => {
      const name = (row.querySelector('.pur-item-name')?.value || '').trim();
      const qty = parseFloat(row.querySelector('.pur-item-qty')?.value || '0') || 0;
      const cost = parseFloat(row.querySelector('.pur-item-cost')?.value || '0') || 0;

      if (name && qty > 0) {
        items.push({ name, qty, cost, total: Money.multiply(cost, qty) });
        total = Money.add(total, Money.multiply(cost, qty));
      }
    });

    if (!items.length) {
      alert('Please add at least one supplied item with quantity.');
      return;
    }

    const paidInput = document.getElementById('purchase-paid-amount');
    const paidAmount = parseFloat(paidInput?.value || '0') || 0;
    const balanceAmount = Money.clampZero(Money.subtract(total, paidAmount));

    await window.app?.withLoading(async () => {
      await window.db.addPurchase({
        invoiceNumber: invoiceNo,
        supplierId,
        supplierName,
        date,
        items,
        totalAmount: total,
        paidAmount,
        balanceAmount,
        paymentMethod,
        autoUpdateStock,
        notes
      });

      window.app?.closeModal('purchase-modal');
      await this.render();
      if (this.currentProfileSupplierId === supplierId) {
        await this.openProfileModal(supplierId);
      }
    }, 'Saving purchase...', 'Updating stock and dues');
  }

  // =================== PAY SUPPLIER DUE ===================
  openPaymentModal(supplierId) {
    const s = this.suppliers.find((item) => Number(item.id) === Number(supplierId));
    if (!s) return;

    const idInput = document.getElementById('supp-pay-supplier-id');
    const nameEl = document.getElementById('supp-pay-supplier-name');
    const dueBadge = document.getElementById('supp-pay-due-badge');
    const bankHint = document.getElementById('supp-pay-bank-hint');
    const amountInput = document.getElementById('supp-pay-amount');
    const dateInput = document.getElementById('supp-pay-date');
    const refInput = document.getElementById('supp-pay-reference');

    const info = this.computeSupplierBalance(s);
    const dueAmount = Math.max(0, info.balance);

    if (idInput) idInput.value = s.id;
    if (nameEl) nameEl.textContent = s.name;
    if (dueBadge) {
      dueBadge.textContent = `Due LKR ${this.formatAmount(dueAmount)}`;
      dueBadge.style.color = dueAmount > 0 ? '#dc2626' : '#059669';
    }

    if (bankHint) {
      if (s.bankDetails) {
        bankHint.innerHTML = `<strong>Bank Info:</strong> ${this.escapeHtml(s.bankDetails)}`;
        bankHint.style.display = 'block';
      } else {
        bankHint.style.display = 'none';
      }
    }

    if (amountInput) amountInput.value = dueAmount > 0 ? dueAmount : '';
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    if (refInput) refInput.value = '';

    const methodSelect = document.getElementById('supp-pay-method');
    if (methodSelect) methodSelect.value = 'bank';
    this.toggleChequeFields();

    window.app?.openModal('supplier-payment-modal');
  }

  fillFullSupplierDue() {
    const idInput = document.getElementById('supp-pay-supplier-id');
    const s = this.suppliers.find((item) => Number(item.id) === Number(idInput?.value));
    if (!s) return;
    const info = this.computeSupplierBalance(s);
    const amountInput = document.getElementById('supp-pay-amount');
    if (amountInput) amountInput.value = Math.max(0, info.balance);
  }

  toggleChequeFields() {
    const methodSelect = document.getElementById('supp-pay-method');
    const chequeGroup = document.getElementById('supp-pay-cheque-group');
    if (chequeGroup) {
      chequeGroup.style.display = methodSelect?.value === 'cheque' ? 'block' : 'none';
    }
  }

  async savePayment() {
    const idInput = document.getElementById('supp-pay-supplier-id');
    const supplierId = idInput ? Number(idInput.value) : 0;
    if (!supplierId) return;

    const amountInput = document.getElementById('supp-pay-amount');
    const amount = parseFloat(amountInput?.value || '0') || 0;
    if (amount <= 0) {
      alert('Please enter a valid payment amount.');
      amountInput?.focus();
      return;
    }

    const methodSelect = document.getElementById('supp-pay-method');
    const method = methodSelect?.value || 'cash';
    const dateInput = document.getElementById('supp-pay-date');
    const date = dateInput?.value || new Date().toISOString().slice(0, 10);
    const refInput = document.getElementById('supp-pay-reference');
    const reference = (refInput?.value || '').trim();

    let chequeDetails = {};
    if (method === 'cheque') {
      const no = document.getElementById('supp-pay-cheque-no')?.value || '';
      const d = document.getElementById('supp-pay-cheque-date')?.value || '';
      const b = document.getElementById('supp-pay-cheque-bank')?.value || '';
      chequeDetails = { chequeNo: no, chequeDate: d, bank: b };
    }

    await window.app?.withLoading(async () => {
      const res = await window.db.addSupplierPayment({
        supplierId,
        amount,
        method,
        chequeDetails,
        reference,
        date
      });
      if (!res.ok) {
        alert(res.error || 'Failed to save payment.');
        return;
      }
      window.app?.closeModal('supplier-payment-modal');
      await this.render();
      if (this.currentProfileSupplierId === supplierId) {
        await this.openProfileModal(supplierId);
      }
    }, 'Recording payment...', 'Updating supplier balance');
  }

  // =================== SUPPLIER PROFILE & LEDGER ===================
  async openProfileModal(supplierId) {
    const s = this.suppliers.find((item) => Number(item.id) === Number(supplierId));
    if (!s) return;

    this.currentProfileSupplierId = s.id;

    const [purchases, payments] = await Promise.all([
      window.db.getPurchases(s.id),
      window.db.getSupplierPayments(s.id)
    ]);
    this.currentProfilePurchases = purchases || [];
    this.currentProfilePayments = payments || [];

    const avatarEl = document.getElementById('supp-profile-avatar');
    const nameEl = document.getElementById('supp-profile-name');
    const phoneWrap = document.getElementById('supp-profile-phone');
    const phoneText = document.getElementById('supp-profile-phone-text');
    const addrWrap = document.getElementById('supp-profile-address');
    const addrText = document.getElementById('supp-profile-address-text');
    const statusBadge = document.getElementById('supp-profile-status-badge');

    const initials = (s.name || 'SP').slice(0, 2).toUpperCase();
    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = s.name;

    if (phoneWrap && phoneText) {
      if (s.phone) {
        phoneText.textContent = s.phone;
        phoneWrap.style.display = 'inline-flex';
      } else {
        phoneWrap.style.display = 'none';
      }
    }

    if (addrWrap && addrText) {
      const meta = [s.contactPerson, s.address, s.bankDetails].filter(Boolean).join(' - ');
      if (meta) {
        addrText.textContent = meta;
        addrWrap.style.display = 'inline-flex';
      } else {
        addrWrap.style.display = 'none';
      }
    }

    const info = this.computeSupplierBalance(s);
    const isDue = Money.isPositive(info.balance);
    const isAdvance = info.balance < 0;

    if (statusBadge) {
      if (isDue) {
        statusBadge.textContent = `Due LKR ${this.formatAmount(info.balance)}`;
        statusBadge.className = 'profile-status-badge' + (isDue ? ' is-due' : '');
        statusBadge.style.background = '#fef2f2';
        statusBadge.style.color = '#dc2626';
        statusBadge.style.border = '1px solid #fca5a5';
      } else if (isAdvance) {
        statusBadge.textContent = `Advance LKR ${this.formatAmount(Math.abs(info.balance))}`;
        statusBadge.style.background = '#ecfdf5';
        statusBadge.style.color = '#047857';
        statusBadge.style.border = '1px solid #a7f3d0';
      } else {
        statusBadge.textContent = 'Clear / Paid';
        statusBadge.style.background = '#ecfdf5';
        statusBadge.style.color = '#047857';
        statusBadge.style.border = '1px solid #a7f3d0';
      }
    }

    // Financial Cards
    const paidEl = document.getElementById('supp-stat-paid-amount');
    const paidCountEl = document.getElementById('supp-stat-paid-count');
    const dueEl = document.getElementById('supp-stat-due-amount');
    const dueSubEl = document.getElementById('supp-stat-due-status');
    const openingEl = document.getElementById('supp-stat-opening-amount');
    const purchasesCountEl = document.getElementById('supp-stat-purchases-count');
    const purchasesTotalEl = document.getElementById('supp-stat-purchases-total');

    if (paidEl) paidEl.textContent = `LKR ${this.formatAmount(info.totalPaid)}`;
    if (paidCountEl) paidCountEl.textContent = `${info.paymentsCount} payments made`;
    if (dueEl) {
      dueEl.textContent = `LKR ${this.formatAmount(Math.max(0, info.balance))}`;
      dueEl.style.color = isDue ? '#dc2626' : 'var(--text-main)';
    }
    if (dueSubEl) dueSubEl.textContent = isDue ? 'Pending payable balance' : 'No balance owed';
    if (openingEl) openingEl.textContent = `LKR ${this.formatAmount(info.opening)}`;
    if (purchasesCountEl) purchasesCountEl.textContent = info.purchasesCount;
    if (purchasesTotalEl) purchasesTotalEl.textContent = `Total: LKR ${this.formatAmount(info.totalPurchased)}`;

    // Tab counts
    const tabPurchases = document.getElementById('supp-tab-count-purchases');
    const tabPayments = document.getElementById('supp-tab-count-payments');
    if (tabPurchases) tabPurchases.textContent = this.currentProfilePurchases.length;
    if (tabPayments) tabPayments.textContent = this.currentProfilePayments.length;

    this.switchProfileView('purchases');
    this.renderProfilePurchases(this.currentProfilePurchases);
    this.renderProfilePayments(this.currentProfilePayments);

    window.app?.openModal('supplier-profile-modal');
  }

  switchProfileView(view) {
    const btnPurchases = document.getElementById('btn-supp-view-purchases');
    const btnPayments = document.getElementById('btn-supp-view-payments');
    const secPurchases = document.getElementById('supp-purchases-section');
    const secPayments = document.getElementById('supp-payments-section');

    if (view === 'purchases') {
      btnPurchases?.classList.add('active');
      btnPayments?.classList.remove('active');
      secPurchases?.classList.remove('hidden');
      secPayments?.classList.add('hidden');
    } else {
      btnPayments?.classList.add('active');
      btnPurchases?.classList.remove('active');
      secPayments?.classList.remove('hidden');
      secPurchases?.classList.add('hidden');
    }
  }

  renderProfilePurchases(purchases) {
    const tbody = document.getElementById('supp-purchases-tbody');
    const emptyState = document.getElementById('supp-purchases-empty');
    if (!tbody) return;

    if (!purchases.length) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = purchases.map((p) => {
      const itemsSummary = (p.items || []).map((i) => `${i.name} (x${i.qty})`).join(', ') || 'Stock Inward';
      const isDue = Money.isPositive(p.balanceAmount);

      return `
        <tr>
          <td>
            <div class="rec-ref-pill">#${this.escapeHtml(p.invoiceNumber || p.id)}</div>
            <div class="rec-date-sub" style="margin-top: 3px;">${this.escapeHtml(p.date || '')}</div>
          </td>
          <td>
            <div style="font-size: 0.78rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(itemsSummary)}">${this.escapeHtml(itemsSummary)}</div>
          </td>
          <td>
            <div style="font-weight: 600;">LKR ${this.formatAmount(p.totalAmount)}</div>
            <div class="rec-date-sub">Paid: LKR ${this.formatAmount(p.paidAmount)}</div>
          </td>
          <td style="text-align: right;">
            ${isDue ? `<span class="customers-due" style="font-weight: 700;">Due LKR ${this.formatAmount(p.balanceAmount)}</span>` : `<span class="customers-paid" style="font-weight: 700;">Paid ✓</span>`}
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn-profile-tool" onclick="suppliersPage.deletePurchaseRecord(${p.id})" title="Delete Purchase" style="color: #ef4444; padding: 4px 8px;">&times;</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderProfilePayments(payments) {
    const tbody = document.getElementById('supp-payments-tbody');
    const emptyState = document.getElementById('supp-payments-empty');
    if (!tbody) return;

    if (!payments.length) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = payments.map((pay) => {
      const methodLabel = ({ cash: 'Cash', bank: 'Bank Transfer', cheque: 'Cheque' })[pay.method] || pay.method;
      return `
        <tr>
          <td>
            <div style="font-weight: 600; font-size: 0.82rem;">${this.escapeHtml(pay.date || '')}</div>
          </td>
          <td>
            <div style="font-size: 0.8rem;">${this.escapeHtml(pay.reference || '-')}</div>
            ${pay.chequeNo ? `<div class="rec-date-sub">Cheque: ${this.escapeHtml(pay.chequeNo)} (${this.escapeHtml(pay.bank || '')})</div>` : ''}
          </td>
          <td>
            <span class="rec-ref-pill" style="font-size: 0.75rem;">${this.escapeHtml(methodLabel)}</span>
          </td>
          <td style="text-align: right; font-weight: 700; color: #047857;">
            LKR ${this.formatAmount(pay.amount)}
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn-profile-tool" onclick="suppliersPage.deletePaymentRecord(${pay.id})" title="Delete Payment" style="color: #ef4444; padding: 4px 8px;">&times;</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  payCurrentProfileSupplier() {
    if (!this.currentProfileSupplierId) return;
    this.openPaymentModal(this.currentProfileSupplierId);
  }

  newPurchaseForCurrentProfile() {
    if (!this.currentProfileSupplierId) return;
    this.openPurchaseModal(this.currentProfileSupplierId);
  }

  editCurrentProfileSupplier() {
    if (!this.currentProfileSupplierId) return;
    this.openSupplierModal(this.currentProfileSupplierId);
  }

  async deletePurchaseRecord(purchaseId) {
    if (!confirm('Are you sure you want to delete this purchase bill? Stock adjustments will be reverted.')) return;
    await window.app?.withLoading(async () => {
      await window.db.deletePurchase(purchaseId);
      await this.render();
      if (this.currentProfileSupplierId) {
        await this.openProfileModal(this.currentProfileSupplierId);
      }
    }, 'Deleting purchase...', 'Reverting stock');
  }

  async deletePaymentRecord(paymentId) {
    if (!confirm('Are you sure you want to delete this payment record? The supplier balance will be restored.')) return;
    await window.app?.withLoading(async () => {
      await window.db.deleteSupplierPayment(paymentId);
      await this.render();
      if (this.currentProfileSupplierId) {
        await this.openProfileModal(this.currentProfileSupplierId);
      }
    }, 'Deleting payment...', 'Restoring balance');
  }
}

window.suppliersPage = new SuppliersPage();

