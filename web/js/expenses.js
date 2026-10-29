class ExpensesPage {
  constructor() {
    this.expenses = [];
    this.bound = false;
  }

  init() {
    this.bindEvents();
    this.setDefaultDate();
  }

  bindEvents() {
    if (this.bound) return;
    this.bound = true;

    const addBtn = document.getElementById('btn-add-expense');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.addExpense());
    }

    ['expense-date-from', 'expense-date-to'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) {
        const refreshFilteredList = () => {
          this.renderTotal();
          this.renderList();
        };
        input.addEventListener('input', refreshFilteredList);
        input.addEventListener('change', refreshFilteredList);
      }
    });

    const clearFilterBtn = document.getElementById('btn-clear-expense-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => this.clearDateFilter());
    }

    const cancelEditBtn = document.getElementById('btn-cancel-expense-edit');
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', () => this.clearForm());
    }
  }

  setDefaultDate() {
    const dateInput = document.getElementById('expense-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
  }

  formatCurrency(value) {
    return `LKR ${Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;
  }

  escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  async addExpense() {
    const nameInput = document.getElementById('expense-name');
    const amountInput = document.getElementById('expense-amount');
    const categoryInput = document.getElementById('expense-category');
    const dateInput = document.getElementById('expense-date');
    const noteInput = document.getElementById('expense-note');
    const editIdInput = document.getElementById('expense-edit-id');

    const name = (nameInput?.value || '').trim();
    const amount = parseFloat(amountInput?.value || '0');
    const category = categoryInput?.value || 'Other';
    const date = dateInput?.value || new Date().toISOString().slice(0, 10);
    const note = (noteInput?.value || '').trim();
    const editId = editIdInput?.value || '';

    if (!name) {
      alert('Expense name is required.');
      nameInput?.focus();
      return;
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid expense amount.');
      amountInput?.focus();
      return;
    }

    if (amount > 10_000_000) {
      alert('Expense amount looks too high (maximum LKR 10,000,000). Please double-check.');
      amountInput?.focus();
      return;
    }

    if (editId) {
      const updated = await window.db.updateExpense(editId, { name, amount, category, date, note });
      if (!updated) {
        alert('Failed to update expense.');
        return;
      }
      await window.db.addAuditLog({
        action: 'expense_update',
        entity: 'expense',
        entityId: Number(editId),
        details: { name, amount, category }
      });
    } else {
      const result = await window.db.addExpense({ name, amount, category, date, note });
      if (!result.ok) {
        alert(result.error || 'Failed to add expense.');
        return;
      }
      await window.db.addAuditLog({
        action: 'expense_create',
        entity: 'expense',
        entityId: result.id,
        details: { name, amount, category }
      });
    }

    this.clearForm();
    await this.render();
  }

  async deleteExpense(id) {
    const confirmed = confirm('Delete this expense?');
    if (!confirmed) return;

    await window.db.deleteExpense(id);
    await window.db.addAuditLog({
      action: 'expense_delete',
      entity: 'expense',
      entityId: Number(id),
      details: {}
    });
    await this.render();
  }

  editExpense(id) {
    const expense = this.expenses.find((item) => Number(item.id) === Number(id));
    if (!expense) return;

    document.getElementById('expense-edit-id').value = expense.id;
    document.getElementById('expense-name').value = expense.name || '';
    document.getElementById('expense-amount').value = Number(expense.amount) || 0;
    document.getElementById('expense-category').value = expense.category || 'Other';
    document.getElementById('expense-date').value = expense.date || new Date().toISOString().slice(0, 10);
    document.getElementById('expense-note').value = expense.note || '';
    document.getElementById('btn-add-expense').textContent = 'Save Expense';
    document.getElementById('btn-cancel-expense-edit')?.classList.remove('hidden');
    document.getElementById('expense-name')?.focus();
  }

  clearForm() {
    const nameInput = document.getElementById('expense-name');
    const amountInput = document.getElementById('expense-amount');
    const categoryInput = document.getElementById('expense-category');
    const noteInput = document.getElementById('expense-note');
    const editIdInput = document.getElementById('expense-edit-id');

    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (categoryInput) categoryInput.value = 'Other';
    if (noteInput) noteInput.value = '';
    if (editIdInput) editIdInput.value = '';
    const addBtn = document.getElementById('btn-add-expense');
    if (addBtn) addBtn.textContent = 'Add Expense';
    document.getElementById('btn-cancel-expense-edit')?.classList.add('hidden');
    this.setDefaultDate();
  }

  clearDateFilter() {
    const fromInput = document.getElementById('expense-date-from');
    const toInput = document.getElementById('expense-date-to');
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    this.renderTotal();
    this.renderList();
  }

  getFilteredExpenses() {
    const from = document.getElementById('expense-date-from')?.value || '';
    const to = document.getElementById('expense-date-to')?.value || '';

    return this.expenses.filter((expense) => {
      const date = expense.date || '';
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
  }

  buildExpensesPrintHtml(expenses) {
    const generatedAt = new Date().toLocaleString();
    const total = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    const rows = expenses.map((expense) => `
      <tr>
        <td>${this.escapeHtml(expense.date || '')}</td>
        <td>${this.escapeHtml(expense.name || '')}</td>
        <td>${this.escapeHtml(expense.category || 'Other')}</td>
        <td>${this.escapeHtml(expense.note || '')}</td>
        <td class="num">${this.escapeHtml(this.formatCurrency(expense.amount))}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Expenses Report</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { margin-bottom: 14px; color: #555; }
  .summary { margin: 10px 0 14px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; }
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
  .print-actions .back-btn { background: #111; color: #fff; }
  @media print { .print-actions { display: none !important; } }
</style>
</head>
<body>
  <div class="print-actions">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" class="back-btn" onclick="backToApp()">Back to App</button>
  </div>
  <h1>Expenses Report</h1>
  <div class="meta">Generated: ${this.escapeHtml(generatedAt)}</div>
  <div class="summary">Entries: ${expenses.length.toLocaleString()} | Total: ${this.escapeHtml(this.formatCurrency(total))}</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Expense</th>
        <th>Category</th>
        <th>Note</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No expenses found.</td></tr>'}
    </tbody>
  </table>
  <script>
    function backToApp() {
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (window.opener && !window.opener.closed) {
          try { window.opener.focus(); } catch (e) {}
        }
      }, 120);
    }
  <\/script>
</body>
</html>`;
  }

  printExpenses() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Popup blocked. Please allow popups to print expenses.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(this.buildExpensesPrintHtml(this.getFilteredExpenses()));
    printWindow.document.close();
  }
  async render() {
    this.setDefaultDate();
    this.expenses = await window.db.getExpenses();
    this.renderTotal();
    this.renderList();
  }

  renderTotal() {
    const totalEl = document.getElementById('expenses-total');
    if (!totalEl) return;

    const total = this.getFilteredExpenses().reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    totalEl.textContent = this.formatCurrency(total);
  }

  renderList() {
    const list = document.getElementById('expenses-list');
    if (!list) return;

    const filteredExpenses = this.getFilteredExpenses();
    if (!filteredExpenses.length) {
      const hasExpenses = this.expenses.length > 0;
      list.innerHTML = `
        <div class="card expense-empty">
          ${hasExpenses ? 'No expenses found for this date range.' : 'No expenses added yet.'}
        </div>
      `;
      return;
    }

    list.innerHTML = filteredExpenses.map((expense) => `
      <div class="expense-card">
        <div class="expense-row-top">
          <div class="expense-main">
            <div class="expense-name">${this.escapeHtml(expense.name)}</div>
            <div class="expense-date">${this.escapeHtml(expense.date || '')}</div>
            <div class="expense-category">${this.escapeHtml(expense.category || 'Other')}</div>
            ${expense.note ? `<div class="expense-note">${this.escapeHtml(expense.note)}</div>` : ''}
          </div>
          <div class="expense-side">
            <div class="expense-amount">${this.formatCurrency(expense.amount)}</div>
            <button class="expense-edit-btn" onclick="expensesPage.editExpense(${Number(expense.id)})">Edit</button>
            <button class="expense-delete-btn" onclick="expensesPage.deleteExpense(${Number(expense.id)})" title="Delete expense" aria-label="Delete expense">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18"></path>
                <path d="M8 6V4h8v2"></path>
                <path d="M6 6l1 15h10l1-15"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }
}

window.expensesPage = new ExpensesPage();

