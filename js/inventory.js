class Inventory {
  constructor() {
    this.isEditing = false;
    this.hasChanges = false;
    this.products = [];
    this.archivedProducts = [];
    this.inventoryLogs = [];
  }

  async init() {
    await this.render();
  }

  setInputsLocked(locked) {
    ['inv-existing-product', 'inv-new-name', 'inv-new-stock', 'inv-new-billing-price', 'inv-new-invoice-price', 'inv-new-reorder-level', 'inv-change-reason'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.disabled = locked;
    });

    document.querySelectorAll('[data-inventory-field]').forEach((input) => {
      input.disabled = locked;
    });
    document.querySelectorAll('[data-inventory-delete]').forEach((button) => {
      button.disabled = locked;
    });

    document.getElementById('btn-inventory-edit')?.classList.toggle('hidden', !locked);
    this.updateSaveButton();
  }

  updateSaveButton() {
    const saveBtn = document.getElementById('btn-inventory-save');
    if (!saveBtn) return;
    saveBtn.classList.toggle('hidden', !(this.isEditing && this.hasChanges));
  }

  markDirty() {
    if (!this.isEditing) return;
    this.hasChanges = true;
    this.updateSaveButton();
  }

  bindChangeTracking() {
    const fields = [
      ...document.querySelectorAll('#inv-existing-product, #inv-new-name, #inv-new-stock, #inv-new-billing-price, #inv-new-invoice-price'),
      ...document.querySelectorAll('#inv-new-reorder-level, #inv-change-reason'),
      ...document.querySelectorAll('[data-inventory-field]')
    ];

    fields.forEach((field) => {
      if (field.dataset.inventoryDirtyBound === '1') return;
      field.dataset.inventoryDirtyBound = '1';
      field.addEventListener('input', () => this.markDirty());
      field.addEventListener('change', () => this.markDirty());
    });
  }

  enableEditing() {
    this.isEditing = true;
    this.hasChanges = false;
    this.setInputsLocked(false);
    this.bindChangeTracking();
    this.updateSaveButton();
  }

  clearNewProductInputs() {
    ['inv-existing-product', 'inv-new-name', 'inv-new-stock', 'inv-new-billing-price', 'inv-new-invoice-price', 'inv-new-reorder-level', 'inv-change-reason'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  getNewProductInput() {
    return {
      name: (document.getElementById('inv-new-name')?.value || '').trim(),
      stock: parseFloat(document.getElementById('inv-new-stock')?.value || '0') || 0,
      billingPrice: parseFloat(document.getElementById('inv-new-billing-price')?.value || '0') || 0,
      invoicePrice: parseFloat(document.getElementById('inv-new-invoice-price')?.value || '0') || 0,
      reorderLevel: parseFloat(document.getElementById('inv-new-reorder-level')?.value || '5') || 5
    };
  }

  renderExistingProductOptions() {
    const select = document.getElementById('inv-existing-product');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">New product or choose existing</option>';
    this.products.forEach((product) => {
      const option = document.createElement('option');
      option.value = String(product.id);
      option.textContent = product.name || `Product #${product.id}`;
      select.appendChild(option);
    });

    if (currentValue && this.products.some((product) => String(product.id) === currentValue)) {
      select.value = currentValue;
    }
  }

  selectExistingProduct(productId) {
    const product = this.products.find((item) => String(item.id) === String(productId));
    if (!product) return;

    const nameInput = document.getElementById('inv-new-name');
    const stockInput = document.getElementById('inv-new-stock');
    const billingPriceInput = document.getElementById('inv-new-billing-price');
    const invoicePriceInput = document.getElementById('inv-new-invoice-price');

    if (nameInput) nameInput.value = product.name || '';
    if (stockInput) stockInput.value = '';
    if (billingPriceInput) billingPriceInput.value = Number(product.billingPrice) || 0;
    if (invoicePriceInput) invoicePriceInput.value = Number(product.invoicePrice) || 0;
    const reorderInput = document.getElementById('inv-new-reorder-level');
    if (reorderInput) reorderInput.value = Number(product.reorderLevel) || 5;
    this.markDirty();
  }

  async saveChanges() {
    if (!this.isEditing) return;
    const enteredReason = (document.getElementById('inv-change-reason')?.value || '').trim();
    let reason = enteredReason;

    const updates = this.products.map((product) => {
      const name = (document.getElementById(`inv-name-${product.id}`)?.value || '').trim();
      const stock = parseFloat(document.getElementById(`inv-stock-${product.id}`)?.value || '0') || 0;
      const billingPrice = parseFloat(document.getElementById(`inv-billing-price-${product.id}`)?.value || '0') || 0;
      const invoicePrice = parseFloat(document.getElementById(`inv-invoice-price-${product.id}`)?.value || '0') || 0;
      const reorderLevel = parseFloat(document.getElementById(`inv-reorder-level-${product.id}`)?.value || '5') || 5;
      return {
        id: product.id,
        name,
        stock: Math.max(0, stock),
        billingPrice: Math.max(0, billingPrice),
        invoicePrice: Math.max(0, invoicePrice),
        reorderLevel: Math.max(0, reorderLevel)
      };
    });

    const seenNames = new Set();
    for (const update of updates) {
      if (!update.name) {
        alert('Product name is required.');
        return;
      }

      const key = this.normalizeName(update.name);
      if (seenNames.has(key)) {
        alert('Product names must be unique.');
        return;
      }
      seenNames.add(key);
    }

    const newProduct = this.getNewProductInput();
    const hasExistingProductChanges = updates.some((update) => {
      const previous = this.products.find((product) => Number(product.id) === Number(update.id));
      return previous && (
        (previous.name || '') !== update.name
        || Number(previous.stock || 0) !== Number(update.stock || 0)
        || Number(previous.billingPrice || 0) !== Number(update.billingPrice || 0)
        || Number(previous.invoicePrice || 0) !== Number(update.invoicePrice || 0)
        || Number(previous.reorderLevel || 5) !== Number(update.reorderLevel || 5)
      );
    });

    if (!reason && hasExistingProductChanges) {
      alert('Please enter a change reason before saving inventory changes.');
      document.getElementById('inv-change-reason')?.focus();
      return;
    }

    if (!reason && newProduct.name) {
      reason = 'New product setup';
    }

    for (const update of updates) {
      const previous = this.products.find((product) => Number(product.id) === Number(update.id));
      await window.db.updateProduct(update.id, {
        name: update.name,
        stock: update.stock,
        billingPrice: update.billingPrice,
        invoicePrice: update.invoicePrice,
        reorderLevel: update.reorderLevel
      });
      const changed = previous && (
        (previous.name || '') !== update.name
        || Number(previous.stock || 0) !== Number(update.stock || 0)
        || Number(previous.billingPrice || 0) !== Number(update.billingPrice || 0)
        || Number(previous.invoicePrice || 0) !== Number(update.invoicePrice || 0)
        || Number(previous.reorderLevel || 5) !== Number(update.reorderLevel || 5)
      );
      if (changed) {
        await window.db.addInventoryLog({
          productId: update.id,
          productName: update.name,
          action: 'manual_adjustment',
          reason,
          before: {
            name: previous.name,
            stock: previous.stock,
            billingPrice: previous.billingPrice,
            invoicePrice: previous.invoicePrice,
            reorderLevel: previous.reorderLevel
          },
          after: update,
          addedQty: Math.max(0, Number(update.stock || 0) - Number(previous.stock || 0)),
          billingPrice: update.billingPrice,
          invoicePrice: update.invoicePrice
        });
      }
    }
    await window.db.addAuditLog({
      action: 'inventory_save',
      entity: 'inventory',
      details: { updatedProducts: updates.length, reason }
    });

    if (newProduct.name) {
      const existing = this.products.find((product) => this.normalizeName(product.name) === this.normalizeName(newProduct.name));
      if (existing) {
        const addedQty = Math.max(0, newProduct.stock);
        await window.db.updateProduct(existing.id, {
          stock: Math.max(0, (parseFloat(existing.stock) || 0) + addedQty),
          billingPrice: newProduct.billingPrice > 0 ? newProduct.billingPrice : (Number(existing.billingPrice) || 0),
          invoicePrice: newProduct.invoicePrice > 0 ? newProduct.invoicePrice : (Number(existing.invoicePrice) || 0)
        });
        if (addedQty > 0) {
          await window.db.addInventoryLog({
            productId: existing.id,
            productName: existing.name,
            addedQty,
            billingPrice: newProduct.billingPrice > 0 ? newProduct.billingPrice : (Number(existing.billingPrice) || 0),
            invoicePrice: newProduct.invoicePrice > 0 ? newProduct.invoicePrice : (Number(existing.invoicePrice) || 0),
            action: 'restock'
          });
          await window.db.addAuditLog({
            action: 'inventory_restock',
            entity: 'product',
            entityId: existing.id,
            details: { productName: existing.name, addedQty, reason }
          });
        }
      } else {
        const result = await window.db.addProduct(
          newProduct.name,
          newProduct.stock,
          newProduct.billingPrice,
          newProduct.invoicePrice,
          newProduct.reorderLevel
        );
        if (!result?.ok) {
          alert(result?.error || 'Failed to add product.');
          return;
        }
        if (newProduct.stock > 0) {
          const products = await window.db.getProducts();
          const created = products.find((product) => this.normalizeName(product.name) === this.normalizeName(newProduct.name));
          await window.db.addInventoryLog({
            productId: created?.id || null,
            productName: newProduct.name,
            addedQty: Math.max(0, newProduct.stock),
            billingPrice: newProduct.billingPrice,
            invoicePrice: newProduct.invoicePrice,
            action: 'new_product'
          });
        }
        await window.db.addAuditLog({
          action: 'product_create',
          entity: 'product',
          details: { productName: newProduct.name, stock: newProduct.stock, reason }
        });
      }
    }

    this.isEditing = false;
    this.hasChanges = false;
    this.clearNewProductInputs();
    await this.refreshBillingProducts();
    await this.render();
  }

  async addProduct() {
    if (!this.isEditing) {
      alert('Press Edit Inventory before adding products.');
      return;
    }
    await this.saveChanges();
  }

  async updateStock() {
    if (!this.isEditing) return;
    await this.saveChanges();
  }

  async updateBillingPrice() {
    if (!this.isEditing) return;
    await this.saveChanges();
  }

  async updateInvoicePrice() {
    if (!this.isEditing) return;
    await this.saveChanges();
  }

  async deleteProduct(productId) {
    if (!this.isEditing) {
      alert('Press Edit Inventory before deleting products.');
      return;
    }

    const product = this.products.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const confirmed = confirm(`Delete product "${product.name}" from current inventory? Old bills and inventory add logs will stay unchanged.`);
    if (!confirmed) return;

    const deleted = await window.db.deleteProduct(product.id);
    if (!deleted) {
      alert('Failed to delete product.');
      return;
    }

    this.hasChanges = false;
    await window.db.addAuditLog({
      action: 'product_archive',
      entity: 'product',
      entityId: product.id,
      details: { productName: product.name }
    });
    await this.refreshBillingProducts();
    await this.render();
  }

  async restoreProduct(productId) {
    if (!this.isEditing) {
      alert('Press Edit Inventory before restoring products.');
      return;
    }

    const product = this.archivedProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const confirmed = confirm(`Restore product "${product.name}" to active inventory?`);
    if (!confirmed) return;

    const restored = await window.db.restoreProduct(product.id);
    if (!restored) {
      alert('Failed to restore product.');
      return;
    }

    await window.db.addAuditLog({
      action: 'product_restore',
      entity: 'product',
      entityId: product.id,
      details: { productName: product.name }
    });
    await this.refreshBillingProducts();
    await this.render();
  }

  showProductHistory(productId) {
    const product = [...this.products, ...this.archivedProducts].find((item) => Number(item.id) === Number(productId));
    if (!product) return;
    const logs = this.inventoryLogs
      .filter((log) => Number(log.productId) === Number(productId))
      .slice(0, 8);
    const message = logs.length
      ? logs.map((log) => {
        const when = this.formatDateTime(log.timestamp);
        const action = log.action || 'change';
        const reason = log.reason ? ` - ${log.reason}` : '';
        return `${when}: ${action}${reason}`;
      }).join('\n')
      : 'No inventory history for this product yet.';
    alert(`${product.name}\n\n${message}`);
  }

  async refreshBillingProducts() {
    if (window.billing) {
      window.billing.availableProducts = await window.db.getProducts();
    }
  }

  formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  formatNumber(value) {
    return (Number(value) || 0).toLocaleString();
  }

  getPrintViewerToolbar() {
    return `
      <div class="print-actions">
        <button type="button" onclick="window.print()">Print</button>
        <button type="button" class="back-btn" onclick="backToApp()">Back to App</button>
      </div>
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
  buildInventoryPrintHtml(logs) {
    const generatedAt = new Date().toLocaleString();
    const rows = logs.map((log) => `
      <tr>
        <td>${this.escapeHtml(log.productName || '-')}</td>
        <td class="num">${this.escapeHtml(this.formatNumber(log.addedQty))}</td>
        <td class="num">LKR ${this.escapeHtml(this.formatNumber(log.billingPrice))}</td>
        <td class="num">LKR ${this.escapeHtml(this.formatNumber(log.invoicePrice))}</td>
        <td>${this.escapeHtml(this.formatDateTime(log.timestamp))}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Inventory Report</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { margin-bottom: 14px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; }
  .summary { margin: 10px 0 14px; font-weight: 700; }
  ${this.getPrintViewerStyles()}
</style>
</head>
<body>
  ${this.getPrintViewerToolbar()}
  <h1>Inventory Report</h1>
  <div class="meta">Generated: ${this.escapeHtml(generatedAt)}</div>
  <div class="summary">Inventory Add Rows: ${logs.length.toLocaleString()}</div>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th>Added Qty</th>
        <th>Selling Price</th>
        <th>Purchase Price</th>
        <th>Added Date & Time</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No inventory data</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
  }

  async printInventoryReport() {
    if (!window.pdfDownload) {
      alert('PDF downloader is still loading. Please try again.');
      return;
    }

    const logs = await window.db.getInventoryLogs();
    window.pdfDownload.downloadStructuredPdf('Inventory Report', {
      metrics: [
        { label: 'Inventory Add Rows', value: logs.length.toLocaleString() }
      ],
      tables: [{
        headers: ['Product', 'Added Qty', 'Selling Price', 'Purchase Price', 'Added Date & Time'],
        rows: logs.map((log) => [
          log.productName || '-',
          this.formatNumber(log.addedQty),
          `LKR ${this.formatNumber(log.billingPrice)}`,
          `LKR ${this.formatNumber(log.invoicePrice)}`,
          this.formatDateTime(log.timestamp)
        ])
      }]
    }, `inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async render() {
    const list = document.getElementById('inventory-list');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';

    const [allProducts, inventoryLogs] = await Promise.all([
      window.db.getProducts(true),
      window.db.getInventoryLogs()
    ]);
    this.products = allProducts.filter((product) => !product.inactive);
    this.archivedProducts = allProducts.filter((product) => product.inactive);
    this.inventoryLogs = inventoryLogs;
    this.renderExistingProductOptions();
    this.setInputsLocked(!this.isEditing);
    this.bindChangeTracking();

    if (this.products.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No items in inventory.</div>';
      this.renderExistingProductOptions();
      this.setInputsLocked(!this.isEditing);
      this.bindChangeTracking();
      this.renderArchivedProducts();
      return;
    }

    list.innerHTML = '';
    this.products.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'card bill-item';

      const currentStock = Number(p.stock) || 0;
      const billingPrice = Number(p.billingPrice) || 0;
      const invoicePrice = Number(p.invoicePrice) || 0;
      const reorderLevel = Number(p.reorderLevel) || 5;
      const disabled = this.isEditing ? '' : ' disabled';

      el.innerHTML = `
        <div class="item-header inventory-product-header">
          <input type="text" id="inv-name-${p.id}" data-inventory-field class="input-field inventory-name-input" value="${this.escapeHtml(p.name)}"${disabled}>
          <button class="inventory-history-btn" onclick="inventory.showProductHistory(${p.id})">History</button>
          <button class="inventory-delete-btn" data-inventory-delete onclick="inventory.deleteProduct(${p.id})"${disabled}>Delete</button>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:14px;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            <span style="color:var(--text-muted); font-size:0.85rem;">Stock</span>
            <input type="number" id="inv-stock-${p.id}" data-inventory-field class="input-field" value="${currentStock}" step="0.01" style="text-align:right;"${disabled}>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <span style="color:var(--text-muted); font-size:0.85rem;">Selling Price</span>
            <input type="number" id="inv-billing-price-${p.id}" data-inventory-field class="input-field" value="${billingPrice}" step="0.01" style="text-align:right;"${disabled}>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <span style="color:var(--text-muted); font-size:0.85rem;">Purchase Price</span>
            <input type="number" id="inv-invoice-price-${p.id}" data-inventory-field class="input-field" value="${invoicePrice}" step="0.01" style="text-align:right;"${disabled}>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <span style="color:var(--text-muted); font-size:0.85rem;">Reorder Level</span>
            <input type="number" id="inv-reorder-level-${p.id}" data-inventory-field class="input-field" value="${reorderLevel}" step="0.01" style="text-align:right;"${disabled}>
          </div>
          <div style="display:flex; align-items:flex-end; justify-content:flex-end;">
            <div>
              ${currentStock <= 0 ? '<span style="color:var(--danger-color); font-size:0.8rem; font-weight:600;">Out of Stock</span>' : ''}
              ${currentStock > 0 && currentStock <= reorderLevel ? '<span style="color:orange; font-size:0.8rem; font-weight:600;">Low Stock</span>' : ''}
            </div>
          </div>
        </div>
      `;
      list.appendChild(el);
    });

    this.setInputsLocked(!this.isEditing);
    this.bindChangeTracking();
    this.renderArchivedProducts();
  }

  renderArchivedProducts() {
    const list = document.getElementById('inventory-archived-list');
    if (!list) return;

    if (!this.archivedProducts.length) {
      list.innerHTML = '<div style="text-align:center; padding:12px 20px 24px; color:var(--text-muted)">No archived products.</div>';
      return;
    }

    list.innerHTML = this.archivedProducts.map((p) => `
      <div class="card archived-product-card">
        <div>
          <strong>${this.escapeHtml(p.name || '-')}</strong>
          <div class="history-date">Archived product</div>
        </div>
        <div class="archived-product-actions">
          <button class="btn-tool" onclick="inventory.showProductHistory(${Number(p.id)})">History</button>
          <button class="btn-tool" onclick="inventory.restoreProduct(${Number(p.id)})"${this.isEditing ? '' : ' disabled'}>Restore</button>
        </div>
      </div>
    `).join('');
  }
}

window.inventory = new Inventory();



