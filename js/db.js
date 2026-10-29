const DB_NAME = 'cashew_billing_db';
const DB_VERSION = 9;

const Money = (() => {
  const toCents = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100);
  };

  const fromCents = (cents) => {
    const n = Number(cents);
    if (!Number.isFinite(n)) return 0;
    return n / 100;
  };

  const round = (value) => fromCents(toCents(value));
  const add = (...values) => fromCents(values.reduce((sum, value) => sum + toCents(value), 0));
  const subtract = (left, right) => fromCents(toCents(left) - toCents(right));
  const multiply = (moneyValue, quantity) => round((Number(moneyValue) || 0) * (Number(quantity) || 0));
  const clampZero = (value) => fromCents(Math.max(0, toCents(value)));
  const isPositive = (value) => toCents(value) > 0;
  const isGreaterThan = (left, right) => toCents(left) > toCents(right);

  return { toCents, fromCents, round, add, subtract, multiply, clampZero, isPositive, isGreaterThan };
})();

window.Money = Money;

class Database {
  constructor() {
    this.db = null;
  }

  normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  normalizeBillMoney(bill) {
    if (!bill) return bill;
    const total = Money.round(bill.total || 0);
    const billStatus = bill.billStatus || 'active';
    const rawReceivedAmount = Money.round(bill.receivedAmount || 0);
    const method = this.normalizeText(bill.paymentMethod || (bill.markAsCredit ? 'credit' : ''));
    const rawPayments = Array.isArray(bill.payments)
      ? bill.payments.map((payment) => ({
        ...payment,
        method: this.normalizeText(payment.method || 'cash') || 'cash',
        amount: Money.clampZero(payment.amount || 0),
        chequeAmount: payment.chequeAmount !== undefined ? Money.clampZero(payment.chequeAmount || payment.amount || 0) : payment.chequeAmount
      }))
      : bill.payments;
    const effectivePaymentsReceived = Array.isArray(rawPayments)
      ? rawPayments.reduce((sum, payment) => {
        if (payment.method === 'credit') return sum;
        if (payment.method === 'cheque' && ['bounced', 'returned'].includes(payment.chequeStatus)) return sum;
        return Money.add(sum, payment.amount || 0);
      }, 0)
      : 0;
    const legacyChequeReceived = method === 'cheque' && !['bounced', 'returned'].includes(bill.chequeStatus)
      ? Money.clampZero(bill.chequeAmount || bill.receivedAmount || 0)
      : 0;
    const receivedAmount = (() => {
      if (billStatus !== 'active') return rawReceivedAmount;
      if (Array.isArray(rawPayments) && rawPayments.length) return effectivePaymentsReceived;
      if (method === 'cheque') return legacyChequeReceived;
      return rawReceivedAmount;
    })();
    const balanceAmount = Number.isFinite(Number(bill.balanceAmount))
      ? (billStatus === 'active' ? Money.clampZero(Money.subtract(total, receivedAmount)) : Money.clampZero(bill.balanceAmount))
      : Money.clampZero(Money.subtract(total, receivedAmount));
    const changeAmount = Number.isFinite(Number(bill.changeAmount))
      ? Money.clampZero(bill.changeAmount)
      : Money.clampZero(Money.subtract(receivedAmount, total));

    return {
      ...bill,
      total,
      receivedAmount,
      balanceAmount,
      changeAmount,
      payments: rawPayments,
      paymentStatus: billStatus === 'active'
        ? (Money.isPositive(balanceAmount) ? 'due' : 'paid')
        : (bill.paymentStatus || billStatus)
    };
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject('IndexedDB error');

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('bills')) {
          db.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('customers')) {
          db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('collection_logs')) {
          db.createObjectStore('collection_logs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('inventory_logs')) {
          db.createObjectStore('inventory_logs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('expenses')) {
          db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('audit_logs')) {
          db.createObjectStore('audit_logs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  async addProduct(name, stock = 0, billingPrice = 0, invoicePrice = 0, reorderLevel = 5) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return { ok: false, error: 'Product name is required.' };
    }

    const all = await this.getProducts(true);
    const exists = all.some((p) => this.normalizeText(p.name) === this.normalizeText(normalizedName));
    if (exists) {
      return { ok: false, error: 'Product already exists. Use a unique name.' };
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');
      const now = new Date().getTime();
      store.add({
        name: normalizedName,
        stock: Math.max(0, parseFloat(stock) || 0),
        billingPrice: parseFloat(billingPrice) || 0,
        invoicePrice: parseFloat(invoicePrice) || 0,
        reorderLevel: Math.max(0, parseFloat(reorderLevel) || 5),
        inactive: false,
        created_at: now,
        updated_at: now
      });
      tx.oncomplete = () => resolve({ ok: true });
    });
  }

  async addInventoryLog(log) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('inventory_logs', 'readwrite');
      const store = tx.objectStore('inventory_logs');
      const payload = {
        ...log,
        timestamp: log.timestamp || new Date().getTime()
      };
      const req = store.add(payload);
      req.onsuccess = () => resolve(req.result);
    });
  }

  async getInventoryLogs() {
    return new Promise((resolve) => {
      const store = this.db.transaction('inventory_logs', 'readonly').objectStore('inventory_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sorted);
      };
    });
  }

  async updateProduct(id, updates) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');
      const req = store.get(id);
      req.onsuccess = (e) => {
        try {
          if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new Error('Invalid product update payload.');
          }
          let product = e.target.result;
          if (product) {
            if ('stock' in product) product.stock = Math.max(0, parseFloat(product.stock) || 0);
            if ('stock' in updates) {
              updates.stock = Math.max(0, parseFloat(updates.stock) || 0);
            }
            product = { ...product, ...updates, updated_at: new Date().getTime() };
            store.put(product);
          }
          resolve(product || null);
        } catch (err) {
          tx.abort();
          reject(err);
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to read product.'));
      tx.onerror = () => reject(tx.error || new Error('Failed to update product.'));
    });
  }

  async deleteProduct(id) {
    return this.updateProduct(Number(id), {
      inactive: true,
      inactive_at: new Date().getTime()
    }).then((product) => Boolean(product));
  }

  async restoreProduct(id) {
    return this.updateProduct(Number(id), {
      inactive: false,
      inactive_at: null,
      restored_at: new Date().getTime()
    }).then((product) => Boolean(product));
  }

  findProductForItem(products, item) {
    if (item && item.productId !== undefined && item.productId !== null && item.productId !== '') {
      const numericId = Number(item.productId);
      const byId = products.find((p) => Number(p.id) === numericId);
      if (byId) return byId;
    }

    const itemName = this.normalizeText(item?.name);
    if (!itemName) return null;
    return products.find((p) => this.normalizeText(p.name) === itemName) || null;
  }

  applyStockDeltaToStore(products, store, items, direction = 'deduct') {
    (items || []).forEach((item) => {
      const qty = parseFloat(item.qty) || 0;
      if (qty <= 0) return;

      const prod = this.findProductForItem(products, item);
      if (!prod) return;

      const current = parseFloat(prod.stock) || 0;
      prod.stock = Math.max(0, direction === 'add' ? current + qty : current - qty);
      prod.updated_at = new Date().getTime();
      store.put(prod);
    });
  }

  applyDeltasToStore(products, store, deltas) {
    (deltas || []).forEach((delta) => {
      this.applyStockDeltaToStore(products, store, [delta], delta.direction === 'add' ? 'add' : 'deduct');
    });
  }

  async deductStock(items) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');

      tx.oncomplete = () => resolve();

      const req = store.getAll();
      req.onsuccess = (e) => {
        const products = e.target.result || [];
        items.forEach((item) => {
          const qty = parseFloat(item.qty) || 0;
          if (qty <= 0) return;

          const prod = this.findProductForItem(products, item);
          if (!prod) return;
          prod.stock = Math.max(0, (parseFloat(prod.stock) || 0) - qty);
          store.put(prod);
        });
      };
    });
  }

  async addBackStock(items) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');

      tx.oncomplete = () => resolve();

      const req = store.getAll();
      req.onsuccess = (e) => {
        const products = e.target.result || [];
        items.forEach((item) => {
          const qty = parseFloat(item.qty) || 0;
          if (qty <= 0) return;

          const prod = this.findProductForItem(products, item);
          if (!prod) return;
          prod.stock = Math.max(0, (parseFloat(prod.stock) || 0) + qty);
          store.put(prod);
        });
      };
    });
  }

  async cancelBillAndReturnStock({ billId, updates, itemsToReturn = [] }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(billId);
      const tx = this.db.transaction(['bills', 'products'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const productsStore = tx.objectStore('products');
      let updatedBill = null;

      const billReq = billsStore.get(numericId);
      billReq.onsuccess = () => {
        const existing = billReq.result;
        if (!existing) {
          tx.abort();
          return;
        }
        if ((existing.billStatus || 'active') !== 'active') {
          tx.abort();
          return;
        }

        updatedBill = { ...existing, ...updates, updated_at: new Date().getTime() };
        billsStore.put(updatedBill);

        if (itemsToReturn.length > 0) {
          const productsReq = productsStore.getAll();
          productsReq.onsuccess = () => {
            this.applyStockDeltaToStore(productsReq.result || [], productsStore, itemsToReturn, 'add');
          };
        }
      };

      tx.oncomplete = () => resolve(updatedBill);
      tx.onerror = () => reject(tx.error || new Error('Failed to cancel/return bill.'));
      tx.onabort = () => reject(new Error('Bill not found or already closed.'));
    });
  }

  async saveBillWithStockAndCollectionLog({ bill, stockDeltas = [], collectionLog = null, auditLog = null }) {
    return new Promise((resolve, reject) => {
      const now = new Date().getTime();
      const tx = this.db.transaction(['settings', 'bills', 'products', 'collection_logs', 'audit_logs'], 'readwrite');
      const settingsStore = tx.objectStore('settings');
      const billsStore = tx.objectStore('bills');
      const productsStore = tx.objectStore('products');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let savedBill = null;

      const counterReq = settingsStore.get('bill_counter');
      counterReq.onsuccess = () => {
        const currentCounter = Number(counterReq.result?.value || 0);
        const existingBillsReq = billsStore.getAll();
        existingBillsReq.onsuccess = () => {
          const maxExistingBillNumber = (existingBillsReq.result || []).reduce((max, item) => {
            const num = Number(item.billNumber || item.id || 0);
            return num > max ? num : max;
          }, 0);
          const requestedBillNumber = Number(bill.billNumber || 0);
          const currentMax = Math.max(currentCounter, maxExistingBillNumber);
          const nextBillNumber = requestedBillNumber > currentMax
            ? requestedBillNumber
            : currentMax + 1;
          settingsStore.put({ key: 'bill_counter', value: Math.max(currentMax, nextBillNumber) });

          const productsReq = productsStore.getAll();
          productsReq.onsuccess = () => {
            this.applyDeltasToStore(productsReq.result || [], productsStore, stockDeltas);

            const payload = {
              ...bill,
              billNumber: nextBillNumber,
              timestamp: now,
              billStatus: bill.billStatus || 'active'
            };
            if (this.normalizeText(payload.paymentMethod) === 'cheque' && !payload.chequeStatus) {
              payload.chequeStatus = 'pending';
            }

            const billReq = billsStore.add(payload);
            billReq.onsuccess = () => {
              savedBill = { ...payload, id: billReq.result };

              if (collectionLog) {
                const logs = Array.isArray(collectionLog) ? collectionLog : [collectionLog];
                logs.forEach((log) => {
                  logsStore.add({
                    ...log,
                    billId: savedBill.id,
                    billNumber: savedBill.billNumber,
                    timestamp: now
                  });
                });
              }

              if (auditLog) {
                auditStore.add({
                  ...auditLog,
                  entityId: savedBill.id,
                  details: {
                    ...(auditLog.details || {}),
                    billNumber: savedBill.billNumber
                  },
                  timestamp: now
                });
              }
            };
          };
        };
      };

      tx.oncomplete = () => resolve(savedBill);
      tx.onerror = () => reject(tx.error || new Error('Failed to save bill.'));
    });
  }

  getBillPaymentsForCollection(bill) {
    if (Array.isArray(bill?.payments) && bill.payments.length) return bill.payments;
    const method = this.normalizeText(bill?.paymentMethod || 'cash') || 'cash';
    const amount = Money.clampZero(bill?.receivedAmount || 0);
    if (!Money.isPositive(amount)) return [];
    return [{
      id: 'legacy-payment-1',
      method,
      amount,
      chequeDate: bill?.chequeDate || '',
      chequeNumber: bill?.chequeNumber || '',
      chequeBank: bill?.chequeBank || '',
      chequeStatus: method === 'cheque' ? (bill?.chequeStatus || 'pending') : ''
    }];
  }

  async collectBillPaymentAtomic({ billId, amount, method = 'cash', chequeDetails = {}, payment = null, auditLog = null }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(billId);
      const collectAmount = Money.round(amount);
      if (!numericId || collectAmount <= 0) {
        reject(new Error('Enter a valid collection amount.'));
        return;
      }

      const now = new Date().getTime();
      const finalMethod = this.normalizeText(method || 'cash') || 'cash';
      const tx = this.db.transaction(['bills', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;
      let abortMessage = 'Failed to collect payment.';

      const billReq = billsStore.get(numericId);
      billReq.onsuccess = () => {
        const bill = billReq.result;
        if (!bill) {
          abortMessage = 'Bill not found.';
          tx.abort();
          return;
        }
        if ((bill.billStatus || 'active') !== 'active') {
          abortMessage = 'This bill is not active.';
          tx.abort();
          return;
        }

        const total = Money.round(bill.total);
        const received = Money.round(bill.receivedAmount || 0);
        const balance = Money.clampZero(Money.subtract(total, received));
        if (Money.isGreaterThan(collectAmount, balance)) {
          abortMessage = `Amount is greater than due. Maximum collectable is LKR ${balance.toLocaleString()}.`;
          tx.abort();
          return;
        }

        const nextReceived = Money.add(received, collectAmount);
        const nextBalance = Money.clampZero(Money.subtract(total, nextReceived));
        const nextChange = Money.clampZero(Money.subtract(nextReceived, total));
        const paymentRow = payment || {
          id: `pay-${now}-${Math.random().toString(36).slice(2, 6)}`,
          method: finalMethod,
          amount: collectAmount,
          chequeDate: finalMethod === 'cheque' ? chequeDetails.chequeDate || '' : '',
          chequeNumber: finalMethod === 'cheque' ? chequeDetails.chequeNumber || '' : '',
          chequeBank: finalMethod === 'cheque' ? chequeDetails.chequeBank || '' : '',
          chequeStatus: finalMethod === 'cheque' ? 'pending' : ''
        };
        paymentRow.amount = Money.round(paymentRow.amount);
        if (paymentRow.chequeAmount !== undefined) paymentRow.chequeAmount = Money.round(paymentRow.chequeAmount);
        const nextPayments = [...this.getBillPaymentsForCollection(bill), paymentRow];

        updatedBill = {
          ...bill,
          receivedAmount: nextReceived,
          balanceAmount: nextBalance,
          changeAmount: nextChange,
          payments: nextPayments,
          paymentMethod: nextPayments.length > 1 ? 'multiple' : finalMethod,
          lastCollectionMethod: finalMethod,
          ...(finalMethod === 'cheque' ? { ...chequeDetails, chequeStatus: bill.chequeStatus || 'pending' } : {}),
          paymentStatus: nextBalance > 0 ? 'due' : 'paid',
          updated_at: now
        };
        billsStore.put(updatedBill);

        logsStore.add({
          billId: numericId,
          customerName: bill.customerName || 'Walk-in Customer',
          amount: collectAmount,
          method: finalMethod,
          paymentId: paymentRow.id,
          ...chequeDetails,
          action: 'collection',
          beforeReceived: received,
          afterReceived: nextReceived,
          timestamp: now
        });

        if (auditLog) {
          auditStore.add({
            ...auditLog,
            entityId: numericId,
            timestamp: now
          });
        }
      };

      tx.oncomplete = () => resolve(updatedBill);
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }
  async updateBillWithStockAndCollectionLog({ billId, updates, stockDeltas = [], collectionLog = null, auditLog = null }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(billId);
      const now = new Date().getTime();
      const tx = this.db.transaction(['bills', 'products', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const productsStore = tx.objectStore('products');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;

      const billReq = billsStore.get(numericId);
      billReq.onsuccess = () => {
        const existing = billReq.result;
        if (!existing) {
          tx.abort();
          return;
        }

        updatedBill = {
          ...existing,
          ...updates,
          updated_at: now
        };
        billsStore.put(updatedBill);

        const productsReq = productsStore.getAll();
        productsReq.onsuccess = () => {
          this.applyDeltasToStore(productsReq.result || [], productsStore, stockDeltas);
        };

        if (collectionLog) {
          logsStore.add({
            ...collectionLog,
            billId: numericId,
            timestamp: now
          });
        }

        if (auditLog) {
          auditStore.add({
            ...auditLog,
            entityId: numericId,
            timestamp: now
          });
        }
      };

      tx.oncomplete = () => resolve(updatedBill);
      tx.onerror = () => reject(tx.error || new Error('Failed to update bill.'));
      tx.onabort = () => reject(new Error('Bill not found.'));
    });
  }

  async getProducts(includeInactive = false) {
    return new Promise((resolve) => {
      const store = this.db.transaction('products', 'readonly').objectStore('products');
      const req = store.getAll();
      req.onsuccess = () => {
        const products = req.result || [];
        products.forEach((p) => {
          if ('stock' in p) p.stock = Math.max(0, parseFloat(p.stock) || 0);
        });
        resolve(includeInactive ? products : products.filter((p) => !p.inactive));
      };
    });
  }

  async getCustomers() {
    return new Promise((resolve) => {
      const store = this.db.transaction('customers', 'readonly').objectStore('customers');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        resolve(sorted);
      };
    });
  }

  async updateCustomer(id, updates) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const req = store.get(id);
      req.onsuccess = (e) => {
        let customer = e.target.result;
        if (customer) {
          customer = { ...customer, ...updates, updated_at: new Date().getTime() };
          store.put(customer);
        }
        resolve();
      };
    });
  }

  async renameCustomerInBills(oldName, updates) {
    const previousName = String(oldName || '').trim();
    const nextName = String(updates.name || '').trim();
    if (!previousName || !nextName) return 0;

    return new Promise((resolve) => {
      const tx = this.db.transaction('bills', 'readwrite');
      const store = tx.objectStore('bills');
      const req = store.getAll();
      let updatedCount = 0;

      req.onsuccess = () => {
        (req.result || []).forEach((bill) => {
          if (this.normalizeText(bill.customerName) !== this.normalizeText(previousName)) return;
          const next = {
            ...bill,
            customerName: nextName,
            updated_at: new Date().getTime()
          };
          if (updates.phone) next.customerPhone = updates.phone;
          if (updates.address) next.customerAddress = updates.address;
          store.put(next);
          updatedCount += 1;
        });
      };

      tx.oncomplete = () => resolve(updatedCount);
      tx.onerror = () => resolve(updatedCount);
    });
  }

  async addCustomer(name, phone = '', address = '') {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return { ok: false, error: 'Customer name is required.' };
    }

    const all = await this.getCustomers();
    const exists = all.some((c) => this.normalizeText(c.name) === this.normalizeText(normalizedName));
    if (exists) {
      return { ok: false, error: 'Customer already exists.' };
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const now = new Date().getTime();
      const req = store.add({
        name: normalizedName,
        phone: (phone || '').trim(),
        address: (address || '').trim(),
        created_at: now,
        updated_at: now
      });
      req.onsuccess = () => resolve({ ok: true, id: req.result });
      req.onerror = () => resolve({ ok: false, error: 'Failed to add customer.' });
    });
  }

  async deleteCustomer(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const req = store.delete(Number(id));
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  async upsertCustomerByName(name, phone = '', address = '') {
    return new Promise((resolve) => {
      const normalizedName = (name || '').trim();
      if (!normalizedName) {
        resolve();
        return;
      }

      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const req = store.getAll();

      req.onsuccess = () => {
        const all = req.result || [];
        const existing = all.find((c) => this.normalizeText(c.name) === this.normalizeText(normalizedName));
        const now = new Date().getTime();

        if (existing) {
          const next = { ...existing, updated_at: now };
          if (phone && !(existing.phone || '').trim()) next.phone = phone;
          if (address && !(existing.address || '').trim()) next.address = address;
          store.put(next);
        } else {
          store.add({
            name: normalizedName,
            phone: (phone || '').trim(),
            address: (address || '').trim(),
            created_at: now,
            updated_at: now
          });
        }
      };

      tx.oncomplete = () => resolve();
    });
  }

  async syncCustomersFromBills() {
    const bills = await this.getBills();
    for (const bill of bills) {
      const name = (bill.customerName || '').trim();
      if (!name || name.toLowerCase() === 'walk-in customer') continue;
      await this.upsertCustomerByName(name, bill.customerPhone || '', bill.customerAddress || '');
    }
  }

  async saveBill() {
    // DEPRECATED ??? this method bypasses stock deduction, collection logs, and audit logs.
    // Always use saveBillWithStockAndCollectionLog() instead.
    throw new Error('saveBill() is deprecated. Use saveBillWithStockAndCollectionLog().');
  }

  async deleteBillAndReturnStock({ billId, returnStock = false }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(billId);
      const tx = this.db.transaction(['bills', 'products', 'collection_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const productsStore = tx.objectStore('products');
      const logsStore = tx.objectStore('collection_logs');

      const billReq = billsStore.get(numericId);
      billReq.onsuccess = () => {
        const bill = billReq.result;
        if (!bill) {
          tx.abort();
          return;
        }

        // Delete bill and its collection logs in the same transaction.
        billsStore.delete(numericId);
        const logsReq = logsStore.getAll();
        logsReq.onsuccess = () => {
          (logsReq.result || []).forEach((log) => {
            if (Number(log.billId) === numericId) logsStore.delete(log.id);
          });
        };

        // Return stock atomically ??? only if the bill was active and caller requested it.
        if (returnStock && Array.isArray(bill.items) && bill.items.length > 0) {
          const productsReq = productsStore.getAll();
          productsReq.onsuccess = () => {
            this.applyStockDeltaToStore(productsReq.result || [], productsStore, bill.items, 'add');
          };
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Failed to delete bill.'));
      tx.onabort = () => resolve(false);
    });
  }

  async updateBill(id, updates) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('bills', 'readwrite');
      const store = tx.objectStore('bills');
      const req = store.get(id);
      req.onsuccess = (e) => {
        try {
          if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new Error('Invalid bill update payload.');
          }
          const bill = e.target.result;
          if (!bill) {
            resolve(null);
            return;
          }
          const next = { ...bill, ...updates, updated_at: new Date().getTime() };
          store.put(next);
          resolve(next);
        } catch (err) {
          tx.abort();
          reject(err);
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to read bill.'));
      tx.onerror = () => reject(tx.error || new Error('Failed to update bill.'));
    });
  }

  async deleteBill(id) {
    return new Promise((resolve) => {
      const numericId = Number(id);
      const tx = this.db.transaction(['bills', 'collection_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const logsStore = tx.objectStore('collection_logs');

      billsStore.delete(numericId);

      const logsReq = logsStore.getAll();
      logsReq.onsuccess = () => {
        (logsReq.result || []).forEach((log) => {
          if (Number(log.billId) === numericId) {
            logsStore.delete(log.id);
          }
        });
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async getBillById(id) {
    return new Promise((resolve) => {
      const store = this.db.transaction('bills', 'readonly').objectStore('bills');
      const req = store.get(id);
      req.onsuccess = () => resolve(this.normalizeBillMoney(req.result) || null);
      req.onerror = () => resolve(null);
    });
  }

  async getBills() {
    return new Promise((resolve) => {
      const store = this.db.transaction('bills', 'readonly').objectStore('bills');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || [])
          .map((bill) => this.normalizeBillMoney(bill))
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sorted);
      };
    });
  }

  async addCollectionLog(log) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('collection_logs', 'readwrite');
      const store = tx.objectStore('collection_logs');
      const payload = {
        ...log,
        timestamp: log.timestamp || new Date().getTime()
      };
      const req = store.add(payload);
      req.onsuccess = () => resolve(req.result);
    });
  }

  async getCollectionLogs() {
    return new Promise((resolve) => {
      const store = this.db.transaction('collection_logs', 'readonly').objectStore('collection_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sorted);
      };
    });
  }

  async getCollectionLogsByBill(billId) {
    const all = await this.getCollectionLogs();
    return all.filter((log) => Number(log.billId) === Number(billId));
  }

  async addExpense(expense) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('expenses', 'readwrite');
      const store = tx.objectStore('expenses');
      const now = new Date().getTime();
      const payload = {
        name: String(expense.name || '').trim(),
        amount: parseFloat(expense.amount) || 0,
        category: String(expense.category || 'Other').trim() || 'Other',
        date: expense.date || new Date().toISOString().slice(0, 10),
        note: String(expense.note || '').trim(),
        timestamp: expense.timestamp || now,
        created_at: now
      };
      const req = store.add(payload);
      req.onsuccess = () => resolve({ ok: true, id: req.result });
      req.onerror = () => resolve({ ok: false, error: 'Failed to add expense.' });
    });
  }

  async getExpenses() {
    return new Promise((resolve) => {
      const store = this.db.transaction('expenses', 'readonly').objectStore('expenses');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sorted);
      };
    });
  }

  async updateExpense(id, updates) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('expenses', 'readwrite');
      const store = tx.objectStore('expenses');
      const req = store.get(Number(id));
      req.onsuccess = (e) => {
        const expense = e.target.result;
        if (!expense) {
          resolve(null);
          return;
        }
        const next = {
          ...expense,
          ...updates,
          name: String(updates.name ?? expense.name ?? '').trim(),
          amount: parseFloat(updates.amount ?? expense.amount) || 0,
          category: String(updates.category ?? expense.category ?? 'Other').trim() || 'Other',
          note: String(updates.note ?? expense.note ?? '').trim(),
          updated_at: new Date().getTime()
        };
        store.put(next);
        resolve(next);
      };
      req.onerror = () => resolve(null);
    });
  }

  async deleteExpense(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('expenses', 'readwrite');
      const store = tx.objectStore('expenses');
      const req = store.delete(Number(id));
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  async addAuditLog(log) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('audit_logs', 'readwrite');
      const store = tx.objectStore('audit_logs');
      const payload = {
        action: String(log.action || 'unknown'),
        entity: String(log.entity || ''),
        entityId: log.entityId ?? null,
        details: log.details || {},
        timestamp: log.timestamp || new Date().getTime()
      };
      const req = store.add(payload);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async getAuditLogs() {
    return new Promise((resolve) => {
      const store = this.db.transaction('audit_logs', 'readonly').objectStore('audit_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sorted);
      };
    });
  }

  async saveSetting(key, value) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ key, value });
      tx.oncomplete = () => resolve();
    });
  }

  async getSetting(key) {
    return new Promise((resolve) => {
      const store = this.db.transaction('settings', 'readonly').objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    });
  }

  async getNextBillNumber() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings', 'bills'], 'readwrite');
      const settingsStore = tx.objectStore('settings');
      const billsStore = tx.objectStore('bills');
      let next = 1;

      const counterReq = settingsStore.get('bill_counter');
      counterReq.onsuccess = () => {
        const currentCounter = Number(counterReq.result?.value || 0);
        const billsReq = billsStore.getAll();
        billsReq.onsuccess = () => {
          const maxExistingBillNumber = (billsReq.result || []).reduce((max, bill) => {
            const num = Number(bill.billNumber || bill.id || 0);
            return num > max ? num : max;
          }, 0);
          next = Math.max(currentCounter, maxExistingBillNumber) + 1;
          settingsStore.put({ key: 'bill_counter', value: next });
        };
        billsReq.onerror = () => tx.abort();
      };
      counterReq.onerror = () => tx.abort();
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error || new Error('Failed to reserve bill number.'));
      tx.onabort = () => reject(tx.error || new Error('Failed to reserve bill number.'));
    });
  }

  async recalculateBillCounter() {
    const bills = await this.getBills();
    let maxNum = 0;
    bills.forEach((bill) => {
      const num = Number(bill.billNumber || bill.id || 0);
      if (num > maxNum) maxNum = num;
    });
    await this.saveSetting('bill_counter', maxNum);
  }

  async saveImportRollback(payload) {
    const snapshots = await this.getImportRollbacks();
    const next = [{
      id: new Date().getTime(),
      savedAt: new Date().toISOString(),
      payload
    }, ...snapshots].slice(0, 3);
    await this.saveSetting('import_rollbacks', next);
    return this.saveSetting('import_rollback', payload);
  }

  async getImportRollback() {
    return this.getSetting('import_rollback');
  }

  async getImportRollbacks() {
    const snapshots = await this.getSetting('import_rollbacks');
    if (Array.isArray(snapshots)) return snapshots;
    const legacy = await this.getImportRollback();
    return legacy ? [{ id: 0, savedAt: legacy.exportedAt || '', payload: legacy }] : [];
  }

  async clearImportRollback() {
    return new Promise((resolve) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.delete('import_rollback');
      store.delete('import_rollbacks');
      tx.oncomplete = () => resolve();
    });
  }

  async exportAllData() {
    const [products, customers, bills, collectionLogs, inventoryLogs, expenses, auditLogs] = await Promise.all([
      this.getProducts(true),
      this.getCustomers(),
      this.getBills(),
      this.getCollectionLogs(),
      this.getInventoryLogs(),
      this.getExpenses(),
      this.getAuditLogs()
    ]);
    return {
      app: 'LynkBay Cashew Billing',
      exportedAt: new Date().toISOString(),
      schemaVersion: DB_VERSION,
      data: {
        products,
        customers,
        bills,
        collectionLogs,
        inventoryLogs,
        expenses,
        auditLogs
      }
    };
  }

  validateBackupRecordList(name, value) {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid backup: ${name} must be a list.`);
    }
  }

  validateUniqueIds(name, rows) {
    const seen = new Set();
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`Invalid backup: ${name} row ${index + 1} is not valid.`);
      }
      if (row.id === undefined || row.id === null || row.id === '') return;
      const key = String(row.id);
      if (seen.has(key)) {
        throw new Error(`Invalid backup: duplicate ${name} id ${key}.`);
      }
      seen.add(key);
    });
  }

  validateBackupPayload(payload) {
    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
      throw new Error('Invalid backup file.');
    }

    if (payload.app && payload.app !== 'LynkBay Cashew Billing') {
      throw new Error('This backup is not for LynkBay Cashew Billing.');
    }

    const version = Number(payload.schemaVersion || 1);
    if (version > DB_VERSION) {
      throw new Error('This backup was created by a newer app version. Update the app before importing.');
    }

    const data = payload.data;
    ['products', 'customers', 'bills', 'collectionLogs', 'inventoryLogs', 'expenses', 'auditLogs'].forEach((key) => {
      this.validateBackupRecordList(key, data[key] || []);
      this.validateUniqueIds(key, data[key] || []);
    });

    (data.products || []).forEach((product) => {
      if (!String(product.name || '').trim()) throw new Error('Invalid backup: product name is required.');
      if (Number(product.stock || 0) < 0) throw new Error(`Invalid backup: negative stock for ${product.name}.`);
      if (Number(product.billingPrice || 0) < 0 || Number(product.invoicePrice || 0) < 0) {
        throw new Error(`Invalid backup: negative price for ${product.name}.`);
      }
    });

    (data.bills || []).forEach((bill) => {
      if (!Array.isArray(bill.items)) throw new Error(`Invalid backup: bill ${bill.id || ''} has no item list.`);
      if (Number(bill.total || 0) < 0) throw new Error(`Invalid backup: bill ${bill.id || ''} has negative total.`);
      bill.items.forEach((item) => {
        if (!String(item.name || '').trim()) throw new Error(`Invalid backup: bill ${bill.id || ''} has an item without a name.`);
        if (Number(item.qty || 0) <= 0) throw new Error(`Invalid backup: bill ${bill.id || ''} has invalid quantity.`);
        if (Number(item.price || 0) < 0) throw new Error(`Invalid backup: bill ${bill.id || ''} has negative price.`);
      });
    });
  }

  async importAllData(payload) {
    this.validateBackupPayload(payload);

    const products = Array.isArray(payload.data.products) ? payload.data.products : [];
    const customers = Array.isArray(payload.data.customers) ? payload.data.customers : [];
    const bills = Array.isArray(payload.data.bills) ? payload.data.bills : [];
    const collectionLogs = Array.isArray(payload.data.collectionLogs) ? payload.data.collectionLogs : [];
    const inventoryLogs = Array.isArray(payload.data.inventoryLogs) ? payload.data.inventoryLogs : [];
    const expenses = Array.isArray(payload.data.expenses) ? payload.data.expenses : [];
    const auditLogs = Array.isArray(payload.data.auditLogs) ? payload.data.auditLogs : [];

    // Preserve rollback snapshots before clearing settings
    const rollbacks = await this.getImportRollbacks();
    const legacyRollback = await this.getImportRollback();

    await new Promise((resolve, reject) => {
      // Include 'settings' so the stale bill_counter and rollback snapshots
      // from the previous session are cleared. recalculateBillCounter() below
      // will re-derive the correct counter from the imported bills.
      const tx = this.db.transaction(['products', 'customers', 'bills', 'collection_logs', 'inventory_logs', 'expenses', 'audit_logs', 'settings'], 'readwrite');
      const productsStore = tx.objectStore('products');
      const customersStore = tx.objectStore('customers');
      const billsStore = tx.objectStore('bills');
      const logsStore = tx.objectStore('collection_logs');
      const inventoryLogsStore = tx.objectStore('inventory_logs');
      const expensesStore = tx.objectStore('expenses');
      const auditLogsStore = tx.objectStore('audit_logs');
      const settingsStore = tx.objectStore('settings');

      productsStore.clear();
      customersStore.clear();
      billsStore.clear();
      logsStore.clear();
      inventoryLogsStore.clear();
      expensesStore.clear();
      auditLogsStore.clear();
      settingsStore.clear();

      products.forEach((item) => productsStore.put(item));
      customers.forEach((item) => customersStore.put(item));
      bills.forEach((item) => billsStore.put(item));
      collectionLogs.forEach((item) => logsStore.put(item));
      inventoryLogs.forEach((item) => inventoryLogsStore.put(item));
      expenses.forEach((item) => expensesStore.put(item));
      auditLogs.forEach((item) => auditLogsStore.put(item));

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Failed to import backup.'));
    });

    // Restore rollback snapshots after import
    if (rollbacks.length > 0) {
      await this.saveSetting('import_rollbacks', rollbacks);
    }
    if (legacyRollback) {
      await this.saveSetting('import_rollback', legacyRollback);
    }

    await this.recalculateBillCounter();
  }
}

window.Database = Database;

const REMOTE_DB_METHODS = [
  'addProduct',
  'addInventoryLog',
  'getInventoryLogs',
  'updateProduct',
  'deleteProduct',
  'restoreProduct',
  'deductStock',
  'addBackStock',
  'cancelBillAndReturnStock',
  'saveBillWithStockAndCollectionLog',
  'collectBillPaymentAtomic',
  'updateBillWithStockAndCollectionLog',
  'getProducts',
  'getCustomers',
  'updateCustomer',
  'renameCustomerInBills',
  'addCustomer',
  'deleteCustomer',
  'upsertCustomerByName',
  'syncCustomersFromBills',
  'deleteBillAndReturnStock',
  'updateBill',
  'deleteBill',
  'getBillById',
  'getBills',
  'addCollectionLog',
  'getCollectionLogs',
  'getCollectionLogsByBill',
  'addExpense',
  'getExpenses',
  'updateExpense',
  'deleteExpense',
  'addAuditLog',
  'getAuditLogs',
  'saveSetting',
  'getSetting',
  'getNextBillNumber',
  'recalculateBillCounter',
  'saveImportRollback',
  'getImportRollback',
  'getImportRollbacks',
  'clearImportRollback',
  'exportAllData',
  'importAllData'
];

class SyncCapableDatabase extends Database {
  constructor() {
    super();
    this.remote = false;
    this.cloud = null;
  }

  apiUrl(path) {
    const baseUrl = String(window.LYNKBAY_API_BASE_URL || '').replace(/\/+$/, '');
    return `${baseUrl}${path}`;
  }

  async init() {
    if (window.LYNKBAY_SUPABASE_URL && window.LYNKBAY_SUPABASE_ANON_KEY && window.LYNKBAY_SUPABASE_SYNC_SECRET) {
      await super.init();
      this.cloud = new SupabaseStateSync(this);
      await this.cloud.init();
      return;
    }

    if (window.location && window.location.protocol !== 'file:') {
      try {
        const response = await fetch(this.apiUrl('/api/health'), { cache: 'no-store' });
        this.remote = response.ok;
      } catch (err) {
        this.remote = false;
      }
    }

    if (this.remote) return;
    return super.init();
  }

  async callRemote(method, args) {
    const response = await fetch(this.apiUrl('/api/db/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Server database request failed.');
    }
    return payload.result;
  }
}

REMOTE_DB_METHODS.forEach((method) => {
  SyncCapableDatabase.prototype[method] = async function (...args) {
    if (this.cloud) {
      return this.cloud.call(method, args);
    }
    if (this.remote) {
      return this.callRemote(method, args);
    }
    return Database.prototype[method].apply(this, args);
  };
});

class SupabaseStateSync {
  constructor(database) {
    this.database = database;
    this.url = String(window.LYNKBAY_SUPABASE_URL || '').replace(/\/+$/, '');
    this.anonKey = String(window.LYNKBAY_SUPABASE_ANON_KEY || '');
    this.syncSecret = String(window.LYNKBAY_SUPABASE_SYNC_SECRET || '');
    this.revision = null;
    this.lastPullAt = 0;
    this.pullIntervalMs = Number(window.LYNKBAY_SUPABASE_PULL_INTERVAL_MS || 5000);
    this.queue = Promise.resolve();
  }

  async init() {
    const state = await this.getCloudState();
    if (state?.payload) {
      this.revision = Number(state.revision || 0);
      await this.localCall('importAllData', [state.payload]);
      this.lastPullAt = Date.now();
      return;
    }

    const payload = await this.localCall('exportAllData', []);
    const saved = await this.saveCloudState(payload, 0);
    this.revision = Number(saved.revision || 1);
    this.lastPullAt = Date.now();
  }

  async localCall(method, args) {
    const previousCloud = this.database.cloud;
    const previousRemote = this.database.remote;
    this.database.cloud = null;
    this.database.remote = false;
    try {
      return await Database.prototype[method].apply(this.database, args);
    } finally {
      this.database.cloud = previousCloud;
      this.database.remote = previousRemote;
    }
  }

  isReadOnly(method) {
    return method.startsWith('get') || method === 'exportAllData' || method === 'validateBackupPayload';
  }

  call(method, args) {
    const task = async () => {
      if (this.isReadOnly(method)) {
        if (Date.now() - this.lastPullAt > this.pullIntervalMs) {
          await this.pullLatest();
        }
        return this.localCall(method, args);
      }

      await this.pullLatest();
      const result = await this.localCall(method, args);
      const payload = await this.localCall('exportAllData', []);
      const saved = await this.saveCloudState(payload, this.revision || 0);
      this.revision = Number(saved.revision || this.revision || 0);
      this.lastPullAt = Date.now();
      return result;
    };

    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  async pullLatest() {
    const state = await this.getCloudState();
    if (!state?.payload) return;
    const nextRevision = Number(state.revision || 0);
    if (nextRevision !== this.revision) {
      await this.localCall('importAllData', [state.payload]);
      this.revision = nextRevision;
    }
    this.lastPullAt = Date.now();
  }

  async rpc(name, body) {
    const response = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error || 'Supabase sync failed.';
      if (message.includes('LYNKBAY_REVISION_CONFLICT')) {
        throw new Error('Cloud data changed on another device. Reload the app and try again.');
      }
      if (message.includes('LYNKBAY_INVALID_SYNC_SECRET')) {
        throw new Error('Invalid Supabase sync secret. Check js/supabase-config.js.');
      }
      throw new Error(message);
    }
    return Array.isArray(payload) ? payload[0] : payload;
  }

  async getCloudState() {
    return this.rpc('lynkbay_get_state', {
      p_sync_secret: this.syncSecret
    });
  }

  async saveCloudState(payload, expectedRevision) {
    return this.rpc('lynkbay_save_state', {
      p_sync_secret: this.syncSecret,
      p_expected_revision: Number(expectedRevision || 0),
      p_payload: payload
    });
  }
}

window.db = new SyncCapableDatabase();
