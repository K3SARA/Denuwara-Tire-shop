class Inventory {
  constructor() {
    this.products = [];
    this.archivedProducts = [];
    this.inventoryLogs = [];
    this.searchQuery = '';
    this.editingProductId = null;
    this.isEditing = false;
    this.hasChanges = false;
  }

  async init() {
    await this.render();
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

  formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  formatNumber(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return '0';
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  async refreshBillingProducts() {
    if (window.billing) {
      window.billing.availableProducts = await window.db.getProducts();
    }
  }

  // --- Search & Filtering ---
  filterProducts(query = '') {
    this.searchQuery = String(query || '').trim().toLowerCase();
    this.renderProductsList();
  }

  // --- Modal Operations ---
  openAddModal() {
    this.editingProductId = null;
    const title = document.getElementById('inv-modal-title');
    const idInput = document.getElementById('inv-modal-product-id');
    const nameInput = document.getElementById('inv-modal-name');
    const stockInput = document.getElementById('inv-modal-stock');
    const billingPriceInput = document.getElementById('inv-modal-billing-price');
    const invoicePriceInput = document.getElementById('inv-modal-invoice-price');
    const reorderInput = document.getElementById('inv-modal-reorder');
    const reasonInput = document.getElementById('inv-modal-change-reason');

    if (title) title.textContent = 'Add New Product';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (stockInput) stockInput.value = '';
    if (billingPriceInput) billingPriceInput.value = '';
    if (invoicePriceInput) invoicePriceInput.value = '';
    if (reorderInput) reorderInput.value = '5';
    if (reasonInput) reasonInput.value = '';

    window.app?.openModal('inventory-product-modal');
    setTimeout(() => nameInput?.focus(), 80);
  }

  openEditModal(productId) {
    const product = this.products.find((p) => Number(p.id) === Number(productId));
    if (!product) return;

    this.editingProductId = Number(productId);
    const title = document.getElementById('inv-modal-title');
    const idInput = document.getElementById('inv-modal-product-id');
    const nameInput = document.getElementById('inv-modal-name');
    const stockInput = document.getElementById('inv-modal-stock');
    const billingPriceInput = document.getElementById('inv-modal-billing-price');
    const invoicePriceInput = document.getElementById('inv-modal-invoice-price');
    const reorderInput = document.getElementById('inv-modal-reorder');
    const reasonInput = document.getElementById('inv-modal-change-reason');

    if (title) title.textContent = 'Edit Product';
    if (idInput) idInput.value = String(product.id);
    if (nameInput) nameInput.value = product.name || '';
    if (stockInput) stockInput.value = (product.stock !== undefined && product.stock !== null && product.stock !== '' && Number(product.stock) !== 0) ? product.stock : '';
    if (billingPriceInput) billingPriceInput.value = (product.billingPrice && Number(product.billingPrice) > 0) ? product.billingPrice : '';
    if (invoicePriceInput) invoicePriceInput.value = (product.invoicePrice && Number(product.invoicePrice) > 0) ? product.invoicePrice : '';
    if (reorderInput) reorderInput.value = (product.reorderLevel && Number(product.reorderLevel) > 0) ? product.reorderLevel : '5';
    if (reasonInput) reasonInput.value = '';

    window.app?.openModal('inventory-product-modal');
    setTimeout(() => nameInput?.focus(), 80);
  }

  closeProductModal() {
    this.editingProductId = null;
    window.app?.closeModal('inventory-product-modal');
  }

  async saveProductFromModal() {
    const name = (document.getElementById('inv-modal-name')?.value || '').trim();
    const stock = parseFloat(document.getElementById('inv-modal-stock')?.value || '0') || 0;
    const billingPrice = parseFloat(document.getElementById('inv-modal-billing-price')?.value || '0') || 0;
    const invoicePrice = parseFloat(document.getElementById('inv-modal-invoice-price')?.value || '0') || 0;
    const reorderLevel = parseFloat(document.getElementById('inv-modal-reorder')?.value || '5') || 5;
    const reason = (document.getElementById('inv-modal-change-reason')?.value || '').trim();

    if (!name) {
      alert('Product name is required.');
      document.getElementById('inv-modal-name')?.focus();
      return;
    }

    const isEdit = Boolean(this.editingProductId);
    const existing = this.products.find((p) => {
      if (isEdit && Number(p.id) === Number(this.editingProductId)) return false;
      return this.normalizeName(p.name) === this.normalizeName(name);
    });

    if (existing) {
      alert(`A product with name "${name}" already exists in inventory.`);
      return;
    }

    await window.app.withLoading(async () => {
      if (isEdit) {
        const previous = this.products.find((p) => Number(p.id) === Number(this.editingProductId));
        const effectiveReason = reason || 'Product details updated';
        await window.db.updateProduct(this.editingProductId, {
          name,
          stock: Math.max(0, stock),
          billingPrice: Math.max(0, billingPrice),
          invoicePrice: Math.max(0, invoicePrice),
          reorderLevel: Math.max(0, reorderLevel)
        });

        const prevStock = Number(previous?.stock || 0);
        const newStock = Math.max(0, stock);
        const stockDiff = newStock - prevStock;

        await window.db.addInventoryLog({
          productId: this.editingProductId,
          productName: name,
          action: 'manual_adjustment',
          reason: effectiveReason,
          before: {
            name: previous?.name,
            stock: prevStock,
            billingPrice: previous?.billingPrice,
            invoicePrice: previous?.invoicePrice,
            reorderLevel: previous?.reorderLevel
          },
          after: { name, stock: newStock, billingPrice, invoicePrice, reorderLevel },
          addedQty: Math.max(0, stockDiff),
          billingPrice,
          invoicePrice
        });

        await window.db.addAuditLog({
          action: 'inventory_product_update',
          entity: 'product',
          entityId: this.editingProductId,
          details: { productName: name, reason: effectiveReason }
        });
      } else {
        const effectiveReason = reason || 'New product setup';
        const result = await window.db.addProduct(
          name,
          Math.max(0, stock),
          Math.max(0, billingPrice),
          Math.max(0, invoicePrice),
          Math.max(0, reorderLevel)
        );

        if (!result?.ok) {
          alert(result?.error || 'Failed to add product.');
          return;
        }

        if (stock > 0) {
          const products = await window.db.getProducts();
          const created = products.find((p) => this.normalizeName(p.name) === this.normalizeName(name));
          await window.db.addInventoryLog({
            productId: created?.id || null,
            productName: name,
            addedQty: Math.max(0, stock),
            billingPrice,
            invoicePrice,
            reason: effectiveReason,
            action: 'new_product'
          });
        }

        await window.db.addAuditLog({
          action: 'product_create',
          entity: 'product',
          details: { productName: name, stock, reason: effectiveReason }
        });
      }

      this.closeProductModal();
      await this.refreshBillingProducts();
      await this.render();
    }, isEdit ? 'Updating product...' : 'Adding product...', 'Saving to inventory');
  }

  async deleteProduct(productId) {
    const product = this.products.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const confirmed = confirm(`Archive / Delete product "${product.name}" from current inventory? Old bills will stay unchanged.`);
    if (!confirmed) return;

    await window.app.withLoading(async () => {
      const deleted = await window.db.deleteProduct(product.id);
      if (!deleted) {
        alert('Failed to delete product.');
        return;
      }

      await window.db.addAuditLog({
        action: 'product_archive',
        entity: 'product',
        entityId: product.id,
        details: { productName: product.name }
      });
      await this.refreshBillingProducts();
      await this.render();
    }, 'Deleting product...', 'Updating inventory');
  }

  async restoreProduct(productId) {
    const product = this.archivedProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const confirmed = confirm(`Restore product "${product.name}" to active inventory?`);
    if (!confirmed) return;

    await window.app.withLoading(async () => {
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
    }, 'Restoring product...', 'Updating active inventory');
  }

  showProductHistory(productId) {
    const product = [...this.products, ...this.archivedProducts].find((item) => Number(item.id) === Number(productId));
    if (!product) return;
    const logs = this.inventoryLogs
      .filter((log) => Number(log.productId) === Number(productId))
      .slice(0, 10);
    const message = logs.length
      ? logs.map((log) => {
        const when = this.formatDateTime(log.timestamp);
        const action = log.action || 'change';
        const reason = log.reason ? ` - ${log.reason}` : '';
        const qty = log.addedQty ? ` (+${log.addedQty})` : '';
        return `${when}: ${action}${qty}${reason}`;
      }).join('\n')
      : 'No inventory change history for this product yet.';
    alert(`${product.name}\n\n${message}`);
  }

  // --- PDF Export ---
  async printInventoryReport() {
    if (!window.pdfDownload) {
      alert('PDF downloader is still loading. Please try again.');
      return;
    }

    const logs = await window.db.getInventoryLogs();
    window.pdfDownload.downloadStructuredPdf('Inventory Report', {
      metrics: [
        { label: 'Inventory Add Rows', value: logs.length.toLocaleString() },
        { label: 'Active Products', value: this.products.length.toLocaleString() }
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

  // --- Rendering ---
  async render() {
    const list = document.getElementById('inventory-list');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted)">Loading inventory...</div>';

    const [allProducts, inventoryLogs] = await Promise.all([
      window.db.getProducts(true),
      window.db.getInventoryLogs()
    ]);
    this.products = allProducts.filter((product) => !product.inactive);
    this.archivedProducts = allProducts.filter((product) => product.inactive);
    this.inventoryLogs = inventoryLogs;

    this.renderProductsList();
    this.renderArchivedProducts();
  }

  renderProductsList() {
    const list = document.getElementById('inventory-list');
    if (!list) return;

    let filtered = this.products;
    if (this.searchQuery) {
      const q = this.searchQuery;
      filtered = this.products.filter((p) => {
        const nameMatch = (p.name || '').toLowerCase().includes(q);
        const priceMatch = String(p.billingPrice || '').includes(q) || String(p.invoicePrice || '').includes(q);
        const stockMatch = String(p.stock || '').includes(q);
        let statusMatch = false;
        if (q === 'out' || q === 'out of stock') {
          statusMatch = Number(p.stock || 0) <= 0;
        } else if (q === 'low' || q === 'low stock') {
          const r = Number(p.reorderLevel || 5);
          statusMatch = Number(p.stock || 0) > 0 && Number(p.stock || 0) <= r;
        }
        return nameMatch || priceMatch || stockMatch || statusMatch;
      });
    }

    const titleEl = document.getElementById('inv-stock-title');
    if (titleEl) {
      titleEl.textContent = this.searchQuery 
        ? `Search Results (${filtered.length})` 
        : `Current Stock (${this.products.length})`;
    }

    if (filtered.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:36px 20px; color:var(--text-muted); font-size: 0.95rem;">
        ${this.searchQuery ? `No products found matching "${this.escapeHtml(this.searchQuery)}".` : 'No items in inventory.'}
      </div>`;
      return;
    }

    list.innerHTML = filtered.map((p) => {
      const stock = Number(p.stock) || 0;
      const reorderLevel = Number(p.reorderLevel) || 5;
      const billingPrice = Number(p.billingPrice) || 0;
      const invoicePrice = Number(p.invoicePrice) || 0;

      let stockBadge = `<span class="inv-badge inv-badge-in">In Stock: ${this.formatNumber(stock)}</span>`;
      if (stock <= 0) {
        stockBadge = `<span class="inv-badge inv-badge-out">Out of Stock</span>`;
      } else if (stock <= reorderLevel) {
        stockBadge = `<span class="inv-badge inv-badge-low">Low Stock: ${this.formatNumber(stock)}</span>`;
      }

      return `
        <div class="card inventory-item-card">
          <div class="inv-card-header">
            <div class="inv-card-title-group">
              <h4 class="inv-card-name">${this.escapeHtml(p.name)}</h4>
              <div class="inv-card-badges">
                ${stockBadge}
                ${reorderLevel > 0 ? `<span class="inv-meta-pill">Reorder @ ${reorderLevel}</span>` : ''}
              </div>
            </div>
            <div class="inv-card-actions">
              <button type="button" class="btn-tool inv-btn-edit" onclick="inventory.openEditModal(${p.id})" title="Edit Product">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit
              </button>
              <button type="button" class="btn-tool inv-btn-history" onclick="inventory.showProductHistory(${p.id})" title="Stock History">
                History
              </button>
              <button type="button" class="btn-tool danger inv-btn-delete" onclick="inventory.deleteProduct(${p.id})" title="Archive Product">
                Delete
              </button>
            </div>
          </div>
          <div class="inv-card-financials">
            <div class="inv-fin-item">
              <span class="inv-fin-label">Selling Price</span>
              <strong class="inv-fin-val inv-price">LKR ${this.formatNumber(billingPrice)}</strong>
            </div>
            <div class="inv-fin-item">
              <span class="inv-fin-label">Purchase Price</span>
              <span class="inv-fin-val">LKR ${this.formatNumber(invoicePrice)}</span>
            </div>
            <div class="inv-fin-item">
              <span class="inv-fin-label">Stock Qty</span>
              <strong class="inv-fin-val ${stock <= 0 ? 'inv-stock-zero' : ''}">${this.formatNumber(stock)}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderArchivedProducts() {
    const list = document.getElementById('inventory-archived-list');
    if (!list) return;

    if (!this.archivedProducts.length) {
      list.innerHTML = '<div style="text-align:center; padding:12px 20px 24px; color:var(--text-muted)">No archived products.</div>';
      return;
    }

    list.innerHTML = this.archivedProducts.map((p) => `
      <div class="card archived-product-card" style="margin: 8px 20px;">
        <div>
          <strong>${this.escapeHtml(p.name || '-')}</strong>
          <div class="history-date">Archived product</div>
        </div>
        <div class="archived-product-actions">
          <button type="button" class="btn-tool" onclick="inventory.showProductHistory(${Number(p.id)})">History</button>
          <button type="button" class="btn-tool" onclick="inventory.restoreProduct(${Number(p.id)})">Restore</button>
        </div>
      </div>
    `).join('');
  }

  // --- Stubs for backward compatibility ---
  setInputsLocked() {}
  updateSaveButton() {}
  markDirty() {}
  bindChangeTracking() {}
  enableEditing() { this.openAddModal(); }
  clearNewProductInputs() {}
  getNewProductInput() { return {}; }
  renderExistingProductOptions() {}
  selectExistingProduct() {}
  async saveChanges() {}
  async addProduct() { this.openAddModal(); }
  async updateStock() {}
  async updateBillingPrice() {}
  async updateInvoicePrice() {}
}

window.inventory = new Inventory();
