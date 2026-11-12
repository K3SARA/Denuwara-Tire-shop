const DB_NAME = 'cashew_billing_db';
const DB_VERSION = 10;

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
        if (!db.objectStoreNames.contains('suppliers')) {
          db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('supplier_purchases')) {
          db.createObjectStore('supplier_purchases', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('supplier_payments')) {
          db.createObjectStore('supplier_payments', { keyPath: 'id', autoIncrement: true });
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
      const tx = this.db.transaction(['bills', 'customers', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const customersStore = tx.objectStore('customers');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;
      let abortMessage = 'Failed to collect payment.';
      let cascadedCount = 0;
      let openingSettled = 0;
      let advanceCredited = 0;

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

        const isOverpayment = Money.isGreaterThan(collectAmount, balance);
        const targetCollect = isOverpayment ? balance : collectAmount;
        let remainingExcess = isOverpayment ? Money.subtract(collectAmount, balance) : 0;

        const nextReceived = Money.add(received, targetCollect);
        const nextBalance = Money.clampZero(Money.subtract(total, nextReceived));
        const paymentRow = payment ? { ...payment, amount: targetCollect } : {
          id: `pay-${now}-${Math.random().toString(36).slice(2, 6)}`,
          method: finalMethod,
          amount: targetCollect,
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
          changeAmount: 0,
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
          amount: targetCollect,
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

        if (remainingExcess > 0) {
          const normCustName = this.normalizeText(bill.customerName || '');
          const isWalkIn = !normCustName || normCustName === this.normalizeText('Walk-in Customer');

          if (isWalkIn) {
            updatedBill.changeAmount = remainingExcess;
            billsStore.put(updatedBill);
          } else {
            const custReq = customersStore.getAll();
            custReq.onsuccess = () => {
              const allCust = custReq.result || [];
              const customer = allCust.find(c => this.normalizeText(c.name) === normCustName);

              const allBillsReq = billsStore.getAll();
              allBillsReq.onsuccess = () => {
                const allBills = allBillsReq.result || [];
                const otherDueBills = allBills.filter(b => 
                  Number(b.id) !== numericId &&
                  (b.billStatus || 'active') === 'active' &&
                  this.normalizeText(b.customerName) === normCustName
                ).map(b => {
                  const bTot = Money.round(b.total);
                  const bRec = Money.round(b.receivedAmount || 0);
                  const bBal = typeof b.balanceAmount === 'number' ? Money.clampZero(b.balanceAmount) : Money.clampZero(Money.subtract(bTot, bRec));
                  return { ...b, computedBalance: bBal };
                }).filter(b => b.computedBalance > 0)
                  .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                for (const otherBill of otherDueBills) {
                  if (remainingExcess <= 0) break;
                  const allocate = Math.min(remainingExcess, otherBill.computedBalance);
                  const oRec = Money.add(otherBill.receivedAmount || 0, allocate);
                  const oBal = Money.clampZero(Money.subtract(otherBill.total, oRec));
                  const oPayRow = {
                    id: `pay-${now}-${Math.random().toString(36).slice(2, 6)}`,
                    method: finalMethod,
                    amount: allocate,
                    timestamp: now
                  };
                  const oPayments = [...this.getBillPaymentsForCollection(otherBill), oPayRow];
                  const updatedOther = {
                    ...otherBill,
                    receivedAmount: oRec,
                    balanceAmount: oBal,
                    payments: oPayments,
                    paymentStatus: oBal > 0 ? 'due' : 'paid',
                    updated_at: now
                  };
                  delete updatedOther.computedBalance;
                  billsStore.put(updatedOther);

                  logsStore.add({
                    billId: otherBill.id,
                    customerName: bill.customerName,
                    amount: allocate,
                    method: finalMethod,
                    paymentId: oPayRow.id,
                    action: 'collection',
                    notes: `Cascaded from Bill #${numericId}`,
                    beforeReceived: otherBill.receivedAmount || 0,
                    afterReceived: oRec,
                    timestamp: now
                  });

                  remainingExcess = Money.subtract(remainingExcess, allocate);
                  cascadedCount++;
                }

                if (remainingExcess > 0 && customer) {
                  const opBal = Money.clampZero(customer.openingBalance || 0);
                  if (opBal > 0) {
                    const opAlloc = Math.min(remainingExcess, opBal);
                    const nextOp = Money.subtract(opBal, opAlloc);
                    customer.openingBalance = nextOp;
                    customer.updated_at = now;

                    logsStore.add({
                      billId: `OB-${customer.id}`,
                      customerId: customer.id,
                      customerName: customer.name,
                      isOpeningBalance: true,
                      amount: opAlloc,
                      method: finalMethod,
                      action: 'opening_collection',
                      notes: `Cascaded from Bill #${numericId}`,
                      beforeReceived: opBal,
                      afterReceived: nextOp,
                      timestamp: now
                    });

                    remainingExcess = Money.subtract(remainingExcess, opAlloc);
                    openingSettled = opAlloc;
                  }
                }

                if (remainingExcess > 0 && customer) {
                  customer.creditBalance = Money.add(customer.creditBalance || 0, remainingExcess);
                  customer.updated_at = now;
                  advanceCredited = remainingExcess;

                  logsStore.add({
                    billId: `ADV-${customer.id}`,
                    customerId: customer.id,
                    customerName: customer.name,
                    amount: remainingExcess,
                    method: finalMethod,
                    action: 'advance_credit',
                    notes: `Excess payment saved as customer advance`,
                    timestamp: now
                  });
                  remainingExcess = 0;
                } else if (remainingExcess > 0) {
                  updatedBill.changeAmount = remainingExcess;
                  billsStore.put(updatedBill);
                }

                if (customer && (openingSettled > 0 || advanceCredited > 0)) {
                  customersStore.put(customer);
                }
              };
            };
          }
        }
      };

      tx.oncomplete = () => resolve({ updatedBill, cascadedCount, openingSettled, advanceCredited });
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async updateCollectionPaymentAtomic({ logId, billId, amount, method = 'cash', chequeDetails = {} }) {
    return new Promise((resolve, reject) => {
      const numericBillId = Number(billId);
      const numericLogId = Number(logId);
      const newAmount = Money.round(amount);
      if (!numericBillId || !numericLogId || newAmount <= 0) {
        reject(new Error('Enter a valid collection amount.'));
        return;
      }

      const now = Date.now();
      const finalMethod = this.normalizeText(method || 'cash') || 'cash';
      const tx = this.db.transaction(['bills', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;
      let abortMessage = 'Failed to update collection.';

      const logReq = logsStore.get(numericLogId);
      logReq.onsuccess = () => {
        const log = logReq.result;
        if (!log) {
          abortMessage = 'Collection log not found.';
          tx.abort();
          return;
        }

        const billReq = billsStore.get(numericBillId);
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

          const payments = [...this.getBillPaymentsForCollection(bill)];
          let paymentIndex = -1;
          if (log.paymentId) {
            paymentIndex = payments.findIndex(p => p.id === log.paymentId);
          }
          if (paymentIndex === -1) {
            paymentIndex = payments.findIndex(p => p.method === log.method && Money.round(p.amount) === Money.round(log.amount));
          }
          if (paymentIndex === -1 && payments.length > 0) {
            paymentIndex = payments.length - 1;
          }

          if (paymentIndex === -1) {
            abortMessage = 'Associated payment entry not found on bill.';
            tx.abort();
            return;
          }

          const oldPayment = payments[paymentIndex];
          const oldAmount = Money.round(oldPayment.amount);

          const otherPaymentsSum = payments.reduce((sum, p, idx) => idx === paymentIndex ? sum : Money.add(sum, p.amount), 0);
          const maxAllowed = Money.clampZero(Money.subtract(bill.total, otherPaymentsSum));
          if (Money.isGreaterThan(newAmount, maxAllowed)) {
            abortMessage = `Amount exceeds bill total. Maximum allowed is LKR ${maxAllowed.toLocaleString()}.`;
            tx.abort();
            return;
          }

          const updatedPayment = {
            ...oldPayment,
            method: finalMethod,
            amount: newAmount,
            chequeDate: finalMethod === 'cheque' ? (chequeDetails.chequeDate || '') : '',
            chequeNumber: finalMethod === 'cheque' ? (chequeDetails.chequeNumber || '') : '',
            chequeBank: finalMethod === 'cheque' ? (chequeDetails.chequeBank || '') : '',
            chequeStatus: finalMethod === 'cheque' ? (oldPayment.chequeStatus || 'pending') : ''
          };
          payments[paymentIndex] = updatedPayment;

          const nextReceived = payments.reduce((sum, p) => Money.add(sum, p.amount), 0);
          const nextBalance = Money.clampZero(Money.subtract(bill.total, nextReceived));
          const nextChange = Money.clampZero(Money.subtract(nextReceived, bill.total));

          updatedBill = {
            ...bill,
            receivedAmount: nextReceived,
            balanceAmount: nextBalance,
            changeAmount: nextChange,
            payments: payments,
            paymentMethod: payments.length > 1 ? 'multiple' : finalMethod,
            paymentStatus: nextBalance > 0 ? 'due' : 'paid',
            updated_at: now
          };
          billsStore.put(updatedBill);

          const updatedLog = {
            ...log,
            amount: newAmount,
            method: finalMethod,
            ...(finalMethod === 'cheque' ? chequeDetails : { chequeDate: '', chequeNumber: '', chequeBank: '' }),
            action: 'collection_edited',
            updated_at: now
          };
          logsStore.put(updatedLog);

          auditStore.add({
            action: 'collection_edit',
            entity: 'bill',
            entityId: numericBillId,
            details: { logId: numericLogId, oldAmount, newAmount, oldMethod: log.method, newMethod: finalMethod },
            timestamp: now
          });
        };
      };

      tx.oncomplete = () => resolve(updatedBill);
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async deleteCollectionPaymentAtomic({ logId, billId }) {
    return new Promise((resolve, reject) => {
      const numericBillId = Number(billId);
      const numericLogId = Number(logId);
      if (!numericBillId || !numericLogId) {
        reject(new Error('Invalid collection details.'));
        return;
      }

      const now = Date.now();
      const tx = this.db.transaction(['bills', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;
      let abortMessage = 'Failed to delete collection.';

      const logReq = logsStore.get(numericLogId);
      logReq.onsuccess = () => {
        const log = logReq.result;
        if (!log) {
          abortMessage = 'Collection log not found.';
          tx.abort();
          return;
        }

        const billReq = billsStore.get(numericBillId);
        billReq.onsuccess = () => {
          const bill = billReq.result;
          if (!bill) {
            abortMessage = 'Bill not found.';
            tx.abort();
            return;
          }

          const payments = [...this.getBillPaymentsForCollection(bill)];
          let paymentIndex = -1;
          if (log.paymentId) {
            paymentIndex = payments.findIndex(p => p.id === log.paymentId);
          }
          if (paymentIndex === -1) {
            paymentIndex = payments.findIndex(p => p.method === log.method && Money.round(p.amount) === Money.round(log.amount));
          }
          if (paymentIndex !== -1) {
            payments.splice(paymentIndex, 1);
          }

          const nextReceived = payments.reduce((sum, p) => Money.add(sum, p.amount), 0);
          const nextBalance = Money.clampZero(Money.subtract(bill.total, nextReceived));
          const nextChange = Money.clampZero(Money.subtract(nextReceived, bill.total));

          updatedBill = {
            ...bill,
            receivedAmount: nextReceived,
            balanceAmount: nextBalance,
            changeAmount: nextChange,
            payments: payments,
            paymentMethod: payments.length > 1 ? 'multiple' : (payments[0]?.method || 'cash'),
            paymentStatus: nextBalance > 0 ? 'due' : 'paid',
            updated_at: now
          };
          billsStore.put(updatedBill);
          logsStore.delete(numericLogId);

          auditStore.add({
            action: 'collection_delete',
            entity: 'bill',
            entityId: numericBillId,
            details: { logId: numericLogId, deletedAmount: log.amount, deletedMethod: log.method },
            timestamp: now
          });
        };
      };

      tx.oncomplete = () => resolve(updatedBill);
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async updateBillWithStockAndCollectionLog({ billId, updates, stockDeltas = [], collectionLog = null, auditLog = null }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(billId);
      const lookupId = Number.isFinite(numericId) ? numericId : billId;
      const now = new Date().getTime();
      const tx = this.db.transaction(['bills', 'products', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const productsStore = tx.objectStore('products');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let updatedBill = null;

      const billReq = billsStore.get(lookupId);
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

  async collectCustomerOpeningBalanceAtomic({ customerId, amount, method = 'cash', chequeDetails = {}, auditLog = null }) {
    return new Promise((resolve, reject) => {
      const numericId = Number(customerId);
      const collectAmount = Money.round(amount);
      if (!numericId || collectAmount <= 0) {
        reject(new Error('Enter a valid collection amount.'));
        return;
      }

      const now = new Date().getTime();
      const finalMethod = this.normalizeText(method || 'cash') || 'cash';
      const tx = this.db.transaction(['bills', 'customers', 'collection_logs', 'audit_logs'], 'readwrite');
      const billsStore = tx.objectStore('bills');
      const customersStore = tx.objectStore('customers');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let abortMessage = 'Failed to collect payment.';
      let cascadedCount = 0;
      let advanceCredited = 0;

      const custReq = customersStore.get(numericId);
      custReq.onsuccess = () => {
        const customer = custReq.result;
        if (!customer) {
          abortMessage = 'Customer not found.';
          tx.abort();
          return;
        }

        const currentBalance = Money.clampZero(customer.openingBalance || 0);
        const isOverpayment = Money.isGreaterThan(collectAmount, currentBalance);
        const targetCollect = isOverpayment ? currentBalance : collectAmount;
        let remainingExcess = isOverpayment ? Money.subtract(collectAmount, currentBalance) : 0;

        const nextBalance = Money.clampZero(Money.subtract(currentBalance, targetCollect));
        customer.openingBalance = nextBalance;
        customer.updated_at = now;

        logsStore.add({
          billId: `OB-${numericId}`,
          customerId: numericId,
          customerName: customer.name || 'Customer',
          isOpeningBalance: true,
          amount: targetCollect,
          method: finalMethod,
          ...(finalMethod === 'cheque' ? chequeDetails : {}),
          action: 'opening_collection',
          beforeReceived: currentBalance,
          afterReceived: nextBalance,
          timestamp: now
        });

        auditStore.add({
          action: 'collection_opening_create',
          entity: 'customer',
          entityId: numericId,
          details: { amount: targetCollect, method: finalMethod, nextBalance },
          timestamp: now
        });

        if (remainingExcess > 0) {
          const normCustName = this.normalizeText(customer.name || '');
          const billsReq = billsStore.getAll();
          billsReq.onsuccess = () => {
            const allBills = billsReq.result || [];
            const otherDueBills = allBills.filter(b => 
              (b.billStatus || 'active') === 'active' &&
              this.normalizeText(b.customerName) === normCustName
            ).map(b => {
              const bTot = Money.round(b.total);
              const bRec = Money.round(b.receivedAmount || 0);
              const bBal = typeof b.balanceAmount === 'number' ? Money.clampZero(b.balanceAmount) : Money.clampZero(Money.subtract(bTot, bRec));
              return { ...b, computedBalance: bBal };
            }).filter(b => b.computedBalance > 0)
              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            for (const otherBill of otherDueBills) {
              if (remainingExcess <= 0) break;
              const allocate = Math.min(remainingExcess, otherBill.computedBalance);
              const oRec = Money.add(otherBill.receivedAmount || 0, allocate);
              const oBal = Money.clampZero(Money.subtract(otherBill.total, oRec));
              const oPayRow = {
                id: `pay-${now}-${Math.random().toString(36).slice(2, 6)}`,
                method: finalMethod,
                amount: allocate,
                timestamp: now
              };
              const oPayments = [...this.getBillPaymentsForCollection(otherBill), oPayRow];
              const updatedOther = {
                ...otherBill,
                receivedAmount: oRec,
                balanceAmount: oBal,
                payments: oPayments,
                paymentStatus: oBal > 0 ? 'due' : 'paid',
                updated_at: now
              };
              delete updatedOther.computedBalance;
              billsStore.put(updatedOther);

              logsStore.add({
                billId: otherBill.id,
                customerName: customer.name,
                amount: allocate,
                method: finalMethod,
                paymentId: oPayRow.id,
                action: 'collection',
                notes: `Cascaded from Opening Balance of ${customer.name}`,
                beforeReceived: otherBill.receivedAmount || 0,
                afterReceived: oRec,
                timestamp: now
              });

              remainingExcess = Money.subtract(remainingExcess, allocate);
              cascadedCount++;
            }

            if (remainingExcess > 0) {
              customer.creditBalance = Money.add(customer.creditBalance || 0, remainingExcess);
              advanceCredited = remainingExcess;
              logsStore.add({
                billId: `ADV-${customer.id}`,
                customerId: customer.id,
                customerName: customer.name,
                amount: remainingExcess,
                method: finalMethod,
                action: 'advance_credit',
                notes: `Excess opening payment saved as customer advance`,
                timestamp: now
              });
            }
            customersStore.put(customer);
          };
        } else {
          customersStore.put(customer);
        }
      };

      tx.oncomplete = () => resolve({ ok: true, cascadedCount, advanceCredited });
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async updateOpeningBalanceCollectionAtomic({ logId, customerId, amount, method = 'cash', chequeDetails = {} }) {
    return new Promise((resolve, reject) => {
      const numericLogId = Number(logId);
      const numericCustomerId = Number(customerId);
      const newAmount = Money.round(amount);
      if (!numericLogId || !numericCustomerId || newAmount <= 0) {
        reject(new Error('Enter a valid collection amount.'));
        return;
      }

      const now = Date.now();
      const finalMethod = this.normalizeText(method || 'cash') || 'cash';
      const tx = this.db.transaction(['customers', 'collection_logs', 'audit_logs'], 'readwrite');
      const customersStore = tx.objectStore('customers');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let abortMessage = 'Failed to update opening collection.';

      const logReq = logsStore.get(numericLogId);
      logReq.onsuccess = () => {
        const log = logReq.result;
        if (!log) {
          abortMessage = 'Collection log not found.';
          tx.abort();
          return;
        }

        const custReq = customersStore.get(numericCustomerId);
        custReq.onsuccess = () => {
          const customer = custReq.result;
          if (!customer) {
            abortMessage = 'Customer not found.';
            tx.abort();
            return;
          }

          const oldAmount = Money.round(log.amount || 0);
          const currentBalance = Money.clampZero(customer.openingBalance || 0);
          const availableBalance = Money.add(currentBalance, oldAmount);

          if (Money.isGreaterThan(newAmount, availableBalance)) {
            abortMessage = `Amount exceeds available opening debt. Maximum allowed is LKR ${availableBalance.toLocaleString()}.`;
            tx.abort();
            return;
          }

          const nextBalance = Money.clampZero(Money.subtract(availableBalance, newAmount));
          customer.openingBalance = nextBalance;
          customer.updated_at = now;
          customersStore.put(customer);

          const updatedLog = {
            ...log,
            amount: newAmount,
            method: finalMethod,
            ...(finalMethod === 'cheque' ? chequeDetails : { chequeDate: '', chequeNumber: '', chequeBank: '' }),
            action: 'collection_edited',
            updated_at: now
          };
          logsStore.put(updatedLog);

          auditStore.add({
            action: 'collection_opening_edit',
            entity: 'customer',
            entityId: numericCustomerId,
            details: { logId: numericLogId, oldAmount, newAmount, nextBalance },
            timestamp: now
          });
        };
      };

      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async deleteOpeningBalanceCollectionAtomic({ logId, customerId }) {
    return new Promise((resolve, reject) => {
      const numericLogId = Number(logId);
      const numericCustomerId = Number(customerId);
      if (!numericLogId || !numericCustomerId) {
        reject(new Error('Invalid collection details.'));
        return;
      }

      const now = Date.now();
      const tx = this.db.transaction(['customers', 'collection_logs', 'audit_logs'], 'readwrite');
      const customersStore = tx.objectStore('customers');
      const logsStore = tx.objectStore('collection_logs');
      const auditStore = tx.objectStore('audit_logs');
      let abortMessage = 'Failed to delete opening collection.';

      const logReq = logsStore.get(numericLogId);
      logReq.onsuccess = () => {
        const log = logReq.result;
        if (!log) {
          abortMessage = 'Collection log not found.';
          tx.abort();
          return;
        }

        const custReq = customersStore.get(numericCustomerId);
        custReq.onsuccess = () => {
          const customer = custReq.result;
          if (customer) {
            customer.openingBalance = Money.add(customer.openingBalance || 0, log.amount || 0);
            customer.updated_at = now;
            customersStore.put(customer);
          }

          logsStore.delete(numericLogId);

          auditStore.add({
            action: 'collection_opening_delete',
            entity: 'customer',
            entityId: numericCustomerId,
            details: { logId: numericLogId, restoredAmount: log.amount },
            timestamp: now
          });
        };
      };

      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(tx.error || new Error(abortMessage));
      tx.onabort = () => reject(new Error(abortMessage));
    });
  }

  async updateCustomer(id, updates) {
    return new Promise((resolve) => {
      const numericId = Number(id);
      const lookupId = Number.isFinite(numericId) ? numericId : id;
      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const req = store.get(lookupId);
      req.onsuccess = (e) => {
        let customer = e.target.result;
        if (customer) {
          const sanitizedUpdates = { ...updates };
          if ('openingBalance' in sanitizedUpdates) {
            sanitizedUpdates.openingBalance = Money.clampZero(Money.round(sanitizedUpdates.openingBalance || 0));
          }
          customer = { ...customer, ...sanitizedUpdates, updated_at: new Date().getTime() };
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

  async addCustomer(name, phone = '', address = '', openingBalance = 0) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return { ok: false, error: 'Customer name is required.' };
    }

    const all = await this.getCustomers();
    const exists = all.some((c) => this.normalizeText(c.name) === this.normalizeText(normalizedName));
    if (exists) {
      return { ok: false, error: 'Customer already exists.' };
    }

    const parsedOpeningBalance = Money.clampZero(Money.round(openingBalance || 0));

    return new Promise((resolve) => {
      const tx = this.db.transaction('customers', 'readwrite');
      const store = tx.objectStore('customers');
      const now = new Date().getTime();
      const req = store.add({
        name: normalizedName,
        phone: (phone || '').trim(),
        address: (address || '').trim(),
        openingBalance: parsedOpeningBalance,
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

  async upsertCustomerByName(name, phone = '', address = '', openingBalance = undefined, creditAdjustment = 0) {
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
          if (openingBalance !== undefined) {
            next.openingBalance = Money.clampZero(Money.round(openingBalance || 0));
          }
          if (creditAdjustment) {
            next.creditBalance = Money.clampZero(Money.add(existing.creditBalance || 0, creditAdjustment));
          }
          store.put(next);
        } else {
          store.add({
            name: normalizedName,
            phone: (phone || '').trim(),
            address: (address || '').trim(),
            openingBalance: openingBalance !== undefined ? Money.clampZero(Money.round(openingBalance || 0)) : 0,
            creditBalance: creditAdjustment > 0 ? Money.clampZero(creditAdjustment) : 0,
            created_at: now,
            updated_at: now
          });
        }
      };

      tx.oncomplete = () => resolve();
    });
  }

  async refundCustomerCredit(customerId) {
    return new Promise((resolve, reject) => {
      const numericId = Number(customerId);
      const now = Date.now();
      const tx = this.db.transaction(['customers', 'audit_logs'], 'readwrite');
      const store = tx.objectStore('customers');
      const audit = tx.objectStore('audit_logs');
      const req = store.get(numericId);
      req.onsuccess = () => {
        const cust = req.result;
        if (!cust) {
          tx.abort();
          reject(new Error('Customer not found.'));
          return;
        }
        const refunded = Money.round(cust.creditBalance || 0);
        cust.creditBalance = 0;
        cust.updated_at = now;
        store.put(cust);
        audit.add({
          action: 'customer_advance_refund',
          entity: 'customer',
          entityId: numericId,
          details: { refundedAmount: refunded },
          timestamp: now
        });
      };
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(tx.error || new Error('Failed to refund customer advance.'));
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

  // =================== SUPPLIERS & PURCHASES ===================
  async getSuppliers() {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('suppliers')) {
        resolve([]);
        return;
      }
      const store = this.db.transaction('suppliers', 'readonly').objectStore('suppliers');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        resolve(sorted);
      };
      req.onerror = () => resolve([]);
    });
  }

  async getSupplierById(id) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('suppliers')) {
        resolve(null);
        return;
      }
      const store = this.db.transaction('suppliers', 'readonly').objectStore('suppliers');
      const req = store.get(Number(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async addSupplier(name, phone = '', address = '', contactPerson = '', bankDetails = '', openingBalance = 0) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return { ok: false, error: 'Supplier name is required.' };
    }
    const all = await this.getSuppliers();
    const exists = all.some((s) => this.normalizeText(s.name) === this.normalizeText(normalizedName));
    if (exists) {
      return { ok: false, error: 'Supplier already exists with this name.' };
    }
    const parsedOpening = Money.clampZero(Money.round(openingBalance || 0));
    return new Promise((resolve) => {
      const tx = this.db.transaction('suppliers', 'readwrite');
      const store = tx.objectStore('suppliers');
      const now = Date.now();
      const req = store.add({
        name: normalizedName,
        phone: (phone || '').trim(),
        address: (address || '').trim(),
        contactPerson: (contactPerson || '').trim(),
        bankDetails: (bankDetails || '').trim(),
        openingBalance: parsedOpening,
        currentBalance: parsedOpening,
        created_at: now,
        updated_at: now
      });
      req.onsuccess = () => resolve({ ok: true, id: req.result });
      req.onerror = () => resolve({ ok: false, error: 'Failed to add supplier.' });
    });
  }

  async updateSupplier(id, updates = {}) {
    const numericId = Number(id);
    if (!numericId) return { ok: false, error: 'Invalid supplier ID.' };
    return new Promise((resolve) => {
      const tx = this.db.transaction('suppliers', 'readwrite');
      const store = tx.objectStore('suppliers');
      const getReq = store.get(numericId);
      getReq.onsuccess = () => {
        const supplier = getReq.result;
        if (!supplier) {
          resolve({ ok: false, error: 'Supplier not found.' });
          return;
        }
        if (updates.name && String(updates.name).trim()) supplier.name = String(updates.name).trim();
        if (updates.phone !== undefined) supplier.phone = String(updates.phone || '').trim();
        if (updates.address !== undefined) supplier.address = String(updates.address || '').trim();
        if (updates.contactPerson !== undefined) supplier.contactPerson = String(updates.contactPerson || '').trim();
        if (updates.bankDetails !== undefined) supplier.bankDetails = String(updates.bankDetails || '').trim();
        if (updates.openingBalance !== undefined) {
          supplier.openingBalance = Money.clampZero(Money.round(updates.openingBalance || 0));
        }
        if (updates.currentBalance !== undefined) {
          supplier.currentBalance = Money.round(updates.currentBalance || 0);
        }
        supplier.updated_at = Date.now();
        const putReq = store.put(supplier);
        putReq.onsuccess = () => resolve({ ok: true, supplier });
        putReq.onerror = () => resolve({ ok: false, error: 'Failed to update supplier.' });
      };
      getReq.onerror = () => resolve({ ok: false, error: 'Failed to find supplier.' });
    });
  }

  async deleteSupplier(id) {
    const numericId = Number(id);
    return new Promise((resolve) => {
      const tx = this.db.transaction(['suppliers', 'supplier_purchases', 'supplier_payments'], 'readwrite');
      const suppStore = tx.objectStore('suppliers');
      const purStore = tx.objectStore('supplier_purchases');
      const payStore = tx.objectStore('supplier_payments');

      suppStore.delete(numericId);

      const purReq = purStore.getAll();
      purReq.onsuccess = () => {
        (purReq.result || []).forEach((p) => {
          if (Number(p.supplierId) === numericId) purStore.delete(p.id);
        });
      };
      const payReq = payStore.getAll();
      payReq.onsuccess = () => {
        (payReq.result || []).forEach((pay) => {
          if (Number(pay.supplierId) === numericId) payStore.delete(pay.id);
        });
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async getPurchases(supplierId = null) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('supplier_purchases')) {
        resolve([]);
        return;
      }
      const store = this.db.transaction('supplier_purchases', 'readonly').objectStore('supplier_purchases');
      const req = store.getAll();
      req.onsuccess = () => {
        let list = req.result || [];
        if (supplierId) {
          list = list.filter((p) => Number(p.supplierId) === Number(supplierId));
        }
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async getPurchaseById(id) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('supplier_purchases')) {
        resolve(null);
        return;
      }
      const store = this.db.transaction('supplier_purchases', 'readonly').objectStore('supplier_purchases');
      const req = store.get(Number(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async addPurchase(purchaseData) {
    return new Promise((resolve, reject) => {
      const txStores = ['supplier_purchases', 'suppliers', 'products', 'inventory_logs', 'audit_logs'];
      const tx = this.db.transaction(txStores, 'readwrite');
      const purStore = tx.objectStore('supplier_purchases');
      const suppStore = tx.objectStore('suppliers');
      const prodStore = tx.objectStore('products');
      const invLogStore = tx.objectStore('inventory_logs');
      const auditStore = tx.objectStore('audit_logs');

      const now = Date.now();
      const totalAmount = Money.round(purchaseData.totalAmount || 0);
      const paidAmount = Money.round(purchaseData.paidAmount || 0);
      const balanceAmount = Money.clampZero(Money.subtract(totalAmount, paidAmount));
      const autoUpdateStock = purchaseData.autoUpdateStock !== false;

      const purchaseRecord = {
        invoiceNumber: String(purchaseData.invoiceNumber || '').trim() || `PUR-${now}`,
        supplierId: Number(purchaseData.supplierId),
        supplierName: String(purchaseData.supplierName || '').trim(),
        date: purchaseData.date || new Date().toISOString().slice(0, 10),
        timestamp: purchaseData.timestamp || now,
        items: Array.isArray(purchaseData.items) ? purchaseData.items : [],
        totalAmount,
        paidAmount,
        balanceAmount,
        paymentMethod: purchaseData.paymentMethod || (balanceAmount > 0 ? (paidAmount > 0 ? 'partially_paid' : 'credit') : 'cash'),
        notes: String(purchaseData.notes || '').trim(),
        autoUpdateStock,
        status: balanceAmount > 0 ? 'due' : 'paid',
        created_at: now
      };

      const addReq = purStore.add(purchaseRecord);
      addReq.onsuccess = () => {
        const purchaseId = addReq.result;
        purchaseRecord.id = purchaseId;

        // 1. Update Supplier balance if due exists
        if (purchaseRecord.supplierId) {
          const suppReq = suppStore.get(purchaseRecord.supplierId);
          suppReq.onsuccess = () => {
            const supplier = suppReq.result;
            if (supplier) {
              const currentDue = Money.round(supplier.currentBalance !== undefined ? supplier.currentBalance : (supplier.openingBalance || 0));
              supplier.currentBalance = Money.add(currentDue, balanceAmount);
              supplier.updated_at = now;
              suppStore.put(supplier);
            }
          };
        }

        // 2. Auto-update product stock & cost price if enabled
        if (autoUpdateStock && Array.isArray(purchaseRecord.items)) {
          const prodReq = prodStore.getAll();
          prodReq.onsuccess = () => {
            const allProducts = prodReq.result || [];
            purchaseRecord.items.forEach((item) => {
              const qty = Number(item.qty) || 0;
              const unitCost = Number(item.cost || item.price) || 0;
              if (qty <= 0) return;

              const matched = allProducts.find((p) => this.normalizeText(p.name) === this.normalizeText(item.name));
              if (matched) {
                const prevStock = Number(matched.stock) || 0;
                matched.stock = prevStock + qty;
                if (unitCost > 0) {
                  matched.invoicePrice = unitCost;
                }
                matched.updated_at = now;
                prodStore.put(matched);

                invLogStore.add({
                  productId: matched.id,
                  productName: matched.name,
                  change: qty,
                  previousStock: prevStock,
                  newStock: matched.stock,
                  type: 'purchase_stock_in',
                  reason: `Supplier Inward Stock: ${purchaseRecord.supplierName} (Inv #${purchaseRecord.invoiceNumber})`,
                  invoicePrice: unitCost,
                  timestamp: now
                });
              } else if (String(item.name || '').trim()) {
                prodStore.add({
                  name: String(item.name).trim(),
                  stock: qty,
                  billingPrice: Number(item.billingPrice) || unitCost * 1.2,
                  invoicePrice: unitCost,
                  reorderLevel: 5,
                  created_at: now,
                  updated_at: now
                });
              }
            });
          };
        }

        auditStore.add({
          action: 'supplier_purchase_create',
          entity: 'purchase',
          entityId: purchaseId,
          details: { supplierName: purchaseRecord.supplierName, totalAmount, paidAmount, balanceAmount },
          timestamp: now
        });
      };

      tx.oncomplete = () => resolve({ ok: true, id: addReq.result });
      tx.onerror = () => reject(new Error('Failed to save purchase.'));
    });
  }

  async deletePurchase(id) {
    const numericId = Number(id);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['supplier_purchases', 'suppliers', 'products', 'inventory_logs', 'audit_logs'], 'readwrite');
      const purStore = tx.objectStore('supplier_purchases');
      const suppStore = tx.objectStore('suppliers');
      const prodStore = tx.objectStore('products');
      const invLogStore = tx.objectStore('inventory_logs');
      const auditStore = tx.objectStore('audit_logs');
      const now = Date.now();

      const getReq = purStore.get(numericId);
      getReq.onsuccess = () => {
        const purchase = getReq.result;
        if (!purchase) {
          resolve(false);
          return;
        }

        if (purchase.supplierId && Money.isPositive(purchase.balanceAmount)) {
          const suppReq = suppStore.get(purchase.supplierId);
          suppReq.onsuccess = () => {
            const supplier = suppReq.result;
            if (supplier) {
              supplier.currentBalance = Money.clampZero(Money.subtract(supplier.currentBalance || 0, purchase.balanceAmount));
              supplier.updated_at = now;
              suppStore.put(supplier);
            }
          };
        }

        if (purchase.autoUpdateStock && Array.isArray(purchase.items)) {
          const prodReq = prodStore.getAll();
          prodReq.onsuccess = () => {
            const allProducts = prodReq.result || [];
            purchase.items.forEach((item) => {
              const qty = Number(item.qty) || 0;
              const matched = allProducts.find((p) => this.normalizeText(p.name) === this.normalizeText(item.name));
              if (matched && qty > 0) {
                const prev = Number(matched.stock) || 0;
                matched.stock = Math.max(0, prev - qty);
                matched.updated_at = now;
                prodStore.put(matched);

                invLogStore.add({
                  productId: matched.id,
                  productName: matched.name,
                  change: -qty,
                  previousStock: prev,
                  newStock: matched.stock,
                  type: 'purchase_stock_revert',
                  reason: `Deleted Supplier Purchase #${purchase.invoiceNumber}`,
                  timestamp: now
                });
              }
            });
          };
        }

        purStore.delete(numericId);
        auditStore.add({
          action: 'supplier_purchase_delete',
          entity: 'purchase',
          entityId: numericId,
          details: { invoiceNumber: purchase.invoiceNumber, supplierName: purchase.supplierName },
          timestamp: now
        });
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(new Error('Failed to delete purchase.'));
    });
  }

  async getSupplierPayments(supplierId = null) {
    return new Promise((resolve) => {
      if (!this.db || !this.db.objectStoreNames.contains('supplier_payments')) {
        resolve([]);
        return;
      }
      const store = this.db.transaction('supplier_payments', 'readonly').objectStore('supplier_payments');
      const req = store.getAll();
      req.onsuccess = () => {
        let list = req.result || [];
        if (supplierId) {
          list = list.filter((p) => Number(p.supplierId) === Number(supplierId));
        }
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  async addSupplierPayment({ supplierId, amount, method = 'cash', chequeDetails = {}, reference = '', date = null }) {
    const numericId = Number(supplierId);
    const payAmount = Money.round(amount);
    if (!numericId || payAmount <= 0) {
      return { ok: false, error: 'Enter a valid payment amount.' };
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['suppliers', 'supplier_payments', 'audit_logs'], 'readwrite');
      const suppStore = tx.objectStore('suppliers');
      const payStore = tx.objectStore('supplier_payments');
      const auditStore = tx.objectStore('audit_logs');
      const now = Date.now();
      const dateStr = date || new Date().toISOString().slice(0, 10);

      const suppReq = suppStore.get(numericId);
      suppReq.onsuccess = () => {
        const supplier = suppReq.result;
        if (!supplier) {
          tx.abort();
          resolve({ ok: false, error: 'Supplier not found.' });
          return;
        }

        const prevBalance = Money.round(supplier.currentBalance !== undefined ? supplier.currentBalance : (supplier.openingBalance || 0));
        const nextBalance = Money.subtract(prevBalance, payAmount);
        supplier.currentBalance = nextBalance;
        supplier.updated_at = now;
        suppStore.put(supplier);

        const paymentRecord = {
          supplierId: numericId,
          supplierName: supplier.name,
          amount: payAmount,
          method,
          ...(method === 'cheque' ? chequeDetails : {}),
          reference: String(reference || '').trim(),
          date: dateStr,
          timestamp: now,
          beforeBalance: prevBalance,
          afterBalance: nextBalance
        };

        const addReq = payStore.add(paymentRecord);
        addReq.onsuccess = () => {
          auditStore.add({
            action: 'supplier_payment_create',
            entity: 'supplier_payment',
            entityId: addReq.result,
            details: { supplierName: supplier.name, amount: payAmount, method, nextBalance },
            timestamp: now
          });
        };
      };

      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(new Error('Failed to record supplier payment.'));
    });
  }

  async deleteSupplierPayment(id) {
    const numericId = Number(id);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['suppliers', 'supplier_payments', 'audit_logs'], 'readwrite');
      const suppStore = tx.objectStore('suppliers');
      const payStore = tx.objectStore('supplier_payments');
      const auditStore = tx.objectStore('audit_logs');
      const now = Date.now();

      const getReq = payStore.get(numericId);
      getReq.onsuccess = () => {
        const payment = getReq.result;
        if (!payment) {
          resolve(false);
          return;
        }

        if (payment.supplierId && Money.isPositive(payment.amount)) {
          const suppReq = suppStore.get(payment.supplierId);
          suppReq.onsuccess = () => {
            const supplier = suppReq.result;
            if (supplier) {
              supplier.currentBalance = Money.add(supplier.currentBalance || 0, payment.amount);
              supplier.updated_at = now;
              suppStore.put(supplier);
            }
          };
        }

        payStore.delete(numericId);
        auditStore.add({
          action: 'supplier_payment_delete',
          entity: 'supplier_payment',
          entityId: numericId,
          details: { supplierName: payment.supplierName, amount: payment.amount },
          timestamp: now
        });
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(new Error('Failed to delete payment.'));
    });
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
      const numericId = Number(id);
      const store = this.db.transaction('bills', 'readonly').objectStore('bills');
      const req = store.get(Number.isFinite(numericId) ? numericId : id);
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
    const [products, customers, bills, collectionLogs, inventoryLogs, expenses, auditLogs, suppliers, supplierPurchases, supplierPayments] = await Promise.all([
      this.getProducts(true),
      this.getCustomers(),
      this.getBills(),
      this.getCollectionLogs(),
      this.getInventoryLogs(),
      this.getExpenses(),
      this.getAuditLogs(),
      this.getSuppliers(),
      this.getPurchases(),
      this.getSupplierPayments()
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
        auditLogs,
        suppliers,
        supplier_purchases: supplierPurchases,
        supplier_payments: supplierPayments
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
    ['products', 'customers', 'bills', 'collectionLogs', 'inventoryLogs', 'expenses', 'auditLogs', 'suppliers', 'supplier_purchases', 'supplier_payments'].forEach((key) => {
      if (data[key] !== undefined) {
        this.validateBackupRecordList(key, data[key] || []);
        this.validateUniqueIds(key, data[key] || []);
      }
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
    const suppliers = Array.isArray(payload.data.suppliers) ? payload.data.suppliers : [];
    const supplierPurchases = Array.isArray(payload.data.supplier_purchases) ? payload.data.supplier_purchases : (Array.isArray(payload.data.supplierPurchases) ? payload.data.supplierPurchases : []);
    const supplierPayments = Array.isArray(payload.data.supplier_payments) ? payload.data.supplier_payments : (Array.isArray(payload.data.supplierPayments) ? payload.data.supplierPayments : []);

    // Preserve rollback snapshots before clearing settings
    const rollbacks = await this.getImportRollbacks();
    const legacyRollback = await this.getImportRollback();

    await new Promise((resolve, reject) => {
      // Include 'settings' so the stale bill_counter and rollback snapshots
      // from the previous session are cleared. recalculateBillCounter() below
      // will re-derive the correct counter from the imported bills.
      const storeNames = ['products', 'customers', 'bills', 'collection_logs', 'inventory_logs', 'expenses', 'audit_logs', 'settings'];
      if (this.db.objectStoreNames.contains('suppliers')) storeNames.push('suppliers');
      if (this.db.objectStoreNames.contains('supplier_purchases')) storeNames.push('supplier_purchases');
      if (this.db.objectStoreNames.contains('supplier_payments')) storeNames.push('supplier_payments');

      const tx = this.db.transaction(storeNames, 'readwrite');
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

      if (this.db.objectStoreNames.contains('suppliers')) {
        const suppStore = tx.objectStore('suppliers');
        suppStore.clear();
        suppliers.forEach((item) => suppStore.put(item));
      }
      if (this.db.objectStoreNames.contains('supplier_purchases')) {
        const purStore = tx.objectStore('supplier_purchases');
        purStore.clear();
        supplierPurchases.forEach((item) => purStore.put(item));
      }
      if (this.db.objectStoreNames.contains('supplier_payments')) {
        const payStore = tx.objectStore('supplier_payments');
        payStore.clear();
        supplierPayments.forEach((item) => payStore.put(item));
      }

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
  'updateCollectionPaymentAtomic',
  'deleteCollectionPaymentAtomic',
  'collectCustomerOpeningBalanceAtomic',
  'updateOpeningBalanceCollectionAtomic',
  'deleteOpeningBalanceCollectionAtomic',
  'updateBillWithStockAndCollectionLog',
  'getProducts',
  'getCustomers',
  'updateCustomer',
  'renameCustomerInBills',
  'addCustomer',
  'deleteCustomer',
  'refundCustomerCredit',
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
  'importAllData',
  'getSuppliers',
  'getSupplierById',
  'addSupplier',
  'updateSupplier',
  'deleteSupplier',
  'getPurchases',
  'getPurchaseById',
  'addPurchase',
  'deletePurchase',
  'getSupplierPayments',
  'addSupplierPayment',
  'deleteSupplierPayment'
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
