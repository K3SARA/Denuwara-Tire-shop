if (!window.Money) {
  window.Money = (() => {
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
}

class ShareManager {
  constructor() {
    this.currentBill = null;
    this.loadBusinessProfile();
  }

  loadBusinessProfile() {
    try {
      const custom = JSON.parse(localStorage.getItem('denuwara_shop_profile') || '{}');
      this.businessName = custom.businessName || 'DENUWARA TYRE CARE';
      this.proprietorName = custom.proprietorName || 'ATHULA NANDANA PERERA';
      this.businessAddress = custom.businessAddress || '54, Dalugama, Kelaniya.';
      this.businessPhone = custom.businessPhone || '075 7559975 / 077 8052775';
      this.businessRegNo = custom.businessRegNo || '661800380v';
    } catch (e) {
      this.businessName = 'DENUWARA TYRE CARE';
      this.proprietorName = 'ATHULA NANDANA PERERA';
      this.businessAddress = '54, Dalugama, Kelaniya.';
      this.businessPhone = '075 7559975 / 077 8052775';
      this.businessRegNo = '661800380v';
    }
  }

  splitRsCts(amount) {
    const rounded = Money.round(amount);
    const parts = Number(rounded || 0).toFixed(2).split('.');
    const rs = Number(parts[0]).toLocaleString();
    const cts = parts[1] === '00' ? '-' : parts[1];
    return { rs, cts };
  }

  formatCurrency(value) {
    const n = Money.round(value);
    return n.toLocaleString();
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  isIOS() {
    const ua = navigator.userAgent || '';
    const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
    const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return isAppleMobile || isIPadOS;
  }

  getReceiptStoreKey() {
    return `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  getReceiptNavKey() {
    return 'receipt-nav-intent';
  }

  getAppReturnUrl() {
    const url = new URL('./index.html', window.location.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  serializeForInlineScript(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  printCurrentView(jobName = 'T Billing Receipt') {
    const nativePrint = window.Capacitor?.Plugins?.NativePrint;
    if (nativePrint && typeof nativePrint.print === 'function') {
      nativePrint.print({ jobName }).catch(() => window.print());
      return;
    }
    if (window.AndroidPrint && typeof window.AndroidPrint.print === 'function') {
      window.AndroidPrint.print(jobName);
      return;
    }
    window.print();
  }

  getPaymentMethod(bill) {
    return String(bill?.paymentMethod || (bill?.markAsCredit ? 'credit' : '')).trim().toLowerCase();
  }

  isChequeBill(bill) {
    return this.getPaymentMethod(bill) === 'cheque'
      || Boolean(bill?.chequeDate || bill?.chequeNumber || bill?.chequeBank);
  }

  getChequeAmount(bill) {
    if (!this.isChequeBill(bill)) return 0;
    const explicit = Money.clampZero(bill?.chequeAmount || 0);
    if (Money.isPositive(explicit)) return explicit;
    const received = Money.clampZero(bill?.receivedAmount || 0);
    if (Money.isPositive(received)) return received;
    return Money.clampZero(bill?.total || 0);
  }

  getPayments(bill) {
    if (Array.isArray(bill?.payments) && bill.payments.length) {
      return bill.payments.map((payment, index) => ({
        id: payment.id || `payment-${index + 1}`,
        method: String(payment.method || 'cash').toLowerCase(),
        amount: Money.clampZero(payment.chequeAmount || payment.amount),
        chequeAmount: Money.clampZero(payment.chequeAmount || payment.amount),
        chequeDate: payment.chequeDate || '',
        chequeNumber: payment.chequeNumber || '',
        chequeBank: payment.chequeBank || '',
        chequeStatus: payment.chequeStatus || ''
      }));
    }
    const method = this.getPaymentMethod(bill) || 'cash';
    return [{
      id: 'legacy-payment-1',
      method,
      amount: method === 'cheque' ? this.getChequeAmount(bill) : Money.clampZero(bill?.receivedAmount || 0),
      chequeAmount: method === 'cheque' ? this.getChequeAmount(bill) : 0,
      chequeDate: bill?.chequeDate || '',
      chequeNumber: bill?.chequeNumber || '',
      chequeBank: bill?.chequeBank || '',
      chequeStatus: bill?.chequeStatus || ''
    }];
  }

  methodLabel(method) {
    const labels = { cash: 'Cash', card: 'Card', bank: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit', multiple: 'Multiple' };
    return labels[String(method || '').toLowerCase()] || String(method || 'Payment');
  }
  formatBillText() {
    const b = this.currentBill;
    if (!b) return '';

    let text = `*${this.businessName}*\n`;
    text += `Proprietor: ${this.proprietorName}\n`;
    text += `${this.businessAddress}\n`;
    text += `Tel: ${this.businessPhone}\n\n`;
    text += `*CASH SALE / INVOICE*\n`;
    text += `Bill No: ${b.billNumber || b.id || '-'}\n`;
    text += `Date: ${b.date || new Date(b.timestamp).toLocaleDateString()}\n`;
    text += `Customer: ${b.customerName}\n`;
    if (b.customerPhone) text += `Phone: ${b.customerPhone}\n`;
    if (b.customerAddress) text += `Address: ${b.customerAddress}\n`;
    text += `--------------------\n`;
    b.items.forEach((i) => {
      const unit = i.unit ? ` ${i.unit}` : '';
      text += `${i.name} x${i.qty}${unit} @ LKR ${i.price}\n`;
      text += `  = LKR ${this.formatCurrency(Money.multiply(i.price, i.qty))}\n`;
    });
    const total = Money.round(b.total);
    const received = Money.round(b.receivedAmount || 0);
    const balance = typeof b.balanceAmount === 'number' ? Money.clampZero(b.balanceAmount) : Money.clampZero(Money.subtract(total, received));
    const billStatus = b.billStatus || 'active';
    const paymentMethod = this.getPaymentMethod(b);
    const change = Money.clampZero(b.changeAmount || Money.subtract(received, total));
    const paymentStatus = billStatus === 'active'
      ? (Money.isPositive(balance) ? 'due' : 'paid')
      : (b.paymentStatus || billStatus);
    text += `--------------------\n`;
    text += `*Total: LKR ${this.formatCurrency(b.total)}*\n`;
    text += `Received: LKR ${this.formatCurrency(received)}\n`;
    text += `Balance: LKR ${this.formatCurrency(balance)}\n`;
    if (Money.isPositive(change)) text += `Change: LKR ${this.formatCurrency(change)}\n`;
    const payments = this.getPayments(b).filter((payment) => Number(payment.amount) > 0);
    if (payments.length > 1 || paymentMethod === 'multiple') {
      text += `Payment Methods:\n`;
      let chequeIndex = 0;
      payments.forEach((payment) => {
        const label = payment.method === 'cheque' ? `Cheque ${++chequeIndex}` : this.methodLabel(payment.method);
        text += `${label}: LKR ${this.formatCurrency(payment.amount)}\n`;
        if (payment.method === 'cheque') {
          text += `  Date: ${payment.chequeDate || '-'}\n`;
          text += `  No: ${payment.chequeNumber || '-'}\n`;
          text += `  Bank: ${payment.chequeBank || '-'}\n`;
        }
      });
    } else if (paymentMethod) {
      text += `Method: ${this.methodLabel(paymentMethod)}\n`;
      if (this.isChequeBill(b)) {
        text += `Cheque Amount: LKR ${this.formatCurrency(this.getChequeAmount(b))}\n`;
        text += `Cheque Date: ${b.chequeDate || '-'}\n`;
        text += `Cheque No: ${b.chequeNumber || '-'}\n`;
        text += `Bank: ${b.chequeBank || '-'}\n`;
      }
    }
    text += `Status: ${paymentStatus}\n`;
    if (billStatus !== 'active') text += `Bill: ${billStatus}\n`;
    text += `\nThank you for your business!\n`;
    text += `Powered by J&co.`;
    return text;
  }

  buildPrintHtml(bill, options = {}) {
    const format = options.format || 'a5';
    if (format === '80mm') {
      return this.buildThermalHtml(bill, options);
    }
    return this.buildA5Html(bill, options);
  }

  buildA5Html(bill, options = {}) {
    const b = bill;
    const language = ['en', 'si', 'ta'].includes(options.language) ? options.language : 'en';
    const translations = {
      en: {
        receiptTitle: 'CASH SALE', walkInCustomer: 'Direct Customer', phoneLabel: 'Tel:', regNo: 'NIC / Reg:', print: 'Print', editBill: 'Edit Bill', backToApp: 'Back to App', billNo: 'Bill No:', date: 'Date:', billTo: 'M/s.', phone: 'Phone:', address: 'Address:',
        items: 'Items', qty: 'Qty.', price: 'Rate', amount: 'Amount', subTotal: 'Sub Total', total: 'Total Amount', received: 'Received',
        balance: 'Balance', change: 'Change', paymentMethods: 'Payment Methods', chequeAmount: 'Cheque Amount', chequeDate: 'Cheque Date',
        chequeNo: 'Cheque No', bank: 'Bank', paymentMethod: 'Payment Method', paymentStatus: 'Payment Status', billStatus: 'Bill Status',
        terms: 'Goods received in good condition.', thankYou: 'Thank you for doing business with us.', poweredBy: 'Denuwara Tyre Care',
        cash: 'Cash', card: 'Card', bankTransfer: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit', multiple: 'Multiple',
        due: 'Due', paid: 'Paid', active: 'Active', cancelled: 'Cancelled', refunded: 'Refunded',
        totalAmount: 'TOTAL AMOUNT'
      },
      ta: {
        receiptTitle: 'பண விற்பனை', walkInCustomer: 'நேரடி வாடிக்கையாளர்', phoneLabel: 'தொலைபேசி:', regNo: 'பதிவு எண்:', print: 'அச்சிடு', editBill: 'ரசீதைத் திருத்து', backToApp: 'செயலிக்குத் திரும்பு', billNo: 'ரசீது எண்:', date: 'தேதி:', billTo: 'வாடிக்கையாளர்:', phone: 'தொலைபேசி:', address: 'முகவரி:',
        items: 'பொருட்கள்', qty: 'அளவு', price: 'விலை', amount: 'தொகை', subTotal: 'இடைத் தொகை', total: 'மொத்தம்', received: 'பெற்ற தொகை',
        balance: 'நிலுவைத் தொகை', change: 'மீதிப் பணம்', paymentMethods: 'கட்டண முறைகள்', chequeAmount: 'காசோலைத் தொகை', chequeDate: 'காசோலை தேதி',
        chequeNo: 'காசோலை எண்', bank: 'வங்கி', paymentMethod: 'கட்டண முறை', paymentStatus: 'கட்டண நிலை', billStatus: 'ரசீது நிலை',
        terms: 'விதிமுறைகள் மற்றும் நிபந்தனைகள்', thankYou: 'உங்கள் வணிகத்திற்கு நன்றி.', poweredBy: 'Denuwara Tyre Care',
        cash: 'பணம்', card: 'அட்டை', bankTransfer: 'வங்கி பரிமாற்றம்', cheque: 'காசோலை', credit: 'கடன்', multiple: 'பல முறைகள்',
        due: 'செலுத்த வேண்டியது', paid: 'செலுத்தப்பட்டது', active: 'செயலில்', cancelled: 'ரத்து செய்யப்பட்டது', refunded: 'பணம் திருப்பப்பட்டது',
        totalAmount: 'மொத்தத் தொகை'
      },
      si: {
        receiptTitle: 'මුදල් විකිණුම්', walkInCustomer: 'සෘජු පාරිභෝගිකයා', phoneLabel: 'දුරකථන:', regNo: 'ලියාපදිංචි අංකය:', print: 'මුද්‍රණය', editBill: 'බිල්පත සංස්කරණය', backToApp: 'යෙදුමට ආපසු', billNo: 'රිසිට්පත් අංකය:', date: 'දිනය:', billTo: 'පාරිභෝගිකයා:', phone: 'දුරකථන:', address: 'ලිපිනය:',
        items: 'භාණ්ඩ', qty: 'ප්‍රමාණය', price: 'මිල', amount: 'මුදල', subTotal: 'උප එකතුව', total: 'මුළු එකතුව', received: 'ලැබුණු මුදල',
        balance: 'ඉතිරි මුදල', change: 'ඉතිරි මුදල්', paymentMethods: 'ගෙවීම් ක්‍රම', chequeAmount: 'චෙක්පත් මුදල', chequeDate: 'චෙක්පත් දිනය',
        chequeNo: 'චෙක්පත් අංකය', bank: 'බැංකුව', paymentMethod: 'ගෙවීමේ ක්‍රමය', paymentStatus: 'ගෙවීමේ තත්ත්වය', billStatus: 'රිසිට්පත් තත්ත්වය',
        terms: 'නියමයන් සහ කොන්දේසි', thankYou: 'ඔබගේ ව්‍යාපාරයට ස්තුතියි.', poweredBy: 'Denuwara Tyre Care',
        cash: 'මුදල්', card: 'කාඩ්පත', bankTransfer: 'බැංකු මාරු කිරීම', cheque: 'චෙක්පත', credit: 'ණය', multiple: 'ක්‍රම කිහිපයක්',
        due: 'ගෙවීමට ඇත', paid: 'ගෙවා ඇත', active: 'සක්‍රියයි', cancelled: 'අවලංගුයි', refunded: 'මුදල් ආපසු දී ඇත',
        totalAmount: 'මුළු මුදල'
      }
    }[language];
    const t = (key) => translations[key] || key;
    const localizedMethodLabel = (method) => {
      const key = ({ cash: 'cash', card: 'card', bank: 'bankTransfer', bank_transfer: 'bankTransfer', cheque: 'cheque', credit: 'credit', multiple: 'multiple' })[String(method || '').toLowerCase()];
      return key ? t(key) : String(method || '-');
    };
    const localizeStatus = (status) => {
      const key = String(status || '').toLowerCase();
      return ['due', 'paid', 'active', 'cancelled', 'refunded'].includes(key) ? t(key) : (status || '-');
    };

    const dateObj = b.timestamp ? new Date(b.timestamp) : new Date();
    const dStr = String(dateObj.getDate()).padStart(2, '0');
    const mStr = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yStr = String(dateObj.getFullYear());

    const invoiceNo = this.escapeHtml(b.billNumber || b.id || dateObj.getTime());
    const rawCustomer = String(b.customerName || '').trim();
    const isWalkIn = !rawCustomer || rawCustomer.toLowerCase() === 'walk-in customer' || rawCustomer.toLowerCase() === 'direct customer';
    const customer = isWalkIn ? '' : this.escapeHtml(rawCustomer);
    const phone = this.escapeHtml(b.customerPhone || '');
    const address = this.escapeHtml(b.customerAddress || '');
    const customerInfo = [customer, address].filter(Boolean).join(' - ');
    const logoUrl = new URL('./icons/logo-print.png', window.location.href).href;
    const phoneList = String(this.businessPhone || '')
      .split(/\s*[\/\n]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    const phonesHtml = phoneList.length > 0
      ? phoneList.map((p) => `<div>${this.escapeHtml(p)}</div>`).join('')
      : `<div>${this.escapeHtml(this.businessPhone)}</div>`;

    const items = Array.isArray(b.items) ? b.items : [];
    const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

    const billValue = Money.round(
      b.itemsTotal !== undefined
        ? b.itemsTotal
        : items.reduce((sum, item) => {
            const q = Number(item.qty) || 0;
            const p = Number(item.price) || 0;
            return Money.add(sum, Money.multiply(p, q));
          }, 0) || b.total || 0
    );
    const billValueSplit = this.splitRsCts(billValue);

    const dueAmount = Money.round(
      b.previousDue !== undefined
        ? b.previousDue
        : (b.dueAmount !== undefined ? b.dueAmount : 0)
    );
    const dueSplit = this.splitRsCts(dueAmount);

    const totalAmount = Money.add(billValue, dueAmount);
    const totalSplit = this.splitRsCts(totalAmount);

    const received = Money.round(b.receivedAmount || 0);
    const paidSplit = this.splitRsCts(received);

    const balance = Money.clampZero(Money.subtract(totalAmount, received));
    const balSplit = this.splitRsCts(balance);

    const billStatus = b.billStatus || 'active';
    const paymentMethod = this.getPaymentMethod(b);
    const paymentStatus = billStatus === 'active'
      ? (Money.isPositive(balance) ? 'due' : 'paid')
      : (b.paymentStatus || billStatus);
    const paymentLabel = paymentMethod ? localizedMethodLabel(paymentMethod) : '-';

    const totalRows = Math.max(22, items.length + 2);
    const itemSlots = totalRows - 2;
    let tableRowsHtml = '';

    for (let i = 0; i < itemSlots; i++) {
      const rowNo = String(i + 1).padStart(2, '0');
      const item = items[i];
      if (item) {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        const amount = Money.multiply(price, qty);
        const amtSplit = this.splitRsCts(amount);
        tableRowsHtml += `
          <tr>
            <td class="col-no">${rowNo}</td>
            <td class="col-qty">${qty}</td>
            <td class="col-desc">${this.escapeHtml(item.name)}</td>
            <td class="col-rate">${price > 0 ? this.formatCurrency(price) : ''}</td>
            <td class="col-amt-rs">${amtSplit.rs}</td>
            <td class="col-amt-cts">${amtSplit.cts}</td>
          </tr>`;
      } else {
        tableRowsHtml += `
          <tr class="empty-row">
            <td class="col-no">${rowNo}</td>
            <td class="col-qty">&nbsp;</td>
            <td class="col-desc">&nbsp;</td>
            <td class="col-rate">&nbsp;</td>
            <td class="col-amt-rs">&nbsp;</td>
            <td class="col-amt-cts">&nbsp;</td>
          </tr>`;
      }
    }

    // Row 21: Bill value
    const rowNo21 = String(totalRows - 1).padStart(2, '0');
    tableRowsHtml += `
      <tr class="summary-val-row a5-row-bill-value">
        <td class="col-no">${rowNo21}</td>
        <td class="col-qty">&nbsp;</td>
        <td class="col-desc" style="font-weight: 800; color: #111;">Bill value</td>
        <td class="col-rate">&nbsp;</td>
        <td class="col-amt-rs" style="font-weight: 800; color: #111;">${billValueSplit.rs}</td>
        <td class="col-amt-cts" style="font-weight: 800;">${billValueSplit.cts}</td>
      </tr>`;

    // Row 22: Due Amount
    const rowNo22 = String(totalRows).padStart(2, '0');
    tableRowsHtml += `
      <tr class="summary-val-row a5-row-due">
        <td class="col-no">${rowNo22}</td>
        <td class="col-qty">&nbsp;</td>
        <td class="col-desc" style="font-weight: 800; color: #7d1838;">Due Amount</td>
        <td class="col-rate">&nbsp;</td>
        <td class="col-amt-rs" style="font-weight: 800; color: #7d1838;">${dueAmount > 0 ? dueSplit.rs : '-'}</td>
        <td class="col-amt-cts" style="font-weight: 800; color: #7d1838;">${dueAmount > 0 ? dueSplit.cts : '-'}</td>
      </tr>`;

    const showToolbar = Boolean(options.showToolbar);
    const appUrl = this.escapeHtml(options.appUrl || this.getAppReturnUrl());
    const returnPage = this.escapeHtml(options.returnPage || 'billing');
    const billPayload = this.serializeForInlineScript(b);

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.escapeHtml(t('receiptTitle'))} - ${invoiceNo}</title>
<style>
  @page {
    size: A5 portrait;
    margin: 4mm 6mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #eceef1;
    font-family: Arial, 'Segoe UI', 'Noto Sans Sinhala', 'Noto Sans Tamil', sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .screen-actions {
    position: sticky;
    top: 0;
    z-index: 20;
    background: #fff;
    padding: 10px 14px;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #ddd;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    justify-content: center;
  }
  .screen-actions button {
    border: 1px solid #7d1838;
    background: #fff;
    color: #7d1838;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .screen-actions button:hover {
    background: #fbf1f4;
  }
  .screen-actions .primary-btn {
    background: #7d1838;
    color: #fff;
  }
  .screen-actions .primary-btn:hover {
    background: #68122d;
  }
  .screen-actions .back-btn {
    background: #333;
    color: #fff;
    border-color: #333;
  }

  .a5-container-wrap {
    padding: 16px 8px;
    display: flex;
    justify-content: center;
  }

  .receipt-a5 {
    width: 140mm;
    background: #fff;
    border: 2px solid #7d1838;
    padding: 5mm 6mm 4mm;
    position: relative;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    box-sizing: border-box;
  }

  .a5-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
  }
  .a5-top-left {
    flex: 1;
  }
  .a5-main-title {
    font-size: 26px;
    font-weight: 900;
    color: #a8234a;
    letter-spacing: 2px;
    line-height: 1;
    margin-bottom: 6px;
    font-family: 'Arial Black', Arial, sans-serif;
  }
  .a5-date-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 800;
    color: #7d1838;
    margin-bottom: 6px;
  }
  .a5-date-boxes {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .a5-dbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 19px;
    border: 1px solid #7d1838;
    font-size: 12px;
    font-weight: 800;
    color: #111;
    background: #fff;
  }
  .a5-dbox.a5-dbox-gap {
    margin-left: 4px;
  }
  .a5-customer-row {
    font-size: 13px;
    font-weight: 800;
    color: #7d1838;
    display: flex;
    align-items: baseline;
    width: 100%;
    min-height: 20px;
    margin-top: 5px;
    margin-bottom: 6px;
  }
  .a5-customer-row .label {
    flex-shrink: 0;
    padding-right: 4px;
    letter-spacing: 0.5px;
  }
  .a5-customer-row .val {
    color: #111;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    border-bottom: 1.5px dotted #7d1838;
    min-height: 18px;
    padding-left: 2px;
    padding-bottom: 1px;
  }

  .a5-biz-card {
    width: 63mm;
    border: 1.5px solid #7d1838;
    border-radius: 6px;
    padding: 3px 5px;
    text-align: center;
    background: #fff;
    flex-shrink: 0;
  }
  .a5-biz-name {
    font-size: 13px;
    font-weight: 900;
    color: #7d1838;
    letter-spacing: 0.5px;
    line-height: 1.15;
  }
  .a5-biz-addr {
    font-size: 10px;
    color: #222;
    font-weight: 700;
    margin-top: 1px;
    line-height: 1.15;
  }
  .a5-biz-contact-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 3px;
  }
  .a5-biz-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .a5-biz-logo svg {
    width: 28px;
    height: 28px;
    display: block;
  }
  .a5-biz-phones {
    font-size: 10.5px;
    font-weight: 800;
    color: #111;
    line-height: 1.25;
    text-align: left;
    letter-spacing: 0.3px;
  }

  .a5-table-wrap {
    position: relative;
    margin-top: 4px;
    margin-bottom: 0;
  }
  .a5-table {
    width: 100%;
    border-collapse: collapse;
    border: 1.5px solid #7d1838;
    table-layout: fixed;
  }
  .a5-table th {
    background: #fff;
    color: #7d1838;
    font-size: 12px;
    font-weight: 800;
    border: 1px solid #7d1838;
    padding: 3px 2px;
    text-align: center;
  }
  .a5-table td {
    border: 1px solid #7d1838;
    font-size: 11px;
    font-weight: 700;
    color: #111;
    padding: 1.5px 4px;
    height: 19px;
    vertical-align: middle;
  }
  .col-no { width: 7.5mm; text-align: center; color: #7d1838; font-weight: 700; font-size: 10.5px; }
  .col-qty { width: 11mm; text-align: center; }
  .col-desc { width: auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 6px !important; }
  .col-rate { width: 12mm; text-align: center; }
  .col-amount-head { padding: 2px 2px 1px; font-size: 11px; }
  .col-amt-rs { width: 14mm; text-align: right; border-right: 0.5px dotted #7d1838 !important; padding-right: 2px !important; font-variant-numeric: tabular-nums; }
  .col-amt-cts { width: 6.5mm; text-align: center; color: #444; font-variant-numeric: tabular-nums; }

  .a5-table th.th-sub-rs {
    font-size: 10px;
    padding: 1px 1px;
    text-align: center;
    border-top: 1px solid #7d1838;
    border-right: 0.5px solid #7d1838;
  }
  .a5-table th.th-sub-cts {
    font-size: 10px;
    padding: 1px 1px;
    text-align: center;
    border-top: 1px solid #7d1838;
    border-right: 1px solid #7d1838;
  }

  .a5-tfoot-row td {
    height: 20px;
    vertical-align: middle;
  }
  .a5-tfoot-total td {
    border-top: 2px solid #7d1838;
    border-bottom: 1px solid #7d1838;
    background: #faf4f6;
    font-weight: 900;
  }
  .ft-total-qty {
    text-align: center;
    font-size: 11.5px;
    font-weight: 900;
    color: #7d1838;
  }
  .ft-desc-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
    width: 100%;
    box-sizing: border-box;
  }
  .ft-inv-block {
    font-size: 11px;
    font-weight: 800;
    color: #7d1838;
    letter-spacing: 0.5px;
  }
  .ft-inv-val {
    color: #111;
    font-weight: 900;
    font-size: 11.5px;
    margin-left: 3px;
  }
  .ft-total-title {
    font-size: 12px;
    font-weight: 900;
    color: #7d1838;
    letter-spacing: 0.5px;
    text-align: right;
  }
  .ft-total-rs {
    font-size: 12.5px;
    font-weight: 900;
    color: #111;
  }
  .ft-total-cts {
    font-size: 11.5px;
    font-weight: 900;
  }

  .a5-tfoot-paid td {
    border-top: 0.5px dotted #debac5;
    border-bottom: 0.5px dotted #debac5;
    background: #fff;
    height: 19px;
  }
  .a5-tfoot-balance td {
    border-top: 0.5px dotted #debac5;
    border-bottom: 2px solid #7d1838;
    background: #faf4f6;
    height: 19px;
  }
  .ft-sub-title {
    font-size: 11px;
    font-weight: 800;
    color: #7d1838;
    letter-spacing: 0.3px;
  }
  .ft-sub-rs {
    font-size: 12px;
    font-weight: 800;
    color: #111;
  }
  .ft-sub-cts {
    font-size: 11px;
    font-weight: 800;
  }

  .a5-watermark {
    position: absolute;
    top: 48%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 56px;
    font-weight: 900;
    color: rgba(125, 24, 56, 0.42);
    letter-spacing: 4px;
    pointer-events: none;
    z-index: 2;
    border-bottom: 2.5px solid rgba(125, 24, 56, 0.48);
    padding-bottom: 2px;
    line-height: 1;
  }

  .a5-bottom-section {
    margin-top: 0;
  }
  .a5-meta-summary {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #222;
    font-weight: 700;
    border-top: 1px dashed #7d1838;
    padding: 4px 2px 2px;
    margin-top: 2px;
  }
  .a5-sigs {
    display: flex;
    justify-content: space-between;
    padding: 0 14px 2px;
    margin-top: 26px;
  }
  .a5-sig-item {
    text-align: center;
    font-size: 10.5px;
    font-weight: 800;
    color: #7d1838;
  }
  .a5-sig-item .line {
    width: 48mm;
    border-top: 1.5px dotted #7d1838;
    margin-bottom: 5px;
  }

  @media print {
    @page {
      size: A5 portrait;
      margin: 4mm 6mm;
    }
    html, body {
      width: 148mm !important;
      min-width: 148mm !important;
      max-width: 148mm !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }
    .screen-actions { display: none !important; }
    .a5-container-wrap { padding: 0 !important; }
    .receipt-a5 {
      width: 136mm !important;
      max-width: 136mm !important;
      margin: 0 auto !important;
      box-shadow: none !important;
      border: 1.5px solid #7d1838 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .a5-tfoot-row td { background: transparent !important; }
  }
</style>
</head>
<body>
  ${showToolbar ? `<div class="screen-actions">
    <button class="primary-btn" onclick="printReceiptView()">${t('print')}</button>
    <button onclick="toggleReceiptFormat()">Switch to 80mm</button>
    <button onclick="editBillInApp()">${t('editBill')}</button>
    <button class="back-btn" onclick="backToApp()">${t('backToApp')}</button>
  </div>` : ''}

  <div class="a5-container-wrap">
    <div class="receipt receipt-a5">
      <div class="a5-top">
        <div class="a5-top-left">
          <div class="a5-main-title">${this.escapeHtml(t('receiptTitle'))}</div>
          <div class="a5-date-row">
            <span>Date</span>
            <div class="a5-date-boxes">
              <span class="a5-dbox">${dStr[0]}</span><span class="a5-dbox">${dStr[1]}</span>
              <span class="a5-dbox a5-dbox-gap">${mStr[0]}</span><span class="a5-dbox">${mStr[1]}</span>
              <span class="a5-dbox a5-dbox-gap">${yStr[0]}</span><span class="a5-dbox">${yStr[1]}</span><span class="a5-dbox">${yStr[2]}</span><span class="a5-dbox">${yStr[3]}</span>
            </div>
          </div>
        </div>

        <div class="a5-biz-card">
          <div class="a5-biz-name">${this.escapeHtml(this.businessName)}</div>
          <div class="a5-biz-addr">${this.escapeHtml(this.businessAddress)}</div>
          <div class="a5-biz-contact-row">
            <div class="a5-biz-logo">
              <svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M 14 3 C 8.5 3 4 7.5 4 13 C 4 14.9 4.5 16.7 5.4 18.2 L 3.8 23.8 L 9.6 22.3 C 10.9 23 12.4 23.4 14 23.4 C 19.5 23.4 24 18.8 24 13 C 24 7.3 19.5 3 14 3 Z" stroke="#7d1838" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="#fff" />
                <text x="14" y="17.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="13" fill="#7d1838">D</text>
              </svg>
            </div>
            <div class="a5-biz-phones">
              ${phonesHtml}
            </div>
          </div>
        </div>
      </div>

      <div class="a5-customer-row">
        <span class="label">M/s.</span>
        <span class="val">${customerInfo}</span>
      </div>

      <div class="a5-table-wrap">
        <div class="a5-watermark">${invoiceNo}</div>
        <table class="a5-table">
          <colgroup>
            <col class="col-no" />
            <col class="col-qty" />
            <col class="col-desc" />
            <col class="col-rate" />
            <col class="col-amt-rs" />
            <col class="col-amt-cts" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-no" rowspan="2">No.</th>
              <th class="col-qty" rowspan="2">Qty.</th>
              <th class="col-desc" rowspan="2">Description</th>
              <th class="col-rate" rowspan="2">Rate</th>
              <th class="col-amount-head" colspan="2">Amount</th>
            </tr>
            <tr class="amt-sub-tr">
              <th class="col-amt-rs th-sub-rs">Rs.</th>
              <th class="col-amt-cts th-sub-cts">Cts.</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
          <tfoot>
            <tr class="a5-tfoot-row a5-tfoot-total">
              <td class="col-no">&nbsp;</td>
              <td class="col-qty ft-total-qty">${totalQty}</td>
              <td class="col-desc-footer" colspan="2">
                <div class="ft-desc-flex">
                  <span class="ft-inv-block"><strong>NO</strong> &nbsp;<span class="ft-inv-val">${invoiceNo}</span></span>
                  <span class="ft-total-title">${t('totalAmount')}</span>
                </div>
              </td>
              <td class="col-amt-rs ft-total-rs">${totalSplit.rs}</td>
              <td class="col-amt-cts ft-total-cts">${totalSplit.cts}</td>
            </tr>
            <tr class="a5-tfoot-row a5-tfoot-paid">
              <td class="col-no">&nbsp;</td>
              <td class="col-qty">&nbsp;</td>
              <td class="col-desc-footer" colspan="2" style="text-align: right; padding-right: 8px;">
                <span class="ft-sub-title">Paid amount</span>
              </td>
              <td class="col-amt-rs ft-sub-rs">${paidSplit.rs}</td>
              <td class="col-amt-cts ft-sub-cts">${paidSplit.cts}</td>
            </tr>
            <tr class="a5-tfoot-row a5-tfoot-balance">
              <td class="col-no">&nbsp;</td>
              <td class="col-qty">&nbsp;</td>
              <td class="col-desc-footer" colspan="2" style="text-align: right; padding-right: 8px;">
                <span class="ft-sub-title">Balance Amount</span>
              </td>
              <td class="col-amt-rs ft-sub-rs">${balSplit.rs}</td>
              <td class="col-amt-cts ft-sub-cts">${balSplit.cts}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="a5-bottom-section">
        <div class="a5-meta-summary">
          <div><strong>Status:</strong> ${this.escapeHtml(localizeStatus(paymentStatus)).toUpperCase()}</div>
          <div><strong>Payment Method:</strong> ${this.escapeHtml(paymentLabel)}</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const BILL_DATA = ${billPayload};
    const APP_URL = '${appUrl}';
    const RETURN_PAGE = '${returnPage}';
    const RECEIPT_NAV_KEY = '${this.getReceiptNavKey()}';

    function toggleReceiptFormat() {
      try {
        const p = new URLSearchParams(window.location.search);
        const rKey = p.get('receipt');
        if (!rKey) return;
        const d = JSON.parse(localStorage.getItem(rKey) || '{}');
        d.receiptFormat = (d.receiptFormat === '80mm') ? 'a5' : '80mm';
        localStorage.setItem(rKey, JSON.stringify(d));
        window.location.reload();
      } catch (e) {}
    }

    function printReceiptView() {
      const nativePrint = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
      if (nativePrint && typeof nativePrint.print === 'function') {
        nativePrint.print({ jobName: 'T Billing Receipt' }).catch(function () {
          window.print();
        });
        return;
      }
      if (window.AndroidPrint && typeof window.AndroidPrint.print === 'function') {
        window.AndroidPrint.print('T Billing Receipt');
        return;
      }
      window.print();
    }

    function writeReceiptIntent(action) {
      try {
        localStorage.setItem(RECEIPT_NAV_KEY, JSON.stringify({
          action: action,
          bill: BILL_DATA,
          page: action === 'edit' ? 'billing' : RETURN_PAGE,
          createdAt: Date.now()
        }));
      } catch (e) {}
    }

    function editBillInApp() {
      var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      var opened = false;
      try {
        if (!isCapacitor && window.opener && !window.opener.closed && window.opener.billing && typeof window.opener.billing.setEditMode === 'function') {
          window.opener.billing.setEditMode(BILL_DATA);
          if (window.opener.app && typeof window.opener.app.closeModal === 'function') {
            window.opener.app.closeModal('share-modal');
          }
          try { window.opener.focus(); } catch (e) {}
          opened = true;
        }
      } catch (e) {}

      if (!opened) {
        writeReceiptIntent('edit');
        window.location.replace(APP_URL);
        return;
      }

      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 120);
    }

    function backToApp() {
      var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      writeReceiptIntent('back');
      if (isCapacitor) {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.replace(APP_URL);
        }
        return;
      }
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (window.opener && !window.opener.closed) {
          try { window.opener.focus(); } catch (e) {}
        }
        if (!window.closed) {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.replace(APP_URL);
          }
        }
      }, 120);
    }
  </script>
</body>
</html>`;
  }

  buildThermalHtml(bill, options = {}) {
    const b = bill;
    const language = ['en', 'si', 'ta'].includes(options.language) ? options.language : 'en';
    const translations = {
      en: {
        receiptTitle: 'CASH SALE', walkInCustomer: 'Direct Customer', phoneLabel: 'Tel:', regNo: 'NIC / Reg:', print: 'Print', editBill: 'Edit Bill', backToApp: 'Back to App', billNo: 'Bill No:', date: 'Date:', billTo: 'Bill To:', phone: 'Phone:', address: 'Address:',
        items: 'Items', qty: 'Qty', price: 'Price', amount: 'Amount', subTotal: 'Sub Total', total: 'Total', received: 'Received',
        balance: 'Balance', change: 'Change', paymentMethods: 'Payment Methods', chequeAmount: 'Cheque Amount', chequeDate: 'Cheque Date',
        chequeNo: 'Cheque No', bank: 'Bank', paymentMethod: 'Payment Method', paymentStatus: 'Payment Status', billStatus: 'Bill Status',
        terms: 'Goods received in good condition.', thankYou: 'Thank you for doing business with us.', poweredBy: 'Denuwara Tyre Care',
        cash: 'Cash', card: 'Card', bankTransfer: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit', multiple: 'Multiple',
        due: 'Due', paid: 'Paid', active: 'Active', cancelled: 'Cancelled', refunded: 'Refunded'
      },
      ta: {
        receiptTitle: 'பண விற்பனை', walkInCustomer: 'நேரடி வாடிக்கையாளர்', phoneLabel: 'தொலைபேசி:', regNo: 'பதிவு எண்:', print: 'அச்சிடு', editBill: 'ரசீதைத் திருத்து', backToApp: 'செயலிக்குத் திரும்பு', billNo: 'ரசீது எண்:', date: 'தேதி:', billTo: 'வாடிக்கையாளர்:', phone: 'தொலைபேசி:', address: 'முகவரி:',
        items: 'பொருட்கள்', qty: 'அளவு', price: 'விலை', amount: 'தொகை', subTotal: 'இடைத் தொகை', total: 'மொத்தம்', received: 'பெற்ற தொகை',
        balance: 'நிலுவைத் தொகை', change: 'மீதிப் பணம்', paymentMethods: 'கட்டண முறைகள்', chequeAmount: 'காசோலைத் தொகை', chequeDate: 'காசோலை தேதி',
        chequeNo: 'காசோலை எண்', bank: 'வங்கி', paymentMethod: 'கட்டண முறை', paymentStatus: 'கட்டண நிலை', billStatus: 'ரசீது நிலை',
        terms: 'விதிமுறைகள் மற்றும் நிபந்தனைகள்', thankYou: 'உங்கள் வணிகத்திற்கு நன்றி.', poweredBy: 'Denuwara Tyre Care',
        cash: 'பணம்', card: 'அட்டை', bankTransfer: 'வங்கி பரிமாற்றம்', cheque: 'காசோலை', credit: 'கடன்', multiple: 'பல முறைகள்',
        due: 'செலுத்த வேண்டியது', paid: 'செலுத்தப்பட்டது', active: 'செயலில்', cancelled: 'ரத்து செய்யப்பட்டது', refunded: 'பணம் திருப்பப்பட்டது'
      },
      si: {
        receiptTitle: 'මුදල් විකිණුම්', walkInCustomer: 'සෘජු පාරිභෝගිකයා', phoneLabel: 'දුරකථන:', regNo: 'ලියාපදිංචි අංකය:', print: 'මුද්‍රණය', editBill: 'බිල්පත සංස්කරණය', backToApp: 'යෙදුමට ආපසු', billNo: 'රිසිට්පත් අංකය:', date: 'දිනය:', billTo: 'පාරිභෝගිකයා:', phone: 'දුරකථන:', address: 'ලිපිනය:',
        items: 'භාණ්ඩ', qty: 'ප්‍රමාණය', price: 'මිල', amount: 'මුදල', subTotal: 'උප එකතුව', total: 'මුළු එකතුව', received: 'ලැබුණු මුදල',
        balance: 'ඉතිරි මුදල', change: 'ඉතිරි මුදල්', paymentMethods: 'ගෙවීම් ක්‍රම', chequeAmount: 'චෙක්පත් මුදල', chequeDate: 'චෙක්පත් දිනය',
        chequeNo: 'චෙක්පත් අංකය', bank: 'බැංකුව', paymentMethod: 'ගෙවීමේ ක්‍රමය', paymentStatus: 'ගෙවීමේ තත්ත්වය', billStatus: 'රිසිට්පත් තත්ත්වය',
        terms: 'නියමයන් සහ කොන්දේසි', thankYou: 'ඔබගේ ව්‍යාපාරයට ස්තුතියි.', poweredBy: 'Denuwara Tyre Care',
        cash: 'මුදල්', card: 'කාඩ්පත', bankTransfer: 'බැංකු මාරු කිරීම', cheque: 'චෙක්පත', credit: 'ණය', multiple: 'ක්‍රම කිහිපයක්',
        due: 'ගෙවීමට ඇත', paid: 'ගෙවා ඇත', active: 'සක්‍රියයි', cancelled: 'අවලංගුයි', refunded: 'මුදල් ආපසු දී ඇත'
      }
    }[language];
    const t = (key) => translations[key] || key;
    const localizedMethodLabel = (method) => {
      const key = ({ cash: 'cash', card: 'card', bank: 'bankTransfer', bank_transfer: 'bankTransfer', cheque: 'cheque', credit: 'credit', multiple: 'multiple' })[String(method || '').toLowerCase()];
      return key ? t(key) : String(method || '-');
    };
    const localizeStatus = (status) => {
      const key = String(status || '').toLowerCase();
      return ['due', 'paid', 'active', 'cancelled', 'refunded'].includes(key) ? t(key) : (status || '-');
    };
    const dateObj = b.timestamp ? new Date(b.timestamp) : new Date();
    const dStr80 = String(dateObj.getDate()).padStart(2, '0');
    const mStr80 = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yStr80 = String(dateObj.getFullYear());
    const dateStr = `${yStr80}-${mStr80}-${dStr80}`;
    const timeStr = dateObj.toLocaleTimeString();
    const invoiceNo = this.escapeHtml(b.billNumber || b.id || dateObj.getTime());
    const customer = this.escapeHtml(b.customerName || t('walkInCustomer'));
    const phone = this.escapeHtml(b.customerPhone || '');
    const address = this.escapeHtml(b.customerAddress || '');
    const logoUrl = new URL('./icons/logo-print.png', window.location.href).href;

    const itemsRows = b.items.map((item) => {
      const name = this.escapeHtml(item.name);
      const qty = Number(item.qty) || 0;
      const unit = item.unit ? ` ${this.escapeHtml(item.unit)}` : '';
      const price = Number(item.price) || 0;
      const amount = Money.multiply(price, qty);
      return `
      <div class="item-row">
        <div class="item-name">${name}</div>
        <div class="item-meta-line small">
          <span>${t('qty')}</span>
          <span>${qty}${unit}</span>
          <span>${t('price')}</span>
          <span>${this.formatCurrency(price)}</span>
        </div>
        <div class="item-line">
          <span>${t('amount')}</span>
          <strong>${this.formatCurrency(amount)}</strong>
        </div>
      </div>`;
    }).join('');

    const subTotal = Money.round(b.total);
    const received = Money.round(b.receivedAmount || 0);
    const balance = typeof b.balanceAmount === 'number' ? Money.clampZero(b.balanceAmount) : Money.clampZero(Money.subtract(subTotal, received));
    const change = Money.clampZero(b.changeAmount || Money.subtract(received, subTotal));
    const billStatus = b.billStatus || 'active';
    const paymentMethod = this.getPaymentMethod(b);
    const paymentStatus = billStatus === 'active'
      ? (Money.isPositive(balance) ? 'due' : 'paid')
      : (b.paymentStatus || billStatus);
    const payments = this.getPayments(b).filter((payment) => Number(payment.amount) > 0);
    const hasChequePayment = this.isChequeBill(b) || payments.some((payment) => payment.method === 'cheque');
    const paymentLabel = paymentMethod ? localizedMethodLabel(paymentMethod) : '-';
    const paymentRows = payments.length > 1 || paymentMethod === 'multiple'
      ? `
      <div class="row payment-heading"><span>${t('paymentMethods')}</span><span></span></div>
      ${(() => {
        let chequeIndex = 0;
        return payments.map((payment) => {
          const label = payment.method === 'cheque' ? `${t('cheque')} ${++chequeIndex}` : localizedMethodLabel(payment.method);
          return `
          <div class="payment-block">
          <div class="row"><span>${this.escapeHtml(label)}</span><span>${this.formatCurrency(payment.amount)}</span></div>
          ${payment.method === 'cheque' ? `
            <div class="row detail-row small"><span>${t('chequeDate')}</span><span>${this.escapeHtml(payment.chequeDate || '-')}</span></div>
            <div class="row detail-row small"><span>${t('chequeNo')}</span><span>${this.escapeHtml(payment.chequeNumber || '-')}</span></div>
            <div class="row detail-row small"><span>${t('bank')}</span><span>${this.escapeHtml(payment.chequeBank || '-')}</span></div>` : ''}
          </div>
        `;
        }).join('');
      })()}`
      : '';
    const chequeAmount = this.getChequeAmount(b);
    const chequeRows = !paymentRows && this.isChequeBill(b)
      ? `
      <div class="payment-block">
      <div class="row"><span>${t('chequeAmount')}</span><span>${this.formatCurrency(chequeAmount)}</span></div>
      <div class="row detail-row small"><span>${t('chequeDate')}</span><span>${this.escapeHtml(b.chequeDate || '-')}</span></div>
      <div class="row detail-row small"><span>${t('chequeNo')}</span><span>${this.escapeHtml(b.chequeNumber || '-')}</span></div>
      <div class="row detail-row small"><span>${t('bank')}</span><span>${this.escapeHtml(b.chequeBank || '-')}</span></div>
      </div>`
      : '';
    const showToolbar = Boolean(options.showToolbar);
    const appUrl = this.escapeHtml(options.appUrl || this.getAppReturnUrl());
    const returnPage = this.escapeHtml(options.returnPage || 'billing');
    const billPayload = this.serializeForInlineScript(b);

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.escapeHtml(t('receiptTitle'))}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 80mm; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans Tamil', 'Noto Sans Sinhala', 'Noto Sans', 'Latha', 'Iskoola Pota', Arial, sans-serif; font-size: 15px; font-weight: 800; line-height: 1.25; color: #000; }
  body.print-mode { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt { width: 80mm; margin: 0; padding: 2mm 2.5mm; }
  .receipt, .receipt * { font-weight: 800; overflow-wrap: anywhere; word-break: break-word; }
  .center { text-align: center; }
  .header { padding-top: 1mm; }
  .logo { display: block; width: 28mm; max-height: 14mm; margin: 0 auto 3px; object-fit: contain; }
  .business-name { font-size: 17px; line-height: 1.15; margin-bottom: 2px; }
  .header-line { line-height: 1.15; }
  .title { font-weight: 700; margin: 5px 0; }
  .rule { border-top: 1px dashed #000; margin: 7px 0; }
  .meta { display: grid; grid-template-columns: 22mm minmax(0, 1fr); gap: 4px 8px; }
  .meta div:nth-child(even) { text-align: right; }
  .items-head { border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 4px; }
  .item-row { padding: 5px 0; border-bottom: 1px dotted #888; }
  .item-row:last-child { border-bottom: 0; }
  .item-name { margin-bottom: 3px; }
  .item-meta-line { display: grid; grid-template-columns: auto 1fr auto auto; gap: 6px; margin-bottom: 2px; }
  .item-meta-line span:nth-child(2),
  .item-meta-line span:nth-child(4) { text-align: right; white-space: nowrap; }
  .item-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .item-line strong { text-align: right; white-space: nowrap; }
  .totals { margin-top: 6px; }
  .totals .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 3px 0; }
  .totals .row span:last-child, .totals .row strong:last-child { text-align: right; }
  .payment-heading { padding-top: 6px !important; padding-bottom: 6px !important; }
  .payment-block { padding: 8px 0 6px; }
  .payment-block + .payment-block { border-top: 1px dashed #888; margin-top: 6px; padding-top: 10px; }
  .payment-block .row:first-child { padding-bottom: 3px; }
  .detail-row { grid-template-columns: 24mm minmax(0, 1fr) !important; padding: 4px 0 4px 4mm !important; }
  .foot { margin-top: 10px; line-height: 1.35; }
  .small { font-size: 14px; font-weight: 800; }
  .screen-actions {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #fff;
    padding: 10px;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #ddd;
    justify-content: center;
  }
  .screen-actions button {
    border: 1px solid #000;
    background: #fff;
    color: #000;
    padding: 8px 10px;
    font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
  }
  .screen-actions .back-btn {
    background: #111;
    color: #fff;
  }
  @media print {
    html, body {
      width: 80mm !important;
      min-width: 80mm !important;
      max-width: 80mm !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
    }
    body {
      display: block !important;
    }
    .receipt {
      width: 80mm !important;
      max-width: 80mm !important;
      margin: 0 !important;
      padding: 2mm 2.5mm !important;
    }
    .screen-actions { display: none !important; }
  }
</style>
</head>
<body class="print-mode">
  ${showToolbar ? `<div class="screen-actions">
    <button onclick="printReceiptView()">${t('print')}</button>
    <button onclick="toggleReceiptFormat()">Switch to A5</button>
    <button onclick="editBillInApp()">${t('editBill')}</button>
    <button class="back-btn" onclick="backToApp()">${t('backToApp')}</button>
  </div>` : ''}
  <div class="receipt">
    <div class="center header">
      <div class="business-name"><strong>${this.escapeHtml(this.businessName)}</strong></div>
      <div class="header-line"><strong>${this.escapeHtml(this.proprietorName)}</strong></div>
      <div class="header-line">${this.escapeHtml(this.businessAddress)}</div>
      <div class="header-line">${t('phoneLabel')} ${this.escapeHtml(this.businessPhone)}</div>
    </div>

    <div class="rule"></div>

    <div class="meta">
      <div>${t('billNo')}</div><div>${invoiceNo}</div>
      <div>${t('date')}</div><div>${this.escapeHtml(dateStr)} ${this.escapeHtml(timeStr)}</div>
      <div>${t('billTo')}</div><div>${customer}</div>
      ${address ? `<div>${t('address')}</div><div>${address}</div>` : ''}
    </div>

    <div class="rule"></div>

    <div class="items">
      <div class="items-head">${t('items')}</div>
      ${itemsRows}
    </div>

    <div class="rule"></div>

    <div class="totals">
      <div class="row"><span>${t('subTotal')}</span><strong>${this.formatCurrency(subTotal)}</strong></div>
      <div class="row"><span>${t('total')}</span><strong>${this.formatCurrency(subTotal)}</strong></div>
      ${hasChequePayment ? '' : `<div class="row"><span>${t('received')}</span><span>${this.formatCurrency(received)}</span></div>`}
      <div class="row"><span>${t('balance')}</span><strong>${this.formatCurrency(balance)}</strong></div>
      ${Money.isPositive(change) ? `<div class="row"><span>${t('change')}</span><span>${this.formatCurrency(change)}</span></div>` : ''}
      ${paymentRows}
      ${paymentRows ? '' : `<div class="row"><span>${t('paymentMethod')}</span><span>${this.escapeHtml(paymentLabel)}</span></div>`}
      ${hasChequePayment ? '' : `<div class="row"><span>${t('paymentStatus')}</span><span>${this.escapeHtml(localizeStatus(paymentStatus))}</span></div>`}
      ${billStatus !== 'active' ? `<div class="row"><span>${t('billStatus')}</span><span>${this.escapeHtml(localizeStatus(billStatus))}</span></div>` : ''}
      ${chequeRows}
    </div>

    <div class="rule"></div>

    <div class="foot small">
      <div>${t('terms')}</div>
      <div>${t('thankYou')}</div>
      <div>${t('poweredBy')}</div>
    </div>
  </div>
  <script>
    const BILL_DATA = ${billPayload};
    const APP_URL = '${appUrl}';
    const RETURN_PAGE = '${returnPage}';
    const RECEIPT_NAV_KEY = '${this.getReceiptNavKey()}';

    function toggleReceiptFormat() {
      try {
        const p = new URLSearchParams(window.location.search);
        const rKey = p.get('receipt');
        if (!rKey) return;
        const d = JSON.parse(localStorage.getItem(rKey) || '{}');
        d.receiptFormat = (d.receiptFormat === '80mm') ? 'a5' : '80mm';
        localStorage.setItem(rKey, JSON.stringify(d));
        window.location.reload();
      } catch (e) {}
    }

    function printReceiptView() {
      const nativePrint = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
      if (nativePrint && typeof nativePrint.print === 'function') {
        nativePrint.print({ jobName: 'T Billing Receipt' }).catch(function () {
          window.print();
        });
        return;
      }
      if (window.AndroidPrint && typeof window.AndroidPrint.print === 'function') {
        window.AndroidPrint.print('T Billing Receipt');
        return;
      }
      window.print();
    }

    function writeReceiptIntent(action) {
      try {
        localStorage.setItem(RECEIPT_NAV_KEY, JSON.stringify({
          action: action,
          bill: BILL_DATA,
          page: action === 'edit' ? 'billing' : RETURN_PAGE,
          createdAt: Date.now()
        }));
      } catch (e) {}
    }

    function editBillInApp() {
      var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      var opened = false;
      try {
        if (!isCapacitor && window.opener && !window.opener.closed && window.opener.billing && typeof window.opener.billing.setEditMode === 'function') {
          window.opener.billing.setEditMode(BILL_DATA);
          if (window.opener.app && typeof window.opener.app.closeModal === 'function') {
            window.opener.app.closeModal('share-modal');
          }
          try { window.opener.focus(); } catch (e) {}
          opened = true;
        }
      } catch (e) {}

      if (!opened) {
        writeReceiptIntent('edit');
        window.location.replace(APP_URL);
        return;
      }

      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 120);
    }

    function backToApp() {
      var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      writeReceiptIntent('back');
      if (isCapacitor) {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.replace(APP_URL);
        }
        return;
      }
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (window.opener && !window.opener.closed) {
          try { window.opener.focus(); } catch (e) {}
        }
        if (!window.closed) {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.replace(APP_URL);
          }
        }
      }, 120);
    }
  </script>
</body>
</html>`;
  }

  isCapacitor() {
    return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  printReceipt(format = null) {
    const b = this.currentBill;
    if (!b) {
      alert('No bill selected to print.');
      return;
    }

    if (window.app?.showLoading) {
      window.app.showLoading('Preparing receipt print...', 'Generating formatted document');
      setTimeout(() => window.app?.hideLoading(), 1200);
    }

    // Purge all previous receipt keys to prevent localStorage from filling up.
    Object.keys(localStorage)
      .filter((k) => k.startsWith('receipt-'))
      .forEach((k) => localStorage.removeItem(k));

    const receiptKey = this.getReceiptStoreKey();
    const language = document.getElementById('receipt-language')?.value || 'en';
    const selectedFormat = format || document.getElementById('receipt-format')?.value || 'a5';
    try {
      localStorage.setItem(receiptKey, JSON.stringify({
        bill: b,
        receiptLanguage: ['en', 'si', 'ta'].includes(language) ? language : 'en',
        receiptFormat: selectedFormat,
        appUrl: this.getAppReturnUrl(),
        returnPage: window.app?.currentPage || 'billing',
        createdAt: Date.now()
      }));
    } catch (err) {
      alert('Unable to prepare receipt. Please free browser storage and try again.');
      return;
    }

    const receiptUrl = `receipt-print.html?receipt=${encodeURIComponent(receiptKey)}`;

    // In Capacitor (APK), window.open() is blocked by Android WebView.
    // Navigate the current page to the receipt instead; receipt-print.js
    // has Back/Edit buttons that use history.back() or localStorage intent
    // to return to the app.
    if (this.isCapacitor()) {
      // Close the share modal before navigating away
      if (window.app && typeof window.app.closeModal === 'function') {
        window.app.closeModal('share-modal');
      }
      window.location.href = receiptUrl;
      return;
    }

    const printWindow = window.open(receiptUrl, '_blank');
    if (!printWindow) {
      // Fallback: if popup is blocked even in browser, navigate in-page
      window.location.href = receiptUrl;
    }
  }

  viaWhatsApp() {
    const text = encodeURIComponent(this.formatBillText());
    if (this.currentBill && this.currentBill.customerPhone) {
      let phone = this.currentBill.customerPhone.replace(/[^0-9]/g, '');
      if (phone.startsWith('0')) phone = '94' + phone.substring(1);
      window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${text}`, '_blank');
    }
  }

  viaSMS() {
    const text = encodeURIComponent(this.formatBillText());
    const phone = this.currentBill?.customerPhone || '';
    // Use a hidden anchor click so the browser hands the sms: URI to
    // the OS without navigating the current tab away from the app.
    const a = document.createElement('a');
    a.href = `sms:${phone}?body=${text}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async copyText() {
    const text = this.formatBillText();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        alert('Bill text copied to clipboard!');
      } else {
        alert('Clipboard API not available');
      }
    } catch (e) {
      alert('Failed to copy');
    }
  }
}

window.share = new ShareManager();






