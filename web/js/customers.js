class CustomersPage {
  constructor() {
    this.customers = [];
    this.bills = [];
    this.bound = false;
    this.selectedCustomerId = null;
    this.map = null;
    this.mapMarker = null;
    this.mapMode = 'view';
    this.pendingMapCustomerId = null;
    this.pendingManualLocation = null;
    this.mapSearchController = null;
    this.importRows = [];
    this.importFileName = '';
    this.importInProgress = false;
  }

  getSearchQuery() {
    const input = document.getElementById('customers-search');
    return (input?.value || '').trim().toLowerCase();
  }

  openImportModal() {
    this.resetImportState();
    app.openModal('customer-import-modal');
  }

  closeImportModal() {
    if (this.importInProgress) return;
    app.closeModal('customer-import-modal');
  }

  resetImportState() {
    this.importRows = [];
    this.importFileName = '';
    const fileInput = document.getElementById('customer-import-file');
    const message = document.getElementById('customer-import-message');
    const summary = document.getElementById('customer-import-summary');
    const preview = document.getElementById('customer-import-preview');
    const importButton = document.getElementById('btn-confirm-customer-import');
    if (fileInput) fileInput.value = '';
    if (message) {
      message.className = 'customer-import-message';
      message.textContent = 'Choose a CSV file to preview its rows.';
    }
    if (summary) {
      summary.classList.add('hidden');
      summary.innerHTML = '';
    }
    if (preview) preview.innerHTML = '';
    if (importButton) {
      importButton.disabled = true;
      importButton.textContent = 'Import Valid Customers';
    }
  }

  downloadImportTemplate() {
    const content = '\uFEFFName,Phone,Address\r\nKamal Perera,0771234567,Matale\r\nNimal Silva,0712345678,"Kandy, Sri Lanka"\r\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customer-import-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  parseCsv(text) {
    const input = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (quoted) {
        if (char === '"' && input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        row.push(field);
        if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error('CSV contains an unclosed quotation mark. Check the file and try again.');
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
    return rows;
  }

  normalizeImportHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  normalizeCustomerImportName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async handleCustomerCsvFile(file) {
    this.importRows = [];
    const message = document.getElementById('customer-import-message');
    const summary = document.getElementById('customer-import-summary');
    const preview = document.getElementById('customer-import-preview');
    const importButton = document.getElementById('btn-confirm-customer-import');
    if (summary) {
      summary.classList.add('hidden');
      summary.innerHTML = '';
    }
    if (preview) preview.innerHTML = '';
    if (importButton) importButton.disabled = true;
    if (!file) return;

    const setMessage = (text, type = '') => {
      if (!message) return;
      message.className = `customer-import-message${type ? ` ${type}` : ''}`;
      message.textContent = text;
    };

    if (!/\.csv$/i.test(file.name || '')) {
      setMessage('Please select a .csv file. Excel files must be saved as CSV first.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('This file is larger than 5 MB. Split it into smaller CSV files and try again.', 'error');
      return;
    }
    if (file.size === 0) {
      setMessage('The selected CSV file is empty.', 'error');
      return;
    }

    try {
      const rawRows = this.parseCsv(await file.text());
      if (rawRows.length < 2) throw new Error('The CSV must contain a header row and at least one customer row.');

      const headers = rawRows[0].map((header) => this.normalizeImportHeader(header));
      const findHeader = (aliases) => headers.findIndex((header) => aliases.includes(header));
      const nameIndex = findHeader(['name', 'customername', 'fullname', 'customer']);
      const phoneIndex = findHeader(['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'contact', 'contactnumber']);
      const addressIndex = findHeader(['address', 'customeraddress', 'residentialaddress']);
      if (nameIndex < 0) {
        throw new Error('A Name or Customer Name column is required. Use the Download CSV Template button for the correct format.');
      }

      const existingCustomers = await window.db.getCustomers();
      const existingNames = new Set(existingCustomers.map((customer) => this.normalizeCustomerImportName(customer.name)));
      const seenFileNames = new Set();
      const rows = [];

      rawRows.slice(1).forEach((cells, index) => {
        const name = String(cells[nameIndex] || '').trim();
        const phone = phoneIndex >= 0 ? String(cells[phoneIndex] || '').trim() : '';
        const address = addressIndex >= 0 ? String(cells[addressIndex] || '').trim() : '';
        const line = index + 2;
        let status = 'ready';
        let reason = 'Ready to import';

        if (!name) {
          status = 'invalid';
          reason = 'Name is required';
        } else if (name.length > 120) {
          status = 'invalid';
          reason = 'Name must be 120 characters or fewer';
        } else if (phone && (!/^[0-9+()\s.-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) {
          status = 'invalid';
          reason = 'Phone must contain 7–15 digits (spaces, +, hyphens and brackets are allowed)';
        } else if (address.length > 300) {
          status = 'invalid';
          reason = 'Address must be 300 characters or fewer';
        } else {
          const normalizedName = this.normalizeCustomerImportName(name);
          if (existingNames.has(normalizedName) || seenFileNames.has(normalizedName)) {
            status = 'duplicate';
            reason = 'Customer name already exists';
          } else {
            seenFileNames.add(normalizedName);
          }
        }

        rows.push({ line, name, phone, address, status, reason });
      });

      if (!rows.length) throw new Error('No customer rows were found in this CSV.');
      this.importRows = rows;
      this.importFileName = file.name;
      this.renderImportPreview();
      const ready = rows.filter((row) => row.status === 'ready').length;
      const duplicate = rows.filter((row) => row.status === 'duplicate').length;
      const invalid = rows.filter((row) => row.status === 'invalid').length;
      setMessage(`${file.name}: preview ready. Existing customers have not been changed yet.`, 'success');
      if (importButton) {
        importButton.disabled = ready === 0;
        importButton.textContent = ready > 0 ? `Import ${ready} Valid Customer${ready === 1 ? '' : 's'}` : 'No Valid Customers to Import';
      }
      if (summary) {
        summary.classList.remove('hidden');
        summary.innerHTML = `
          <div class="customer-import-stat"><strong>${ready}</strong>Ready</div>
          <div class="customer-import-stat"><strong>${duplicate}</strong>Duplicates skipped</div>
          <div class="customer-import-stat"><strong>${invalid}</strong>Invalid rows</div>`;
      }
    } catch (error) {
      setMessage(error?.message || 'Could not read this CSV file.', 'error');
      this.importRows = [];
    }
  }

  renderImportPreview() {
    const preview = document.getElementById('customer-import-preview');
    if (!preview) return;
    const rows = this.importRows.slice(0, 100);
    const body = rows.map((row) => `
      <tr>
        <td>${row.line}</td>
        <td>${this.escapeHtml(row.name || '—')}</td>
        <td>${this.escapeHtml(row.phone || '—')}</td>
        <td>${this.escapeHtml(row.address || '—')}</td>
        <td><span class="customer-import-status ${row.status}">${this.escapeHtml(row.reason)}</span></td>
      </tr>`).join('');
    preview.innerHTML = `
      <table>
        <thead><tr><th>CSV row</th><th>Name</th><th>Phone</th><th>Address</th><th>Result</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${this.importRows.length > 100 ? `<p class="customer-import-help">Showing first 100 of ${this.importRows.length} rows. All rows are included in the counts.</p>` : ''}`;
  }

  async importValidCustomers() {
    if (this.importInProgress) return;
    const readyRows = this.importRows.filter((row) => row.status === 'ready');
    if (!readyRows.length) return;

    const button = document.getElementById('btn-confirm-customer-import');
    const message = document.getElementById('customer-import-message');
    this.importInProgress = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Importing...';
    }
    const closeButton = document.getElementById('btn-close-customer-import');
    if (closeButton) closeButton.disabled = true;
    if (message) {
      message.className = 'customer-import-message';
      message.textContent = `Importing ${readyRows.length} customers. Please keep this window open.`;
    }

    let imported = 0;
    let failed = 0;
    try {
      for (const row of readyRows) {
        try {
          const result = await window.db.addCustomer(row.name, row.phone, row.address);
          if (!result?.ok) {
            failed += 1;
            row.status = 'duplicate';
            row.reason = result?.error || 'Could not add customer';
            continue;
          }
          imported += 1;
          row.status = 'imported';
          row.reason = 'Imported';
          await window.db.addAuditLog({
            action: 'customer_import',
            entity: 'customer',
            entityId: result.id,
            details: { name: row.name, sourceFile: this.importFileName, csvRow: row.line }
          });
        } catch (error) {
          failed += 1;
          row.status = 'invalid';
          row.reason = 'Import failed';
        }
      }

      if (message) {
        message.className = `customer-import-message ${failed ? '' : 'success'}`.trim();
        message.textContent = `Import complete: ${imported} added, ${failed} failed or skipped. Review the row results below.`;
      }
      this.renderImportPreview();
      const summary = document.getElementById('customer-import-summary');
      if (summary) {
        summary.classList.remove('hidden');
        const duplicates = this.importRows.filter((row) => row.status === 'duplicate').length;
        const invalid = this.importRows.filter((row) => row.status === 'invalid').length;
        summary.innerHTML = `
          <div class="customer-import-stat"><strong>${imported}</strong>Imported</div>
          <div class="customer-import-stat"><strong>${duplicates}</strong>Duplicates/skipped</div>
          <div class="customer-import-stat"><strong>${invalid}</strong>Invalid/failed</div>`;
      }
      if (button) {
        button.textContent = 'Import Complete';
        button.disabled = true;
      }
      await this.render();
      if (window.billing) {
        await window.billing.loadCustomerDirectory();
        await window.billing.loadOutstandingDirectory();
      }
    } finally {
      this.importInProgress = false;
      if (closeButton) closeButton.disabled = false;
    }
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  getDeleteIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>';
  }

  getEditIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  }

  hasLocation(customer) {
    return Number.isFinite(Number(customer?.locationLat)) && Number.isFinite(Number(customer?.locationLng));
  }

  getSelectedCustomer() {
    return this.customers.find((customer) => Number(customer.id) === Number(this.selectedCustomerId)) || null;
  }

  formatLocationStatus(customer) {
    if (!customer) return 'Enter customer details, then tap Save Current Location.';
    if (!this.hasLocation(customer)) return 'No location saved';
    const when = customer.locationUpdatedAt ? new Date(customer.locationUpdatedAt).toLocaleString() : '';
    const accuracy = Number(customer.locationAccuracy || 0);
    const accuracyText = accuracy > 0 ? `, accuracy ${Math.round(accuracy)}m` : '';
    return `Saved${when ? ` ${when}` : ''}${accuracyText}`;
  }

  updateLocationControls() {
    const customer = this.getSelectedCustomer();
    const status = document.getElementById('customer-location-status');
    const saveBtn = document.getElementById('btn-save-customer-location');
    const setMapBtn = document.getElementById('btn-set-customer-location-map');
    const viewBtn = document.getElementById('btn-view-customer-location');
    const clearBtn = document.getElementById('btn-clear-customer-location');

    if (status) status.textContent = this.formatLocationStatus(customer);
    if (saveBtn) saveBtn.disabled = false;
    if (setMapBtn) setMapBtn.disabled = false;
    if (viewBtn) viewBtn.disabled = !this.hasLocation(customer);
    if (clearBtn) clearBtn.disabled = !this.hasLocation(customer);
  }

  async ensureCustomerForLocation() {
    let customer = this.getSelectedCustomer();
    if (customer) return customer;

    const name = (document.getElementById('edit-customer-name')?.value || '').trim();
    const phone = (document.getElementById('edit-customer-phone')?.value || '').trim();
    const address = (document.getElementById('edit-customer-address')?.value || '').trim();

    if (!name) {
      alert('Enter the customer name before saving a map location.');
      return null;
    }

    const duplicate = this.customers.find((item) => (item.name || '').trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      this.selectedCustomerId = duplicate.id;
      customer = duplicate;
      const title = document.getElementById('customer-modal-title');
      if (title) title.innerText = 'Edit Customer';
      return customer;
    }

    const result = await window.db.addCustomer(name, phone, address);
    if (!result?.ok) {
      alert(result?.error || 'Failed to add customer.');
      return null;
    }

    await window.db.addAuditLog({
      action: 'customer_create',
      entity: 'customer',
      entityId: result.id,
      details: { name, createdForLocation: true }
    });
    this.selectedCustomerId = result.id;
    this.customers = await window.db.getCustomers();
    customer = this.getSelectedCustomer();
    const title = document.getElementById('customer-modal-title');
    if (title) title.innerText = 'Edit Customer';
    this.renderList(this.getFilteredCustomers());
    if (window.billing) {
      await window.billing.loadCustomerDirectory();
      await window.billing.loadOutstandingDirectory();
    }
    this.updateLocationControls();
    return customer;
  }

  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not available on this device.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000
      });
    });
  }

  async saveCurrentLocation() {
    const customer = await this.ensureCustomerForLocation();
    if (!customer) {
      return;
    }

    const btn = document.getElementById('btn-save-customer-location');
    const previousText = btn?.textContent || '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Getting Location...';
    }

    try {
      const position = await this.getCurrentPosition();
      const updates = {
        locationLat: position.coords.latitude,
        locationLng: position.coords.longitude,
        locationAccuracy: position.coords.accuracy || 0,
        locationUpdatedAt: new Date().getTime()
      };
      await window.db.updateCustomer(customer.id, updates);
      Object.assign(customer, updates);
      await window.db.addAuditLog({
        action: 'customer_location_update',
        entity: 'customer',
        entityId: customer.id,
        details: {
          name: customer.name || '',
          locationAccuracy: Math.round(updates.locationAccuracy || 0)
        }
      });
      this.updateLocationControls();
      this.renderList(this.getFilteredCustomers());
    } catch (err) {
      alert(err?.message || 'Unable to get current location. Check location permission and try again.');
    } finally {
      if (btn) {
        btn.textContent = previousText;
        btn.disabled = false;
      }
      this.updateLocationControls();
    }
  }

  async saveLocationToCustomer(customer, lat, lng, source = 'manual', accuracy = 0) {
    const updates = {
      locationLat: lat,
      locationLng: lng,
      locationAccuracy: accuracy,
      locationUpdatedAt: new Date().getTime(),
      locationSource: source
    };
    await window.db.updateCustomer(customer.id, updates);
    Object.assign(customer, updates);
    await window.db.addAuditLog({
      action: 'customer_location_update',
      entity: 'customer',
      entityId: customer.id,
      details: {
        name: customer.name || '',
        source,
        locationAccuracy: Math.round(accuracy || 0)
      }
    });
    this.updateLocationControls();
    this.renderList(this.getFilteredCustomers());
    return updates;
  }

  async clearCurrentLocation() {
    const customer = this.getSelectedCustomer();
    if (!this.hasLocation(customer)) return;
    const confirmed = confirm(`Clear saved map location for "${customer.name}"?`);
    if (!confirmed) return;

    const updates = {
      locationLat: null,
      locationLng: null,
      locationAccuracy: null,
      locationUpdatedAt: null
    };
    await window.db.updateCustomer(customer.id, updates);
    Object.assign(customer, updates);
    await window.db.addAuditLog({
      action: 'customer_location_clear',
      entity: 'customer',
      entityId: customer.id,
      details: { name: customer.name || '' }
    });
    this.updateLocationControls();
    this.renderList(this.getFilteredCustomers());
  }

  async openManualMapPicker() {
    const customer = await this.ensureCustomerForLocation();
    if (!customer) return;
    this.openMapModal(customer.id, { mode: 'set' });
  }

  openMapModal(customerId, options = {}) {
    const customer = this.customers.find((c) => Number(c.id) === Number(customerId));
    const mode = options.mode || 'view';
    if (mode === 'view' && !this.hasLocation(customer)) return;
    if (!window.L) {
      alert('Map library is not loaded.');
      return;
    }

    const lat = this.hasLocation(customer) ? Number(customer.locationLat) : 7.8731;
    const lng = this.hasLocation(customer) ? Number(customer.locationLng) : 80.7718;
    const title = document.getElementById('customer-map-title');
    const subtitle = document.getElementById('customer-map-subtitle');
    const tools = document.getElementById('customer-map-tools');
    const instruction = document.getElementById('customer-map-instruction');
    const savePinBtn = document.getElementById('btn-save-manual-location');
    const searchInput = document.getElementById('customer-map-search-input');
    const searchResults = document.getElementById('customer-map-search-results');
    this.mapMode = mode;
    this.pendingMapCustomerId = customer.id;
    this.pendingManualLocation = this.hasLocation(customer) ? { lat, lng } : null;
    if (title) title.textContent = mode === 'set' ? `Set Pin: ${customer.name || 'Customer'}` : (customer.name || 'Customer Map');
    if (subtitle) subtitle.textContent = mode === 'set' ? 'Tap the map to place or move the pin.' : (customer.address || customer.phone || '');
    if (tools) tools.classList.toggle('hidden', mode !== 'set');
    if (instruction) instruction.textContent = this.pendingManualLocation ? 'Move the pin by tapping another place, then save.' : 'Tap the map to place the customer pin.';
    if (savePinBtn) savePinBtn.disabled = !this.pendingManualLocation;
    if (searchInput) searchInput.value = customer.address || '';
    if (searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('active');
    }

    app.openModal('customer-map-modal');

    setTimeout(() => {
      const mapEl = document.getElementById('customer-map');
      if (!mapEl) return;

      if (this.map) {
        this.map.remove();
        this.map = null;
        this.mapMarker = null;
      }

      this.map = L.map(mapEl, {
        zoomControl: true,
        attributionControl: true
      }).setView([lat, lng], this.hasLocation(customer) ? 16 : 8);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(this.map);

      if (this.pendingManualLocation) {
        this.mapMarker = L.marker([lat, lng], { draggable: mode === 'set' }).addTo(this.map);
        this.mapMarker.bindPopup(`<strong>${this.escapeHtml(customer.name || 'Customer')}</strong>`).openPopup();
        if (mode === 'set') {
          this.mapMarker.on('dragend', () => {
            const next = this.mapMarker.getLatLng();
            this.setPendingManualLocation(next.lat, next.lng);
          });
        }
      }

      if (mode === 'set') {
        this.map.on('click', (event) => {
          this.setPendingManualLocation(event.latlng.lat, event.latlng.lng);
        });
      }
      this.map.invalidateSize();
    }, 80);
  }

  setPendingManualLocation(lat, lng) {
    this.pendingManualLocation = { lat, lng };
    if (this.map) {
      if (!this.mapMarker) {
        this.mapMarker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
        this.mapMarker.on('dragend', () => {
          const next = this.mapMarker.getLatLng();
          this.setPendingManualLocation(next.lat, next.lng);
        });
      } else {
        this.mapMarker.setLatLng([lat, lng]);
      }
      this.mapMarker.bindPopup('Selected location').openPopup();
    }
    const instruction = document.getElementById('customer-map-instruction');
    const savePinBtn = document.getElementById('btn-save-manual-location');
    if (instruction) instruction.textContent = `Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (savePinBtn) savePinBtn.disabled = false;
  }

  renderMapSearchResults(results) {
    const container = document.getElementById('customer-map-search-results');
    if (!container) return;

    if (!results.length) {
      container.innerHTML = '<div class="customer-map-result-btn">No matching places found.</div>';
      container.classList.add('active');
      return;
    }

    container.innerHTML = results.map((result, index) => `
      <button class="customer-map-result-btn" type="button" data-map-search-index="${index}">
        ${this.escapeHtml(result.display_name || 'Unnamed place')}
      </button>
    `).join('');
    container.classList.add('active');

    container.querySelectorAll('[data-map-search-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const result = results[Number(btn.getAttribute('data-map-search-index'))];
        const lat = Number(result.lat);
        const lng = Number(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        this.setPendingManualLocation(lat, lng);
        if (this.map) this.map.setView([lat, lng], 16);
        container.classList.remove('active');
      });
    });
  }

  async searchManualMapLocation() {
    const input = document.getElementById('customer-map-search-input');
    const query = (input?.value || '').trim();
    if (!query) {
      alert('Enter a place name, road, town, or landmark to search.');
      return;
    }

    const button = document.getElementById('btn-search-map-location');
    const previousText = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Searching...';
    }

    try {
      if (this.mapSearchController) this.mapSearchController.abort();
      this.mapSearchController = new AbortController();
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '6');
      url.searchParams.set('countrycodes', 'lk');
      url.searchParams.set('q', query);
      const response = await fetch(url.toString(), {
        signal: this.mapSearchController.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Search failed.');
      const results = await response.json();
      this.renderMapSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        alert('Location search failed. Check internet connection and try again.');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  }

  async saveManualLocation() {
    const customer = this.customers.find((c) => Number(c.id) === Number(this.pendingMapCustomerId));
    if (!customer || !this.pendingManualLocation) return;
    await this.saveLocationToCustomer(customer, this.pendingManualLocation.lat, this.pendingManualLocation.lng, 'manual', 0);
    this.closeMapModal();
  }

  closeMapModal() {
    app.closeModal('customer-map-modal');
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.mapMarker = null;
    }
    this.mapMode = 'view';
    this.pendingMapCustomerId = null;
    this.pendingManualLocation = null;
    if (this.mapSearchController) this.mapSearchController.abort();
    this.mapSearchController = null;
    const searchResults = document.getElementById('customer-map-search-results');
    if (searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('active');
    }
  }

  computeOutstandingMap() {
    const map = new Map();
    this.bills.forEach((bill) => {
      if (bill.billStatus && bill.billStatus !== 'active') return;
      const key = (bill.customerName || '').trim().toLowerCase();
      if (!key || key === 'walk-in customer') return;

      const total = Money.round(bill.total);
      const received = Money.round(bill.receivedAmount || 0);
      const balance = typeof bill.balanceAmount === 'number'
        ? Money.clampZero(bill.balanceAmount)
        : Money.clampZero(Money.subtract(total, received));

      if (!Money.isPositive(balance)) return;
      map.set(key, Money.add(map.get(key) || 0, balance));
    });

    return map;
  }

  computeOutstandingForCustomer(name) {
    const map = this.computeOutstandingMap();
    const key = (name || '').trim().toLowerCase();
    return map.get(key) || 0;
  }

  getCustomerCreatedSortValue(customer) {
    const createdAt = Number(customer?.created_at || 0);
    if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;

    const id = Number(customer?.id || 0);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  sortCustomersByCreatedAt(customers) {
    return [...customers].sort((a, b) => {
      const createdDiff = this.getCustomerCreatedSortValue(b) - this.getCustomerCreatedSortValue(a);
      if (createdDiff !== 0) return createdDiff;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  formatCustomerAddedAt(customer) {
    const createdAt = Number(customer?.created_at || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return 'Previous data';
    return new Date(createdAt).toLocaleString([], {
      year: '2-digit',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getFilteredCustomers() {
    const query = this.getSearchQuery();
    const outstandingMap = this.computeOutstandingMap();

    const rows = this.customers.map((customer) => {
      const key = (customer.name || '').trim().toLowerCase();
      const outstanding = outstandingMap.get(key) || 0;
      return { ...customer, outstanding };
    });

    const filteredRows = query
      ? rows.filter((c) => (c.name || '').toLowerCase().includes(query))
      : rows;

    return this.sortCustomersByCreatedAt(filteredRows);
  }

  openEditModal(customerId) {
    const customer = this.customers.find((c) => c.id === customerId);
    if (!customer) return;

    this.selectedCustomerId = customerId;
    document.getElementById('customer-modal-title').innerText = 'Edit Customer';

    const nameInput = document.getElementById('edit-customer-name');
    const phoneInput = document.getElementById('edit-customer-phone');
    const addressInput = document.getElementById('edit-customer-address');

    if (nameInput) nameInput.value = customer.name || '';
    if (phoneInput) phoneInput.value = customer.phone || '';
    if (addressInput) addressInput.value = customer.address || '';
    this.updateLocationControls();

    app.openModal('customer-edit-modal');
  }

  openAddModal() {
    this.selectedCustomerId = null;
    document.getElementById('customer-modal-title').innerText = 'Add New Customer';

    const nameInput = document.getElementById('edit-customer-name');
    const phoneInput = document.getElementById('edit-customer-phone');
    const addressInput = document.getElementById('edit-customer-address');

    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (addressInput) addressInput.value = '';
    this.updateLocationControls();

    app.openModal('customer-edit-modal');
  }

  closeEditModal() {
    this.selectedCustomerId = null;
    app.closeModal('customer-edit-modal');
  }

  async saveSelectedCustomer() {
    const name = (document.getElementById('edit-customer-name')?.value || '').trim();
    const phone = (document.getElementById('edit-customer-phone')?.value || '').trim();
    const address = (document.getElementById('edit-customer-address')?.value || '').trim();

    if (!name) {
      alert('Customer name is required.');
      return;
    }

    const duplicate = this.customers.find((customer) => {
      const sameName = (customer.name || '').trim().toLowerCase() === name.toLowerCase();
      const sameCustomer = Number(customer.id) === Number(this.selectedCustomerId);
      return sameName && !sameCustomer;
    });
    if (duplicate) {
      alert('Customer already exists.');
      return;
    }

    if (this.selectedCustomerId) {
      const existingCustomer = this.customers.find((customer) => Number(customer.id) === Number(this.selectedCustomerId));
      await window.db.updateCustomer(this.selectedCustomerId, { name, phone, address });
      const renamedBills = await window.db.renameCustomerInBills(existingCustomer?.name || '', { name, phone, address });
      await window.db.addAuditLog({
        action: 'customer_update',
        entity: 'customer',
        entityId: this.selectedCustomerId,
        details: { name, renamedBills }
      });
    } else {
      const result = await window.db.addCustomer(name, phone, address);
      if (!result?.ok) {
        alert(result?.error || 'Failed to add customer.');
        return;
      }
      await window.db.addAuditLog({
        action: 'customer_create',
        entity: 'customer',
        entityId: result.id,
        details: { name }
      });
    }

    this.closeEditModal();
    await this.render();

    if (window.billing) {
      await window.billing.loadCustomerDirectory();
      await window.billing.loadOutstandingDirectory();
    }
  }

  async deleteCustomer(customerId) {
    const customer = this.customers.find((c) => Number(c.id) === Number(customerId));
    if (!customer) return;

    const outstanding = this.computeOutstandingForCustomer(customer.name);
    let message = `Delete customer "${customer.name}"? Old bills for this customer will stay unchanged.`;
    if (outstanding > 0) {
      message = `⚠️ "${customer.name}" has LKR ${outstanding.toLocaleString()} outstanding!\n\nDelete anyway? Old bills will stay unchanged.`;
    }

    const confirmed = confirm(message);
    if (!confirmed) return;

    const deleted = await window.db.deleteCustomer(customer.id);
    if (!deleted) {
      alert('Failed to delete customer.');
      return;
    }

    await window.db.addAuditLog({
      action: 'customer_delete',
      entity: 'customer',
      entityId: customer.id,
      details: { name: customer.name || '' }
    });
    await this.render();
    if (window.billing) {
      await window.billing.loadCustomerDirectory();
      await window.billing.loadOutstandingDirectory();
    }
  }

  renderList(customers) {
    const list = document.getElementById('customers-list');
    if (!list) return;

    if (this.customers.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No customers yet.</div>';
      return;
    }

    if (customers.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">No customers match your search.</div>';
      return;
    }

    const rows = customers.map((c) => {
      const phone = c.phone || '-';
      const addedAt = this.formatCustomerAddedAt(c);
      const locationButton = this.hasLocation(c)
        ? `<button class="customers-map-btn" data-map-customer-id="${c.id}">Map</button>`
        : '<button class="customers-map-btn" disabled>No Pin</button>';
      const outstanding = c.outstanding > 0
        ? `<span class="customers-due">LKR ${c.outstanding.toLocaleString()}</span>`
        : '<span class="customers-paid">Paid</span>';

      return `
        <tr>
          <td class="customers-name-cell"><button class="customers-name-btn" data-edit-customer-id="${c.id}">${this.escapeHtml(c.name || '-')}</button></td>
          <td class="customers-phone-cell">${this.escapeHtml(phone)}</td>
          <td class="customers-added-cell">${this.escapeHtml(addedAt)}</td>
          <td class="customers-location-cell">${locationButton}</td>
          <td class="customers-outstanding-cell">${outstanding}</td>
          <td class="customers-action-cell">
            <button class="customers-edit-btn" data-edit-customer-id="${c.id}" title="Edit customer" aria-label="Edit customer">${this.getEditIcon()}</button>
            <button class="customers-delete-btn" data-delete-customer-id="${c.id}" title="Delete customer" aria-label="Delete customer">${this.getDeleteIcon()}</button>
          </td>
        </tr>
      `;
    }).join('');

    list.innerHTML = `
      <div class="card customers-table-wrap">
        <table class="customers-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Added</th>
              <th>Map</th>
              <th>Outstanding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll('[data-edit-customer-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const customerId = Number(btn.getAttribute('data-edit-customer-id'));
        this.openEditModal(customerId);
      });
    });

    list.querySelectorAll('[data-delete-customer-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const customerId = Number(btn.getAttribute('data-delete-customer-id'));
        await this.deleteCustomer(customerId);
      });
    });

    list.querySelectorAll('[data-map-customer-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const customerId = Number(btn.getAttribute('data-map-customer-id'));
        this.openMapModal(customerId);
      });
    });
  }

  bindEvents() {
    if (this.bound) return;

    const searchInput = document.getElementById('customers-search');
    searchInput?.addEventListener('input', () => {
      this.renderList(this.getFilteredCustomers());
    });

    const addBtn = document.getElementById('btn-add-customer');
    addBtn?.addEventListener('click', () => {
      this.openAddModal();
    });

    document.getElementById('btn-import-customers')?.addEventListener('click', () => {
      this.openImportModal();
    });
    document.getElementById('btn-download-customer-template')?.addEventListener('click', () => {
      this.downloadImportTemplate();
    });
    document.getElementById('customer-import-file')?.addEventListener('change', async (event) => {
      await this.handleCustomerCsvFile(event.target.files?.[0]);
    });
    document.getElementById('btn-confirm-customer-import')?.addEventListener('click', async () => {
      await this.importValidCustomers();
    });
    document.getElementById('btn-close-customer-import')?.addEventListener('click', () => {
      this.closeImportModal();
    });

    const saveBtn = document.getElementById('btn-save-customer-edit');
    saveBtn?.addEventListener('click', async () => {
      await this.saveSelectedCustomer();
    });

    const saveLocationBtn = document.getElementById('btn-save-customer-location');
    saveLocationBtn?.addEventListener('click', async () => {
      await this.saveCurrentLocation();
    });

    const setMapLocationBtn = document.getElementById('btn-set-customer-location-map');
    setMapLocationBtn?.addEventListener('click', async () => {
      await this.openManualMapPicker();
    });

    const viewLocationBtn = document.getElementById('btn-view-customer-location');
    viewLocationBtn?.addEventListener('click', () => {
      if (this.selectedCustomerId) this.openMapModal(this.selectedCustomerId);
    });

    const clearLocationBtn = document.getElementById('btn-clear-customer-location');
    clearLocationBtn?.addEventListener('click', async () => {
      await this.clearCurrentLocation();
    });

    const saveManualLocationBtn = document.getElementById('btn-save-manual-location');
    saveManualLocationBtn?.addEventListener('click', async () => {
      await this.saveManualLocation();
    });

    const searchMapLocationBtn = document.getElementById('btn-search-map-location');
    searchMapLocationBtn?.addEventListener('click', async () => {
      await this.searchManualMapLocation();
    });

    const searchMapInput = document.getElementById('customer-map-search-input');
    searchMapInput?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await this.searchManualMapLocation();
      }
    });

    this.bound = true;
  }

  async render() {
    const list = document.getElementById('customers-list');
    if (list) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    }

    this.bindEvents();
    this.customers = await window.db.getCustomers();
    this.bills = await window.db.getBills();
    this.renderList(this.getFilteredCustomers());
  }

  init() {
    // Initialized from app.js
  }
}

window.customersPage = new CustomersPage();
