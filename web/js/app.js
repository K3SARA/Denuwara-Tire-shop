class App {
  constructor() {
    this.currentPage = 'login';
    this.isReady = false;
    this.theme = localStorage.getItem('lynkbay_theme') || 'light';
    this.applyTheme(this.theme);
  }

  async init() {
    try {
      await window.db.init();
      await window.db.syncCustomersFromBills();
      // Ensure default product exists
      const prods = await window.db.getProducts();
      if (prods.length === 0) {
        await window.db.addProduct('Cashew Packet');
      }
    } catch (e) {
      console.error('DB Init error', e);
      alert('App failed to start. Please refresh and try again.');
      return;
    }
    
    window.auth.init();
    if (window.billing) await window.billing.init();
    if (window.historyView) window.historyView.init();
    if (window.inventory) await window.inventory.init();
    if (window.customersPage) window.customersPage.init();
    if (window.collectionPage) window.collectionPage.init();
    if (window.reportsView) window.reportsView.init();
    if (window.expensesPage) window.expensesPage.init();
    if (window.clearInputs) window.clearInputs.init();
    this.bindBackupButtons();
    this.bindThemeToggle();
    this.updateThemeToggle();
    this.updateBackupReminder();
    this.isReady = true;
    if (window.auth && typeof window.auth.setReadyState === 'function') {
      window.auth.setReadyState(true);
    }

    if (this.restoreReceiptNavigation()) {
      return;
    }

    if (!window.auth?.isAuthenticated) {
      this.navigate('login');
    }
  }

  applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    this.theme = nextTheme;
    document.documentElement.setAttribute('data-theme', nextTheme);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', nextTheme === 'dark' ? '#0f1411' : '#ffffff');
  }

  setTheme(theme) {
    this.applyTheme(theme);
    localStorage.setItem('lynkbay_theme', this.theme);
    this.updateThemeToggle();
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  bindThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle || toggle.dataset.themeBound === '1') return;
    toggle.dataset.themeBound = '1';
    toggle.addEventListener('click', () => this.toggleTheme());
  }

  updateThemeToggle() {
    const isDark = this.theme === 'dark';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      const icon = toggle.querySelector('.theme-toggle-icon');
      const text = toggle.querySelector('.theme-toggle-text');
      if (icon) icon.textContent = isDark ? '☀' : '☾';
      if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    }
    const settingsToggle = document.getElementById('settings-theme-label');
    if (settingsToggle) {
      settingsToggle.textContent = isDark ? '☀ Light Mode' : '☾ Dark Mode';
    }
  }

  restoreReceiptNavigation() {
    const intentKey = 'receipt-nav-intent';
    let intent = null;

    try {
      intent = JSON.parse(localStorage.getItem(intentKey) || 'null');
    } catch (e) {
      intent = null;
    }

    localStorage.removeItem(intentKey);

    if (!intent || Date.now() - Number(intent.createdAt || 0) > 10 * 60 * 1000) {
      return false;
    }

    if (!localStorage.getItem('billing_user')) {
      return false;
    }

    if (window.auth) {
      window.auth.isAuthenticated = true;
    }

    if (intent.action === 'edit' && intent.bill && window.billing) {
      window.billing.setEditMode(intent.bill);
      return true;
    }

    this.navigate(intent.page || 'billing');
    return true;
  }

  navigate(pageId) {
    if (pageId !== 'login' && window.auth && !window.auth.isAuthenticated) {
      pageId = 'login';
    }

    if (this.currentPage && this.currentPage !== pageId && this.currentPage !== 'login') {
      this.previousPage = this.currentPage;
    }

    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });
    const page = document.getElementById(`${pageId}-page`);
    if (page) {
      page.classList.add('active');
      this.currentPage = pageId;

      const navBottom = document.getElementById('nav-bottom');
      if (navBottom) {
        navBottom.classList.toggle('hidden', pageId === 'login');
      }
      
      // Sync bottom nav
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
      });
      const navItem = document.getElementById(`nav-${pageId}`);
      if (navItem) navItem.classList.add('active');

      if (pageId === 'history' && window.historyView) {
        window.historyView.render();
      }
      if (pageId === 'inventory' && window.inventory) {
        window.inventory.render();
      }
      if (pageId === 'customers' && window.customersPage) {
        window.customersPage.render();
      }
      if (pageId === 'collection' && window.collectionPage) {
        window.collectionPage.render();
      }
      if (pageId === 'reports' && window.reportsView) {
        window.reportsView.render();
      }
      if (pageId === 'expenses' && window.expensesPage) {
        window.expensesPage.render();
      }
      if (pageId === 'billing') {
        this.updateBackupReminder();
        if (window.billing) {
          window.billing.refreshProducts();
          window.billing.loadCustomerDirectory();
          window.billing.loadOutstandingDirectory();
        }
      }
      if (pageId === 'settings') {
        this.renderSettings();
      }
    }
  }

  bindBackupButtons() {
    ['btn-quick-backup', 'btn-reminder-backup'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.backupBound === '1') return;
      btn.dataset.backupBound = '1';
      btn.addEventListener('click', () => this.exportBackup('manual'));
    });

    const cloudBackupButton = document.getElementById('btn-cloud-backup');
    if (cloudBackupButton && cloudBackupButton.dataset.bound !== '1') {
      cloudBackupButton.dataset.bound = '1';
      cloudBackupButton.addEventListener('click', () => this.createCloudBackup());
    }

    const cloudRestoreButton = document.getElementById('btn-cloud-restore');
    if (cloudRestoreButton && cloudRestoreButton.dataset.bound !== '1') {
      cloudRestoreButton.dataset.bound = '1';
      cloudRestoreButton.addEventListener('click', () => this.restoreCloudBackup());
    }

    this.updateCloudBackupStatus();
  }

  isCloudBackupConfigured() {
    return Boolean(window.db && window.db.cloud && typeof window.db.cloud.getCloudState === 'function');
  }

  setCloudBackupStatus(message, isError = false) {
    const status = document.getElementById('cloud-backup-status');
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? 'var(--danger, #b42318)' : 'var(--text-muted)';
  }

  updateCloudBackupStatus() {
    if (!this.isCloudBackupConfigured()) {
      this.setCloudBackupStatus('Cloud backup is not configured. Set up Supabase first; local file backup still works.');
      return;
    }
    const last = Number(localStorage.getItem('last_cloud_backup_at') || '0') || 0;
    this.setCloudBackupStatus(last
      ? `Cloud backup configured. Last manual backup: ${new Date(last).toLocaleString()}.`
      : 'Cloud backup configured. No manual cloud backup recorded on this device yet.');
  }

  async createCloudBackup() {
    if (!this.isCloudBackupConfigured()) {
      alert('Cloud backup is not configured yet. Follow SUPABASE_SETUP.md, add the Supabase project URL and anon key in js/supabase-config.js, then reload the app.');
      return false;
    }

    const button = document.getElementById('btn-cloud-backup');
    if (button) button.disabled = true;
    this.setCloudBackupStatus('Saving a backup to the cloud…');
    try {
      const cloud = window.db.cloud;
      await cloud.pullLatest();
      await window.db.addAuditLog({
        action: 'cloud_backup_export',
        entity: 'backup',
        details: { reason: 'manual_cloud_backup' }
      });
      await cloud.pullLatest();
      const payload = await window.db.exportAllData();
      const saved = await cloud.saveCloudState(payload, Number(cloud.revision || 0));
      cloud.revision = Number(saved.revision || cloud.revision || 0);
      cloud.lastPullAt = Date.now();
      const savedAt = Date.now();
      localStorage.setItem('last_cloud_backup_at', String(savedAt));
      this.setCloudBackupStatus(`Cloud backup saved at ${new Date(savedAt).toLocaleString()}. Records: ${(payload.data.customers || []).length} customers, ${(payload.data.bills || []).length} bills, ${(payload.data.products || []).length} products.`);
      alert('Cloud backup completed successfully. This stores the latest full data snapshot; it does not create a list of historical cloud versions. Keep periodic offline JSON backups too.');
      return true;
    } catch (err) {
      console.error('Cloud backup failed:', err);
      this.setCloudBackupStatus(`Cloud backup failed: ${err.message || 'Unknown error'}`, true);
      alert(`Cloud backup failed. ${err.message || 'Check your internet connection and Supabase setup.'}`);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async restoreCloudBackup() {
    if (!this.isCloudBackupConfigured()) {
      alert('Cloud backup is not configured yet. Follow SUPABASE_SETUP.md and configure Supabase before restoring.');
      return false;
    }

    const button = document.getElementById('btn-cloud-restore');
    if (button) button.disabled = true;
    this.setCloudBackupStatus('Checking the latest cloud snapshot…');
    try {
      const cloud = window.db.cloud;
      const state = await cloud.getCloudState();
      if (!state || !state.payload) {
        this.setCloudBackupStatus('No cloud backup exists yet. Create a cloud backup first.');
        alert('No cloud backup was found. Create a cloud backup first.');
        return false;
      }
      window.db.validateBackupPayload(state.payload);
      const incoming = state.payload.data || {};
      const preview = [
        `Cloud revision: ${state.revision || 0}`,
        `Saved at: ${state.payload.exportedAt || 'Unknown'}`,
        `Customers: ${(incoming.customers || []).length}`,
        `Products: ${(incoming.products || []).length}`,
        `Bills: ${(incoming.bills || []).length}`,
        `Collections: ${(incoming.collectionLogs || []).length}`,
        `Expenses: ${(incoming.expenses || []).length}`,
        '',
        'Restoring replaces the current app data with this cloud snapshot.'
      ].join('\n');
      if (!confirm(`Restore Cloud Backup?\n\n${preview}\n\nContinue only if this is the data you want to restore.`)) return false;

      const currentPayload = await window.db.exportAllData();
      const downloaded = await this.exportBackup('before_cloud_restore');
      if (!downloaded) return false;
      if (!confirm('A safety JSON backup download has started. Confirm that the file was saved before replacing current data. Continue?')) return false;

      await window.db.saveImportRollback(currentPayload);
      await window.db.importAllData(state.payload);
      await window.db.addAuditLog({
        action: 'cloud_backup_restore',
        entity: 'backup',
        details: { cloudRevision: Number(state.revision || 0), exportedAt: state.payload.exportedAt || null }
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
      if (window.reportsView && this.currentPage === 'reports') await window.reportsView.render();
      if (window.historyView) await window.historyView.render();

      this.setCloudBackupStatus(`Restored cloud snapshot from ${state.payload.exportedAt || 'an unknown date'}.`);
      alert('Cloud backup restored successfully. Current data was replaced; a local safety backup was downloaded first.');
      return true;
    } catch (err) {
      console.error('Cloud restore failed:', err);
      this.setCloudBackupStatus(`Cloud restore failed: ${err.message || 'Unknown error'}`, true);
      alert(`Cloud restore failed. ${err.message || 'Check your internet connection and Supabase setup.'}`);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  getLastBackupTime() {
    return Number(localStorage.getItem('last_backup_at') || '0') || 0;
  }

  updateBackupReminder() {
    const reminder = document.getElementById('backup-reminder');
    const text = document.getElementById('backup-reminder-text');
    if (!reminder || !text) return;

    const last = this.getLastBackupTime();
    const ageMs = Date.now() - last;
    const due = !last || ageMs > 24 * 60 * 60 * 1000;
    reminder.classList.toggle('hidden', !due);

    if (!last) {
      text.textContent = 'No backup created yet. Create one before using the app heavily.';
      return;
    }

    const lastText = new Date(last).toLocaleString();
    text.textContent = `Last backup: ${lastText}. Create a fresh backup daily.`;
  }

  async exportBackup(reason = 'manual') {
    try {
      const payload = await window.db.exportAllData();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `billing-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      localStorage.setItem('last_backup_at', String(Date.now()));
      await window.db.addAuditLog({
        action: 'backup_export',
        entity: 'backup',
        details: { reason }
      });
      this.updateBackupReminder();
      return true;
    } catch (err) {
      alert('Backup export failed.');
      console.error(err);
      return false;
    }
  }

  openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  renderSettings() {
    this.updateThemeToggle();
    let profile = {};
    try {
      profile = JSON.parse(localStorage.getItem('denuwara_shop_profile') || '{}');
    } catch (e) {
      profile = {};
    }

    const bizName = document.getElementById('settings-biz-name');
    if (bizName) bizName.value = profile.businessName || window.share?.businessName || 'DENUWARA TYRE CARE';

    const propName = document.getElementById('settings-prop-name');
    if (propName) propName.value = profile.proprietorName || window.share?.proprietorName || 'ATHULA NANDANA PERERA';

    const bizAddress = document.getElementById('settings-biz-address');
    if (bizAddress) bizAddress.value = profile.businessAddress || window.share?.businessAddress || '54, Dalugama, Kelaniya.';

    const bizPhone = document.getElementById('settings-biz-phone');
    if (bizPhone) bizPhone.value = profile.businessPhone || window.share?.businessPhone || '075 7559975 / 077 8052775';

    const bizReg = document.getElementById('settings-biz-reg');
    if (bizReg) bizReg.value = profile.businessRegNo || window.share?.businessRegNo || '661800380v';

    const userField = document.getElementById('settings-user');
    if (userField) userField.value = localStorage.getItem('billing_user') || 'admin';

    const backupInfo = document.getElementById('settings-backup-info');
    if (backupInfo) {
      const last = this.getLastBackupTime();
      const lastText = last ? new Date(last).toLocaleString() : 'Never';
      const cloudBackupAt = localStorage.getItem('last_cloud_backup_at');
      const cloudText = cloudBackupAt ? new Date(Number(cloudBackupAt)).toLocaleString() : 'Never';
      backupInfo.innerHTML = `<strong>Last local backup:</strong> ${lastText} &nbsp;|&nbsp; <strong>Last cloud backup:</strong> ${cloudText}`;
    }
  }

  saveSettingsProfile() {
    const profile = {
      businessName: (document.getElementById('settings-biz-name')?.value || '').trim() || 'DENUWARA TYRE CARE',
      proprietorName: (document.getElementById('settings-prop-name')?.value || '').trim() || 'ATHULA NANDANA PERERA',
      businessAddress: (document.getElementById('settings-biz-address')?.value || '').trim() || '54, Dalugama, Kelaniya.',
      businessPhone: (document.getElementById('settings-biz-phone')?.value || '').trim() || '075 7559975 / 077 8052775',
      businessRegNo: (document.getElementById('settings-biz-reg')?.value || '').trim() || '661800380v'
    };

    localStorage.setItem('denuwara_shop_profile', JSON.stringify(profile));
    if (window.share && typeof window.share.loadBusinessProfile === 'function') {
      window.share.loadBusinessProfile();
    }
    alert('Shop and receipt details saved successfully!');
  }

  async changePassword() {
    const userField = document.getElementById('settings-user');
    const newPassField = document.getElementById('settings-new-pass');
    const confirmPassField = document.getElementById('settings-confirm-pass');

    const username = (userField?.value || '').trim();
    const newPass = newPassField?.value || '';
    const confirmPass = confirmPassField?.value || '';

    if (!username) {
      alert('Please enter a username.');
      return;
    }
    if (!newPass) {
      alert('Please enter a new password.');
      return;
    }
    if (newPass.length < 4) {
      alert('Password must be at least 4 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      alert('Passwords do not match. Please re-enter.');
      return;
    }

    if (window.auth && typeof window.auth.saveCredentials === 'function') {
      await window.auth.saveCredentials(username, newPass);
      if (newPassField) newPassField.value = '';
      if (confirmPassField) confirmPassField.value = '';
      alert('Username and password updated successfully!');
    } else {
      alert('Authentication module not ready.');
    }
  }

  async handleSettingsImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (window.historyView && typeof window.historyView.importBackup === 'function') {
      await window.historyView.importBackup(file);
      event.target.value = '';
      this.renderSettings();
    } else {
      alert('History view not ready for import.');
    }
  }

  logout() {
    const confirmed = confirm('Log out now?');
    if (!confirmed) return;

    if (window.auth) {
      window.auth.logout();
    }

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.classList.remove('active');
    });
    document.getElementById('auth-pass').value = '';
    this.navigate('login');
  }
}

window.app = new App();

document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
  
  // Close modals when clicking overlay
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
});
