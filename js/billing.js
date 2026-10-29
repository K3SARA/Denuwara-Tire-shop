class Billing {
  constructor() {
    this.items = [];
    this.availableProducts = [];
    this.customerDirectory = [];
    this.customerOutstandingMap = new Map();
    this.currentTotal = 0;
    this.editBillId = null;
    this.editOriginalBill = null;
    this._saving = false;
    this.payments = [];
    this.splitPaymentsEnabled = false;
  }

  async init() {
    this.availableProducts = await window.db.getProducts();
    await this.loadCustomerDirectory();
    await this.loadOutstandingDirectory();
    this.setupCustomerAutocomplete();

    document.getElementById('btn-add-item').addEventListener('click', () => this.addItem());
    document.getElementById('btn-generate-bill').addEventListener('click', () => this.generateBill());
    document.getElementById('btn-cancel-edit')?.addEventListener('click', () => this.cancelEditMode());

    document.getElementById('received-amount').addEventListener('input', () => this.updatePaymentSummary());
    document.getElementById('payment-method').addEventListener('change', () => this.toggleChequeDetails());
    document.getElementById('btn-add-payment-method')?.addEventListener('click', () => this.addAnotherPaymentMethod());
    document.getElementById('btn-clear-split-payments')?.addEventListener('click', () => this.disableSplitPayments());
    document.getElementById('cheque-amount')?.addEventListener('input', () => this.syncChequeAmountToReceived());

    this.addItem();
    this.toggleChequeDetails();

    window.addEventListener('beforeunload', (e) => {
      if (this._hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  formatAmount(value) {
    return Money.round(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  _hasUnsavedWork() {
    if (this.editBillId) return true;
    if (!this.items || this.items.length === 0) return false;
    return this.items.some((item) => item.name && String(item.name).trim());
  }

  itemKey(item) {
    if (item && item.productId !== undefined && item.productId !== null && item.productId !== '') {
      return `id:${Number(item.productId)}`;
    }
    return `name:${this.normalize(item?.name)}`;
  }

  getProductByName(name) {
    const key = this.normalize(name);
    if (!key) return null;
    return this.availableProducts.find((p) => this.normalize(p.name) === key) || null;
  }

  getProductById(id) {
    if (id === undefined || id === null || id === '') return null;
    const numericId = Number(id);
    return this.availableProducts.find((p) => Number(p.id) === numericId) || null;
  }

  getProductForItem(item) {
    if (!item) return null;
    return this.getProductById(item.productId) || this.getProductByName(item.name);
  }

  formatQty(value) {
    const qty = Number(value) || 0;
    return qty.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  getOriginalBillQtyForProduct(product) {
    if (!product || !this.editOriginalBill?.items) return 0;
    const productId = Number(product.id);
    const productName = this.normalize(product.name);

    return this.editOriginalBill.items.reduce((sum, item) => {
      const sameId = item.productId !== undefined && item.productId !== null && Number(item.productId) === productId;
      const sameName = !sameId && this.normalize(item.name) === productName;
      return sameId || sameName ? sum + (Number(item.qty) || 0) : sum;
    }, 0);
  }

  getCurrentBillQtyForProduct(product) {
    if (!product) return 0;
    const productId = Number(product.id);
    const productName = this.normalize(product.name);

    return this.items.reduce((sum, item) => {
      const sameId = item.productId !== undefined && item.productId !== null && Number(item.productId) === productId;
      const sameName = !sameId && this.normalize(item.name) === productName;
      return sameId || sameName ? sum + (Number(item.qty) || 0) : sum;
    }, 0);
  }

  renderProductStockHint(itemId) {
    const item = this.items.find((i) => i.id === itemId);
    const hint = document.getElementById(`product-stock-hint-${itemId}`);
    if (!hint) return;

    const product = this.getProductForItem(item);
    if (!product) {
      hint.textContent = '';
      hint.className = 'product-stock-hint';
      return;
    }

    const available = (Number(product.stock) || 0) + this.getOriginalBillQtyForProduct(product);
    const billQty = this.getCurrentBillQtyForProduct(product);
    const remaining = available - billQty;
    const unit = item?.unit || 'pcs';

    hint.textContent = `Available: ${this.formatQty(available)} ${unit} | After this bill: ${this.formatQty(remaining)} ${unit}`;
    hint.className = `product-stock-hint ${remaining < 0 ? 'stock-danger' : remaining === 0 ? 'stock-warning' : 'stock-ok'}`;
  }

  renderAllProductStockHints() {
    this.items.forEach((item) => this.renderProductStockHint(item.id));
  }

  escapeAttribute(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  getUnitOptions(selectedUnit = 'pcs') {
    const units = [
      { value: 'pcs', label: 'Pcs' },
      { value: 'kg', label: 'Kg' },
      { value: 'g', label: 'g' },
      { value: 'ltr', label: 'Ltr' },
      { value: 'pack', label: 'Pack' },
      { value: 'box', label: 'Box' }
    ];
    return units.map((unit) => {
      const selected = unit.value === selectedUnit ? ' selected' : '';
      return `<option value="${unit.value}"${selected}>${unit.label}</option>`;
    }).join('');
  }

  async refreshProducts() {
    this.availableProducts = await window.db.getProducts();
  }

  normalizeCustomerName(name) {
    return (name || '').trim().toLowerCase();
  }

  async loadCustomerDirectory() {
    this.customerDirectory = await window.db.getCustomers();
  }

  async loadOutstandingDirectory() {
    const bills = await window.db.getBills();
    const map = new Map();

    bills.forEach((bill) => {
      if (bill.billStatus && bill.billStatus !== 'active') return;

      const key = this.normalizeCustomerName(bill.customerName);
      if (!key || key === 'walk-in customer') return;

      const total = Money.round(bill.total);
      const received = Money.round(bill.receivedAmount || 0);
      const balance = typeof bill.balanceAmount === 'number'
        ? Money.clampZero(bill.balanceAmount)
        : Money.clampZero(Money.subtract(total, received));

      if (!Money.isPositive(balance)) return;
      map.set(key, Money.add(map.get(key) || 0, balance));
    });

    this.customerOutstandingMap = map;
  }

  renderOutstandingHint(customerName) {
    const hint = document.getElementById('customer-outstanding');
    if (!hint) return;

    const key = this.normalizeCustomerName(customerName);
    if (!key) {
      hint.style.display = 'none';
      hint.textContent = '';
      return;
    }

    const previousOutstanding = this.customerOutstandingMap.get(key) || 0;
    const currentTotal = Money.round(this.currentTotal);
    const received = this.isSplitPaymentActive() ? this.getSplitReceivedAmount() : Money.clampZero(document.getElementById('received-amount')?.value || '0');
    const outstanding = Money.clampZero(Money.subtract(Money.add(previousOutstanding, currentTotal), received));

    if (Money.isPositive(outstanding)) {
      hint.textContent = `Outstanding: LKR ${outstanding.toLocaleString()}`;
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
      hint.textContent = '';
    }
  }

  setupCustomerAutocomplete() {
    const nameInput = document.getElementById('customer-name');
    const phoneInput = document.getElementById('customer-phone');
    const addressInput = document.getElementById('customer-address');
    const dropdown = document.getElementById('customer-autocomplete');
    if (!nameInput || !phoneInput || !addressInput || !dropdown) return;

    const hideDropdown = () => {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
    };

    const getExactCustomer = (value) => {
      const q = (value || '').trim().toLowerCase();
      if (!q) return null;
      return this.customerDirectory.find((c) => c.name.toLowerCase() === q) || null;
    };

    const showSuggestions = (query) => {
      const q = (query || '').trim().toLowerCase();
      if (!q) {
        hideDropdown();
        return;
      }

      const matches = this.customerDirectory
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 8);

      if (matches.length === 0) {
        hideDropdown();
        return;
      }

      dropdown.innerHTML = '';
      matches.forEach((customer) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'dropdown-item';
        item.textContent = customer.phone ? `${customer.name} (${customer.phone})` : customer.name;

        item.addEventListener('click', () => {
          nameInput.value = customer.name;
          if (customer.phone) phoneInput.value = customer.phone;
          if (customer.address) addressInput.value = customer.address;
          this.renderOutstandingHint(customer.name);
          hideDropdown();
        });

        dropdown.appendChild(item);
      });
      dropdown.classList.add('active');
    };

    nameInput.addEventListener('input', (e) => {
      const value = e.target.value;
      showSuggestions(value);
      this.renderOutstandingHint(value);

      const exact = getExactCustomer(value);
      if (exact && exact.phone) phoneInput.value = exact.phone;
      if (exact && exact.address) addressInput.value = exact.address;
    });

    nameInput.addEventListener('focus', async () => {
      // Always refresh the outstanding map so the hint reflects
      // any payments collected since this page was last loaded.
      await this.loadOutstandingDirectory();
      if (nameInput.value.trim()) {
        showSuggestions(nameInput.value);
        this.renderOutstandingHint(nameInput.value);
      } else {
        hideDropdown();
      }
    });

    nameInput.addEventListener('blur', () => {
      setTimeout(() => {
        const exact = getExactCustomer(nameInput.value);
        if (exact && exact.phone) phoneInput.value = exact.phone;
        if (exact && exact.address) addressInput.value = exact.address;
        this.renderOutstandingHint(nameInput.value);
        hideDropdown();
      }, 120);
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== nameInput) hideDropdown();
    });
  }

  addItem() {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
    this.items.push({
      id,
      productId: null,
      name: '',
      qty: 1,
      unit: 'pcs',
      price: '',
      costPrice: 0
    });
    this.renderItems();
  }

  removeItem(id) {
    if (this.items.length <= 1) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.renderItems();
  }

  selectProductForItem(itemId, product) {
    const item = this.items.find((i) => i.id === itemId);
    if (!item || !product) return;
    item.productId = product.id;
    item.name = product.name;
    item.price = String(Number(product.billingPrice) || 0);
    item.costPrice = Number(product.invoicePrice) || 0;
    this.updateTotals();
  }

  async quickAddInventoryItem(itemId, seedName = '') {
    const item = this.items.find((i) => i.id === itemId);
    const name = String(seedName || item?.name || '').trim();
    if (!item || !name) return;

    const currentPrice = Number(item.price) || 0;
    const stockText = prompt(`Initial stock for "${name}":`, '0');
    if (stockText === null) return;
    const stock = parseFloat(stockText);
    if (!Number.isFinite(stock) || stock < 0) {
      alert('Enter a valid stock quantity.');
      return;
    }

    const sellingText = prompt(`Selling price for "${name}":`, currentPrice > 0 ? String(currentPrice) : '0');
    if (sellingText === null) return;
    const billingPrice = parseFloat(sellingText);
    if (!Number.isFinite(billingPrice) || billingPrice <= 0) {
      alert('Enter a valid selling price.');
      return;
    }

    const purchaseText = prompt(`Purchase price for "${name}":`, '0');
    if (purchaseText === null) return;
    const invoicePrice = parseFloat(purchaseText);
    if (!Number.isFinite(invoicePrice) || invoicePrice < 0) {
      alert('Enter a valid purchase price.');
      return;
    }

    const reorderText = prompt(`Reorder level for "${name}":`, '5');
    if (reorderText === null) return;
    const reorderLevel = parseFloat(reorderText);
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
      alert('Enter a valid reorder level.');
      return;
    }

    const result = await window.db.addProduct(name, stock, billingPrice, invoicePrice, reorderLevel);
    if (!result?.ok) {
      alert(result?.error || 'Failed to add product.');
      return;
    }

    const products = await window.db.getProducts();
    const created = products.find((product) => this.normalize(product.name) === this.normalize(name));
    if (created) {
      await window.db.addInventoryLog({
        productId: created.id,
        productName: created.name,
        addedQty: stock,
        billingPrice,
        invoicePrice,
        action: 'quick_add_from_bill',
        reason: 'Created from billing item'
      });
      await window.db.addAuditLog({
        action: 'product_quick_create',
        entity: 'product',
        entityId: created.id,
        details: { productName: created.name, stock, billingPrice }
      });
      await this.refreshProducts();
      this.selectProductForItem(itemId, created);
      this.renderItems();
      if (window.inventory) await window.inventory.render();
    }
  }

  updateItem(id, field, value) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;

    if (field === 'qty') {
      item.qty = Math.max(0.01, parseFloat(value) || 1);
    } else if (field === 'price') {
      item.price = value;
    } else if (field === 'name') {
      item.name = value;
      item.productId = null;
      item.costPrice = 0;

      const matchedProduct = this.getProductByName(value);
      if (matchedProduct) {
        item.productId = matchedProduct.id;
        item.price = String(Number(matchedProduct.billingPrice) || 0);
        item.costPrice = Number(matchedProduct.invoicePrice) || 0;
      }
    } else {
      item[field] = value;
    }
    this.updateTotals();
    this.renderAllProductStockHints();
  }

  hideProductSuggestions(itemId) {
    const dropdown = document.getElementById(`product-autocomplete-${itemId}`);
    if (!dropdown) return;
    dropdown.classList.remove('active');
    dropdown.innerHTML = '';
  }

  hideAllProductSuggestions(exceptItemId = null) {
    this.items.forEach((item) => {
      if (exceptItemId && item.id === exceptItemId) return;
      this.hideProductSuggestions(item.id);
    });
  }

  showProductSuggestions(itemId, query) {
    const dropdown = document.getElementById(`product-autocomplete-${itemId}`);
    if (!dropdown) return;

    const q = (query || '').trim().toLowerCase();
    const products = [...this.availableProducts]
      .filter((p) => !p.inactive)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const matches = (q
      ? products.filter((p) => (p.name || '').toLowerCase().includes(q)).slice(0, 8)
      : products.slice(0, 12));

    this.hideAllProductSuggestions(itemId);
    dropdown.innerHTML = '';

    if (matches.length === 0 && !q) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'dropdown-item dropdown-empty-item';
      empty.textContent = 'No inventory products available';
      empty.disabled = true;
      dropdown.appendChild(empty);
      dropdown.classList.add('active');
      return;
    }

    matches.forEach((product) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dropdown-item';
      btn.textContent = product.name;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selectProductForItem(itemId, product);
        this.renderItems();
      });
      dropdown.appendChild(btn);
    });

    const exactMatch = products.some((p) => this.normalize(p.name) === this.normalize(query));
    if (q && !exactMatch) {
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'dropdown-item dropdown-create-item';
      createBtn.textContent = `Add "${query.trim()}" to Inventory`;
      createBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        this.hideProductSuggestions(itemId);
        await this.quickAddInventoryItem(itemId, query.trim());
      });
      dropdown.appendChild(createBtn);
    }

    if (dropdown.children.length > 0) dropdown.classList.add('active');
    else this.hideProductSuggestions(itemId);
  }

  renderItems() {
    const container = document.getElementById('bill-items-container');
    container.innerHTML = '';

    this.items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'card bill-item';
      el.innerHTML = `
        <div class="item-name-row">
          <div class="product-input-wrap">
            <label>Item Name</label>
            <input type="text" id="product-name-${item.id}" class="input-field product-name-input" placeholder="Product Name" value="${this.escapeAttribute(item.name)}" style="font-size:1.1rem; font-weight:500;">
            <div id="product-autocomplete-${item.id}" class="customer-dropdown"></div>
            <div id="product-stock-hint-${item.id}" class="product-stock-hint"></div>
          </div>
          ${this.items.length > 1 ? `<button class="item-remove" onclick="billing.removeItem('${item.id}')">x</button>` : ''}
        </div>
        <div class="item-controls-grid">
          <div class="item-field-block">
            <label>Quantity</label>
            <input type="number" class="input-field" value="${item.qty}" min="0.01" step="0.01" oninput="billing.updateItem('${item.id}', 'qty', this.value)">
          </div>
          <div class="item-field-block">
            <label>Unit</label>
            <select class="input-field item-unit-select" onchange="billing.updateItem('${item.id}', 'unit', this.value)">
              ${this.getUnitOptions(item.unit || 'pcs')}
            </select>
          </div>
        </div>
        <div class="item-field-block">
          <label>Rate (price/unit)</label>
          <input type="number" class="input-field" placeholder="Price" value="${item.price}" step="0.01" oninput="billing.updateItem('${item.id}', 'price', this.value)">
        </div>
      `;
      container.appendChild(el);

      const productInput = document.getElementById(`product-name-${item.id}`);
      if (productInput) {
        const openProductDropdown = async () => {
          await this.refreshProducts();
          if (document.activeElement === productInput) {
            this.showProductSuggestions(item.id, productInput.value || '');
          }
        };

        productInput.addEventListener('input', (e) => {
          const value = e.target.value;
          this.updateItem(item.id, 'name', value);
          this.showProductSuggestions(item.id, value);
        });

        productInput.addEventListener('focus', openProductDropdown);
        productInput.addEventListener('click', openProductDropdown);

        productInput.addEventListener('blur', () => {
          setTimeout(() => this.hideProductSuggestions(item.id), 120);
        });
      }
    });
    this.updateTotals();
    this.renderAllProductStockHints();
  }

  updateTotals() {
    let total = 0;
    this.items.forEach((item) => {
      total = Money.add(total, Money.multiply(item.price, item.qty));
    });
    document.getElementById('label-subtotal').innerText = 'LKR ' + this.formatAmount(total);
    document.getElementById('label-total').innerText = 'LKR ' + this.formatAmount(total);
    this.currentTotal = total;
    this.updatePaymentSummary();
  }

  updatePaymentSummary() {
    const receivedInput = document.getElementById('received-amount');
    const received = this.isSplitPaymentActive()
      ? this.getSplitReceivedAmount()
      : Money.clampZero(receivedInput?.value || '0');
    if (this.isSplitPaymentActive() && receivedInput) receivedInput.value = received ? received.toFixed(2) : '';
    const total = Money.round(this.currentTotal);
    const balance = Money.clampZero(Money.subtract(total, received));
    const change = Money.clampZero(Money.subtract(received, total));

    const balanceLabel = document.getElementById('label-balance');
    const changeLabel = document.getElementById('label-change');

    if (balanceLabel) {
      balanceLabel.innerText = 'LKR ' + this.formatAmount(balance);
      balanceLabel.style.color = Money.isPositive(balance) ? 'var(--danger-color)' : 'var(--text-main)';
    }
    if (changeLabel) {
      changeLabel.innerText = 'LKR ' + this.formatAmount(change);
      changeLabel.style.display = Money.isPositive(change) ? 'inline' : 'none';
    }

    this.renderOutstandingHint(document.getElementById('customer-name')?.value || '');
  }

  toggleChequeDetails() {
    const method = document.getElementById('payment-method');
    const details = document.getElementById('cheque-details');
    if (!method || !details) return;

    const isCheque = method.value === 'cheque';
    details.classList.toggle('hidden', !isCheque);
  }

  methodLabel(method) {
    const labels = {
      cash: 'Cash',
      card: 'Card',
      bank: 'Bank Transfer',
      cheque: 'Cheque',
      credit: 'Credit'
    };
    return labels[String(method || '').toLowerCase()] || 'Payment';
  }

  getBillPayments(bill) {
    if (Array.isArray(bill?.payments) && bill.payments.length) {
      return bill.payments.map((payment, index) => ({
        id: payment.id || `payment-${index + 1}`,
        method: String(payment.method || 'cash').toLowerCase(),
        amount: Money.clampZero(payment.chequeAmount || payment.amount),
        chequeAmount: Money.clampZero(payment.chequeAmount || payment.amount),
        chequeDate: payment.chequeDate || '',
        chequeNumber: payment.chequeNumber || '',
        chequeBank: payment.chequeBank || '',
        chequeStatus: payment.chequeStatus || (String(payment.method || '').toLowerCase() === 'cheque' ? 'pending' : '')
      }));
    }

    const method = String(bill?.paymentMethod || (bill?.markAsCredit ? 'credit' : 'cash')).toLowerCase();
    return [{
      id: 'legacy-payment-1',
      method,
      amount: Money.clampZero(bill?.receivedAmount || 0),
      chequeAmount: method === 'cheque' ? Money.clampZero(bill?.chequeAmount || bill?.receivedAmount || 0) : 0,
      chequeDate: bill?.chequeDate || '',
      chequeNumber: bill?.chequeNumber || '',
      chequeBank: bill?.chequeBank || '',
      chequeStatus: method === 'cheque' ? (bill?.chequeStatus || 'pending') : ''
    }];
  }

  isSplitPaymentActive() {
    return this.splitPaymentsEnabled && this.payments.length > 0;
  }

  createPayment(seed = {}) {
    return {
      id: seed.id || `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      method: seed.method || 'cash',
      amount: seed.amount ?? '',
      chequeAmount: seed.chequeAmount ?? seed.amount ?? '',
      chequeDate: seed.chequeDate || '',
      chequeNumber: seed.chequeNumber || '',
      chequeBank: seed.chequeBank || '',
      chequeStatus: seed.chequeStatus || (seed.method === 'cheque' ? 'pending' : '')
    };
  }

  getCurrentSinglePaymentSeed() {
    const method = document.getElementById('payment-method')?.value || 'cash';
    const chequeDetails = this.getChequeDetails();
    const amount = method === 'cheque' && chequeDetails.chequeAmount > 0
      ? chequeDetails.chequeAmount
      : Money.clampZero(document.getElementById('received-amount')?.value || '0');
    return this.createPayment({ method, amount: amount || '', ...chequeDetails });
  }

  addAnotherPaymentMethod() {
    if (!this.splitPaymentsEnabled) {
      this.enableSplitPayments([this.getCurrentSinglePaymentSeed(), this.createPayment({ method: 'cash' })]);
      return;
    }
    this.addPaymentRow({ method: 'cash' });
  }
  enableSplitPayments(seedPayments = null) {
    this.splitPaymentsEnabled = true;
    const splitWrap = document.getElementById('split-payments');
    splitWrap?.classList.remove('hidden');

    if (Array.isArray(seedPayments)) {
      this.payments = seedPayments.map((payment) => this.createPayment(payment));
    } else if (!this.payments.length) {
      const method = document.getElementById('payment-method')?.value || 'cash';
      const amount = Money.clampZero(document.getElementById('received-amount')?.value || '0');
      const chequeDetails = this.getChequeDetails();
      this.payments = [this.createPayment({ method, amount: amount || '', ...chequeDetails })];
    }

    document.getElementById('payment-method')?.setAttribute('disabled', 'disabled');
    const receivedInput = document.getElementById('received-amount');
    if (receivedInput) receivedInput.readOnly = true;
    this.renderPaymentRows();
    this.updatePaymentSummary();
  }

  disableSplitPayments() {
    this.splitPaymentsEnabled = false;
    this.payments = [];
    document.getElementById('split-payments')?.classList.add('hidden');
    const list = document.getElementById('split-payments-list');
    if (list) list.innerHTML = '';
    document.getElementById('payment-method')?.removeAttribute('disabled');
    const receivedInput = document.getElementById('received-amount');
    if (receivedInput) receivedInput.readOnly = false;
    this.updatePaymentSummary();
  }

  addPaymentRow(seed = {}) {
    if (!this.splitPaymentsEnabled) this.enableSplitPayments();
    this.payments.push(this.createPayment(seed));
    this.renderPaymentRows();
    this.updatePaymentSummary();
  }

  removePaymentRow(id) {
    this.payments = this.payments.filter((payment) => payment.id !== id);
    if (!this.payments.length) {
      this.addPaymentRow({ method: 'cash' });
      return;
    }
    this.renderPaymentRows();
    this.updatePaymentSummary();
  }

  updatePaymentRow(id, field, value) {
    const payment = this.payments.find((item) => item.id === id);
    if (!payment) return;
    if (field === 'amount') {
      payment.amount = value;
      if (payment.method === 'cheque') payment.chequeAmount = value;
    }
    else if (field === 'method') {
      payment.method = value;
      if (value !== 'cheque') {
        payment.chequeDate = '';
        payment.chequeNumber = '';
        payment.chequeBank = '';
        payment.chequeStatus = '';
      } else if (!payment.chequeStatus) {
        payment.chequeStatus = 'pending';
      }
      this.renderPaymentRows();
    } else {
      payment[field] = value;
    }
    this.updatePaymentSummary();
  }

  renderPaymentRows() {
    const list = document.getElementById('split-payments-list');
    if (!list) return;
    list.innerHTML = this.payments.map((payment, index) => {
      const isCheque = payment.method === 'cheque';
      return `
        <div class="split-payment-row" data-payment-id="${this.escapeAttribute(payment.id)}">
          <div class="split-payment-top">
            <div class="input-group" style="margin-bottom:0;">
              <label>Method ${index + 1}</label>
              <select class="input-field" data-payment-field="method" data-payment-id="${this.escapeAttribute(payment.id)}">
                ${['cash', 'card', 'bank', 'cheque', 'credit'].map((method) => `<option value="${method}"${payment.method === method ? ' selected' : ''}>${this.methodLabel(method)}</option>`).join('')}
              </select>
            </div>
            <div class="input-group" style="margin-bottom:0;">
              <label>${isCheque ? 'Cheque Amount' : 'Amount'}</label>
              <input type="number" class="input-field" step="0.01" placeholder="0" value="${this.escapeAttribute(payment.amount)}" data-payment-field="amount" data-payment-id="${this.escapeAttribute(payment.id)}">
            </div>
            <button type="button" class="split-payment-remove" data-payment-remove="${this.escapeAttribute(payment.id)}" aria-label="Remove payment">x</button>
          </div>
          <div class="split-cheque-fields${isCheque ? '' : ' hidden'}">
            <div class="input-group" style="margin-bottom:0;">
              <label>Cheque Date</label>
              <input type="date" class="input-field" value="${this.escapeAttribute(payment.chequeDate)}" data-payment-field="chequeDate" data-payment-id="${this.escapeAttribute(payment.id)}">
            </div>
            <div class="input-group" style="margin-bottom:0;">
              <label>Cheque Number</label>
              <input type="text" class="input-field" placeholder="Cheque number" value="${this.escapeAttribute(payment.chequeNumber)}" data-payment-field="chequeNumber" data-payment-id="${this.escapeAttribute(payment.id)}">
            </div>
            <div class="input-group" style="margin-bottom:0;">
              <label>Bank</label>
              <input type="text" class="input-field" placeholder="Bank" value="${this.escapeAttribute(payment.chequeBank)}" data-payment-field="chequeBank" data-payment-id="${this.escapeAttribute(payment.id)}">
            </div>
          </div>
        </div>
      `;
    }).join('') + '<button type="button" class="btn-tool split-payment-add" data-add-payment-row="1">+ Add Another Payment</button>';

    list.querySelectorAll('[data-payment-field]').forEach((input) => {
      input.addEventListener('input', () => this.updatePaymentRow(input.getAttribute('data-payment-id'), input.getAttribute('data-payment-field'), input.value));
      input.addEventListener('change', () => this.updatePaymentRow(input.getAttribute('data-payment-id'), input.getAttribute('data-payment-field'), input.value));
    });
    list.querySelectorAll('[data-payment-remove]').forEach((button) => {
      button.addEventListener('click', () => this.removePaymentRow(button.getAttribute('data-payment-remove')));
    });
    list.querySelector('[data-add-payment-row]')?.addEventListener('click', () => this.addPaymentRow({ method: 'cash' }));
  }

  isPaymentReceivedNow(payment) {
    const method = String(payment?.method || '').toLowerCase();
    if (method === 'credit') return false;
    return true;
  }
  getSplitReceivedAmount() {
    return this.payments.reduce((sum, payment) => {
      if (!this.isPaymentReceivedNow(payment)) return sum;
      return Money.add(sum, Money.clampZero(payment.amount || '0'));
    }, 0);
  }

  normalizePaymentRowsForSave() {
    if (!this.isSplitPaymentActive()) {
      const method = document.getElementById('payment-method')?.value || 'cash';
      const amount = Money.clampZero(document.getElementById('received-amount')?.value || '0');
      const chequeDetails = this.getChequeDetails();
      return [this.createPayment({ method, amount, ...chequeDetails })];
    }

    return this.payments.map((payment) => ({
      ...payment,
      method: String(payment.method || 'cash').toLowerCase(),
      amount: Money.clampZero(payment.amount || '0'),
      chequeAmount: payment.method === 'cheque' ? Money.clampZero(payment.chequeAmount || payment.amount) : 0,
      chequeDate: payment.method === 'cheque' ? payment.chequeDate : '',
      chequeNumber: payment.method === 'cheque' ? String(payment.chequeNumber || '').trim() : '',
      chequeBank: payment.method === 'cheque' ? String(payment.chequeBank || '').trim() : '',
      chequeStatus: payment.method === 'cheque' ? (payment.chequeStatus || 'pending') : ''
    })).filter((payment) => Money.isPositive(payment.amount) || payment.method === 'credit');
  }

  validatePaymentRows(payments) {
    if (!payments.length) {
      alert('Add at least one payment method.');
      return false;
    }

    for (const payment of payments) {
      if (this.isSplitPaymentActive() && !Money.isPositive(payment.amount)) {
        alert('Each payment amount must be more than 0.');
        return false;
      }
      if (payment.method === 'cheque' && !this.validateChequeDetails(payment)) return false;
    }
    return true;
  }

  getPrimaryPaymentFields(payments) {
    const cheque = payments.find((payment) => payment.method === 'cheque');
    const paymentMethod = payments.length > 1 ? 'multiple' : (payments[0]?.method || 'cash');
    return {
      paymentMethod,
      markAsCredit: payments.some((payment) => payment.method === 'credit'),
      chequeAmount: cheque ? Money.clampZero(cheque.chequeAmount || cheque.amount) : 0,
      chequeDate: cheque?.chequeDate || '',
      chequeNumber: cheque?.chequeNumber || '',
      chequeBank: cheque?.chequeBank || '',
      chequeStatus: cheque ? (cheque.chequeStatus || 'pending') : ''
    };
  }

  buildCollectionLogsForPayments(payments, customerName, beforeReceived = 0) {
    let running = Money.round(beforeReceived);
    return payments
      .filter((payment) => this.isPaymentReceivedNow(payment) && Money.isPositive(payment.amount))
      .map((payment) => {
        const before = running;
        running = Money.add(running, payment.amount);
        return {
          customerName,
          amount: Money.round(payment.amount),
          method: payment.method,
          chequeAmount: payment.chequeAmount || payment.amount || 0,
          chequeDate: payment.chequeDate || '',
          chequeNumber: payment.chequeNumber || '',
          chequeBank: payment.chequeBank || '',
          paymentId: payment.id,
          action: 'invoice_payment',
          beforeReceived: before,
          afterReceived: running
        };
      });
  }
  syncChequeAmountToReceived() {
    if (this.isSplitPaymentActive()) return;
    const method = document.getElementById('payment-method')?.value || 'cash';
    if (method !== 'cheque') return;
    const chequeAmount = Money.clampZero(document.getElementById('cheque-amount')?.value || '0');
    const receivedInput = document.getElementById('received-amount');
    if (receivedInput) receivedInput.value = Money.isPositive(chequeAmount) ? chequeAmount.toFixed(2) : '';
    this.updatePaymentSummary();
  }
  getChequeDetails() {
    const method = document.getElementById('payment-method')?.value || 'cash';
    if (method !== 'cheque') {
      return {
        chequeAmount: 0,
        chequeDate: '',
        chequeNumber: '',
        chequeBank: ''
      };
    }

    const chequeAmount = Money.clampZero(document.getElementById('cheque-amount')?.value || '0');
    return {
      chequeAmount,
      chequeDate: document.getElementById('cheque-date')?.value || '',
      chequeNumber: (document.getElementById('cheque-number')?.value || '').trim(),
      chequeBank: (document.getElementById('cheque-bank')?.value || '').trim()
    };
  }

  validateChequeDetails(details) {
    if (!details.chequeDate || !details.chequeNumber || !details.chequeBank) {
      alert('Please fill cheque date, cheque number, and bank.');
      return false;
    }
    return true;
  }

  mapItemsForSave() {
    return this.items.map((i) => ({
      productId: i.productId !== null && i.productId !== undefined ? Number(i.productId) : null,
      name: (i.name || '').trim(),
      qty: Math.max(0.01, parseFloat(i.qty) || 1),
      unit: i.unit || 'pcs',
      price: Money.round(i.price),
      costPrice: Money.round(i.costPrice)
    }));
  }

  getInvalidItems(items) {
    return items.filter((i) => !i.name || i.price <= 0);
  }

  getUnmatchedInventoryItems(items) {
    return items.filter((item) => {
      const product = this.getProductById(item.productId) || this.getProductByName(item.name);
      return !product;
    });
  }

  buildQtyMap(items) {
    const map = new Map();
    items.forEach((item) => {
      const key = this.itemKey(item);
      if (!key || key === 'name:') return;
      if (!map.has(key)) {
        map.set(key, { qty: 0, itemRef: item });
      }
      map.get(key).qty += Math.max(0, parseFloat(item.qty) || 0);
    });
    return map;
  }

  buildStockDelta(previousItems, nextItems) {
    const prevMap = this.buildQtyMap(previousItems || []);
    const nextMap = this.buildQtyMap(nextItems || []);
    const keys = new Set([...prevMap.keys(), ...nextMap.keys()]);
    const deltas = [];

    keys.forEach((key) => {
      const prevQty = prevMap.get(key)?.qty || 0;
      const nextQty = nextMap.get(key)?.qty || 0;
      const delta = nextQty - prevQty;
      if (delta === 0) return;

      const ref = nextMap.get(key)?.itemRef || prevMap.get(key)?.itemRef || {};
      deltas.push({
        productId: ref.productId !== undefined ? ref.productId : null,
        name: ref.name || '',
        qty: Math.abs(delta),
        direction: delta > 0 ? 'deduct' : 'add'
      });
    });

    return deltas;
  }

  validateStockDelta(deltas) {
    const errors = [];
    deltas.forEach((entry) => {
      if (entry.direction !== 'deduct') return;

      const product = this.getProductById(entry.productId) || this.getProductByName(entry.name);
      if (!product) return;

      const currentStock = parseFloat(product.stock) || 0;
      if (currentStock < entry.qty) {
        errors.push(`${product.name}: available ${currentStock}, required ${entry.qty}`);
      }
    });
    return errors;
  }

  async applyStockDelta(deltas) {
    const toDeduct = deltas
      .filter((d) => d.direction === 'deduct')
      .map((d) => ({ productId: d.productId, name: d.name, qty: d.qty }));
    const toAdd = deltas
      .filter((d) => d.direction === 'add')
      .map((d) => ({ productId: d.productId, name: d.name, qty: d.qty }));

    if (toDeduct.length > 0) await window.db.deductStock(toDeduct);
    if (toAdd.length > 0) await window.db.addBackStock(toAdd);
  }

  setEditMode(bill) {
    this.editBillId = bill.id;
    this.editOriginalBill = bill;

    document.getElementById('btn-generate-bill').innerText = 'Update Bill';
    document.getElementById('btn-cancel-edit')?.classList.remove('hidden');

    document.getElementById('customer-name').value = bill.customerName || '';
    document.getElementById('customer-phone').value = bill.customerPhone || '';
    document.getElementById('customer-address').value = bill.customerAddress || '';
    const existingPayments = this.getBillPayments(bill);
    const chequePayment = existingPayments.find((payment) => payment.method === 'cheque');
    const hasChequeDetails = Boolean(
      chequePayment?.chequeDate || chequePayment?.chequeNumber || chequePayment?.chequeBank
      || bill.chequeDate || bill.chequeNumber || bill.chequeBank
    );
    const shouldUseSplit = Array.isArray(bill.payments) && bill.payments.length > 1;
    document.getElementById('payment-method').value = shouldUseSplit ? (existingPayments[0]?.method || 'cash') : (bill.paymentMethod || (hasChequeDetails ? 'cheque' : 'cash'));
    document.getElementById('received-amount').value = Number(bill.receivedAmount || 0);
    document.getElementById('cheque-amount').value = Number(
      chequePayment?.chequeAmount
      || chequePayment?.amount
      || bill.chequeAmount
      || (bill.paymentMethod === 'cheque' ? bill.receivedAmount : 0)
      || 0
    ) || '';
    document.getElementById('cheque-date').value = chequePayment?.chequeDate || bill.chequeDate || '';
    document.getElementById('cheque-number').value = chequePayment?.chequeNumber || bill.chequeNumber || '';
    document.getElementById('cheque-bank').value = chequePayment?.chequeBank || bill.chequeBank || '';
    if (shouldUseSplit) this.enableSplitPayments(existingPayments);
    else this.disableSplitPayments();

    this.items = (bill.items || []).map((item) => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
      productId: item.productId !== undefined ? item.productId : (this.getProductByName(item.name)?.id || null),
      name: item.name || '',
      qty: Math.max(0.01, parseFloat(item.qty) || 1),
      unit: item.unit || 'pcs',
      price: Number(item.price) || 0,
      costPrice: Number(item.costPrice || 0)
    }));
    if (this.items.length === 0) this.addItem();
    else this.renderItems();

    this.toggleChequeDetails();
    this.updatePaymentSummary();
    this.renderOutstandingHint(document.getElementById('customer-name').value || '');
    window.app.navigate('billing');
  }

  cancelEditMode() {
    this.editBillId = null;
    this.editOriginalBill = null;
    document.getElementById('btn-generate-bill').innerText = 'Generate & Share Bill';
    document.getElementById('btn-cancel-edit')?.classList.add('hidden');
    this.resetForm();
  }

  resetForm() {
    this.items = [];
    document.getElementById('customer-name').value = '';
    document.getElementById('customer-phone').value = '';
    document.getElementById('customer-address').value = '';
    document.getElementById('received-amount').value = '';
    document.getElementById('payment-method').value = 'cash';
    document.getElementById('payment-method').disabled = false;
    this.disableSplitPayments();
    document.getElementById('cheque-amount').value = '';
    document.getElementById('cheque-date').value = '';
    document.getElementById('cheque-number').value = '';
    document.getElementById('cheque-bank').value = '';
    this.toggleChequeDetails();
    this.addItem();
    this.renderOutstandingHint('');
    this.updatePaymentSummary();
  }

  async generateBill() {
    if (this._saving) return;
    this._saving = true;
    const _genBtn = document.getElementById('btn-generate-bill');
    if (_genBtn) _genBtn.disabled = true;
    try {
    try {
      await this.refreshProducts();
    } catch (error) {
      console.error('Failed to refresh products before saving bill:', error);
      alert('Unable to refresh product data. Please reload and try again.');
      return;
    }
    const mappedItems = this.mapItemsForSave();
    const invalidItems = this.getInvalidItems(mappedItems);
    if (invalidItems.length > 0) {
      alert('Please fill valid product names and prices.');
      return;
    }

    // Only enforce active-inventory check for NEW bills.
    // When editing, the product may have been archived after the original bill
    // was created — that should not block editing it.
    if (!this.editBillId) {
      const unmatchedItems = this.getUnmatchedInventoryItems(mappedItems);
      if (unmatchedItems.length > 0) {
        const names = unmatchedItems.map((item) => item.name || 'Unnamed item').join('\n');
        alert(`These items are not in active inventory:\n${names}\n\nAdd them in Inventory first, then create the bill.`);
        return;
      }
    }

    let customerName = document.getElementById('customer-name').value.trim();
    if (!customerName) customerName = 'Walk-in Customer';

    const customerPhone = document.getElementById('customer-phone').value.trim();
    const customerAddress = document.getElementById('customer-address').value.trim();
    const payments = this.normalizePaymentRowsForSave();
    if (!this.validatePaymentRows(payments)) return;
    const primaryPayment = this.getPrimaryPaymentFields(payments);
    const paymentMethod = primaryPayment.paymentMethod;
    const markAsCredit = primaryPayment.markAsCredit;
    const chequeDetails = {
      chequeAmount: primaryPayment.chequeAmount,
      chequeDate: primaryPayment.chequeDate,
      chequeNumber: primaryPayment.chequeNumber,
      chequeBank: primaryPayment.chequeBank
    };

    const receivedAmount = payments.reduce((sum, payment) => (
      this.isPaymentReceivedNow(payment) ? Money.add(sum, payment.amount) : sum
    ), 0);
    const total = Money.round(this.currentTotal);
    const balanceAmount = Money.clampZero(Money.subtract(total, receivedAmount));
    const changeAmount = Money.clampZero(Money.subtract(receivedAmount, total));
    const paymentStatus = Money.isPositive(balanceAmount) ? 'due' : 'paid';

    const nextBill = {
      customerName,
      customerPhone,
      customerAddress,
      items: mappedItems,
      total,
      paymentMethod,
      markAsCredit,
      payments,
      ...chequeDetails,
      chequeStatus: primaryPayment.chequeStatus,
      receivedAmount,
      balanceAmount,
      changeAmount,
      paymentStatus,
      billStatus: 'active',
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString()
    };
    let persistedBill = null;

    if (this.editBillId) {
      const oldBill = await window.db.getBillById(this.editBillId);
      if (!oldBill || oldBill.billStatus !== 'active') {
        alert('Only active bills can be edited.');
        this.cancelEditMode();
        return;
      }

      const deltas = this.buildStockDelta(oldBill.items || [], mappedItems);
      const stockErrors = this.validateStockDelta(deltas);
      if (stockErrors.length > 0) {
        alert(`Insufficient stock:\n${stockErrors.join('\n')}`);
        return;
      }

      nextBill.billNumber = oldBill.billNumber || oldBill.id;

      const oldReceived = Money.round(oldBill.receivedAmount || 0);
      const receivedDiff = Money.subtract(receivedAmount, oldReceived);
      const collectionLog = Money.toCents(receivedDiff) !== 0
        ? {
          billId: this.editBillId,
          customerName,
          amount: receivedDiff,
          method: paymentMethod,
          payments,
          action: 'bill_edit_adjustment',
          direction: receivedDiff > 0 ? 'increase' : 'decrease',
          beforeReceived: oldReceived,
          afterReceived: receivedAmount
        }
        : null;

      try {
        persistedBill = await window.db.updateBillWithStockAndCollectionLog({
          billId: this.editBillId,
          updates: nextBill,
          stockDeltas: deltas,
          collectionLog,
          auditLog: {
            action: 'bill_update',
            entity: 'bill',
            details: { customerName, total, receivedAmount }
          }
        });
      } catch (error) {
        console.error('Failed to update bill:', error);
        alert(error?.message || 'Failed to update bill. No changes were saved.');
        return;
      }
    } else {
      const deltas = this.buildStockDelta([], mappedItems);
      const stockErrors = this.validateStockDelta(deltas);
      if (stockErrors.length > 0) {
        alert(`Insufficient stock:\n${stockErrors.join('\n')}`);
        return;
      }

      try {
        persistedBill = await window.db.saveBillWithStockAndCollectionLog({
          bill: nextBill,
          stockDeltas: deltas,
          collectionLog: this.buildCollectionLogsForPayments(payments, customerName, 0),
          auditLog: {
            action: 'bill_create',
            entity: 'bill',
            details: { customerName, total, receivedAmount, paymentMethod }
          }
        });
      } catch (error) {
        console.error('Failed to save bill:', error);
        alert(error?.message || 'Failed to save bill. Please try again.');
        return;
      }
    }
    window.share.currentBill = persistedBill;

    let postSaveWarning = '';
    try {
      if (customerName.toLowerCase() !== 'walk-in customer') {
        await window.db.upsertCustomerByName(customerName, customerPhone, customerAddress);
      }
      await this.loadCustomerDirectory();
      await this.loadOutstandingDirectory();
      this.cancelEditMode();

      const refreshTasks = [];
      if (window.inventory) refreshTasks.push(window.inventory.render());
      if (window.historyView && window.app.currentPage === 'history') refreshTasks.push(window.historyView.render());
      if (window.collectionPage && window.app.currentPage === 'collection') refreshTasks.push(window.collectionPage.render());
      if (window.customersPage && window.app.currentPage === 'customers') refreshTasks.push(window.customersPage.render());

      const refreshResults = await Promise.allSettled(refreshTasks);
      if (refreshResults.some((result) => result.status === 'rejected')) {
        console.error('One or more post-save UI refresh operations failed:', refreshResults);
        postSaveWarning = 'Bill was saved, but some screens did not refresh. Please reload the app.';
      }
    } catch (error) {
      console.error('Post-save billing refresh failed:', error);
      postSaveWarning = 'Bill was saved, but app data did not fully refresh. Please reload the app.';
    }

    app.openModal('share-modal');
    if (postSaveWarning) alert(postSaveWarning);
    } finally {
      this._saving = false;
      if (_genBtn) _genBtn.disabled = false;
    }
  }
}

window.billing = new Billing();













