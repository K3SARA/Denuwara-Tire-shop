class Auth {
  constructor() {
    this.isAuthenticated = false;
    this.isReady = false;
  }

  getStoredCredentials() {
    return {
      savedUser: localStorage.getItem('billing_user'),
      savedPass: localStorage.getItem('billing_pass'),
      savedHash: localStorage.getItem('billing_pass_hash'),
      savedSalt: localStorage.getItem('billing_pass_salt')
    };
  }

  createSalt() {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now()}-${Math.random()}`;
  }

  async hashPassword(password, salt) {
    const value = `${salt}:${password}`;
    if (!window.crypto?.subtle || !window.TextEncoder) {
      return btoa(value);
    }

    const data = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async saveCredentials(user, pass) {
    const salt = this.createSalt();
    const hash = await this.hashPassword(pass, salt);
    localStorage.setItem('billing_user', user);
    localStorage.setItem('billing_pass_hash', hash);
    localStorage.setItem('billing_pass_salt', salt);
    localStorage.removeItem('billing_pass');
  }

  async verifyCredentials(user, pass, creds) {
    if (user !== creds.savedUser) return false;

    if (creds.savedHash && creds.savedSalt) {
      const hash = await this.hashPassword(pass, creds.savedSalt);
      return hash === creds.savedHash;
    }

    if (creds.savedPass && pass === creds.savedPass) {
      await this.saveCredentials(user, pass);
      return true;
    }

    return false;
  }

  init() {
    const { savedUser, savedPass, savedHash } = this.getStoredCredentials();
    
    if (savedUser && (savedPass || savedHash)) {
      document.getElementById('login-title').innerText = 'Welcome Back';
    }

    const loginBtn = document.getElementById('btn-login');
    const loginError = document.getElementById('login-error') || (() => {
      const el = document.createElement('div');
      el.id = 'login-error';
      el.style.cssText = 'color:#e53935; font-size:13px; margin-top:8px; text-align:center; min-height:20px;';
      loginBtn.parentNode.insertBefore(el, loginBtn.nextSibling);
      return el;
    })();

    const LOCK_AFTER = 5;
    const LOCK_SECONDS = 30;
    const ATTEMPTS_KEY = 'login_attempts';
    const LOCKED_UNTIL_KEY = 'login_locked_until';

    let lockTimer = null;

    const getAttempts = () => Number(localStorage.getItem(ATTEMPTS_KEY) || '0');
    const getLockEnd = () => Number(localStorage.getItem(LOCKED_UNTIL_KEY) || '0');

    const startLockCountdown = () => {
      clearInterval(lockTimer);
      loginBtn.disabled = true;
      lockTimer = setInterval(() => {
        const remaining = Math.ceil((getLockEnd() - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(lockTimer);
          loginBtn.disabled = false;
          loginError.textContent = '';
        } else {
          loginError.textContent = `Too many failed attempts. Try again in ${remaining}s.`;
        }
      }, 500);
    };

    // Restore lockout if page was refreshed during lockout
    if (getLockEnd() > Date.now()) startLockCountdown();
    else this.setReadyState(Boolean(window.app?.isReady));

    loginBtn.addEventListener('click', async () => {
      if (!this.isReady || !window.app?.isReady) {
        loginError.textContent = 'App is still loading. Please wait.';
        return;
      }
      if (getLockEnd() > Date.now()) return;

      const user = document.getElementById('auth-user').value.trim();
      const pass = document.getElementById('auth-pass').value.trim();

      if (!user || !pass) {
        alert('Please enter username and password');
        return;
      }

      const creds = this.getStoredCredentials();

      if (!creds.savedUser) {
        // First time setup — no lockout applies
        await this.saveCredentials(user, pass);
        localStorage.removeItem(ATTEMPTS_KEY);
        localStorage.removeItem(LOCKED_UNTIL_KEY);
        this.login();
      } else {
        if (await this.verifyCredentials(user, pass, creds)) {
          localStorage.removeItem(ATTEMPTS_KEY);
          localStorage.removeItem(LOCKED_UNTIL_KEY);
          loginError.textContent = '';
          this.login();
        } else {
          const attempts = getAttempts() + 1;
          localStorage.setItem(ATTEMPTS_KEY, String(attempts));
          const remaining = LOCK_AFTER - attempts;
          if (attempts >= LOCK_AFTER) {
            localStorage.setItem(LOCKED_UNTIL_KEY, String(Date.now() + LOCK_SECONDS * 1000));
            startLockCountdown();
          } else {
            loginError.textContent = `Incorrect credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
          }
        }
      }
    });

    ['auth-user', 'auth-pass'].forEach((id) => {
      const input = document.getElementById(id);
      input?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!loginBtn.disabled) loginBtn.click();
      });
    });

    document.getElementById('btn-reset-login').addEventListener('click', async () => {
      const creds = this.getStoredCredentials();
      if (creds.savedUser) {
        const user = prompt('Enter current username to reset login:');
        if (user === null) return;
        const pass = prompt('Enter current password to reset login:');
        if (pass === null) return;
        if (!(await this.verifyCredentials(user.trim(), pass.trim(), creds))) {
          alert('Incorrect credentials');
          return;
        }
      }

      const confirmReset = confirm('Reset login credentials? Bill history will stay safe.');
      if (!confirmReset) return;

      localStorage.removeItem('billing_user');
      localStorage.removeItem('billing_pass');
      localStorage.removeItem('billing_pass_hash');
      localStorage.removeItem('billing_pass_salt');
      document.getElementById('auth-user').value = '';
      document.getElementById('auth-pass').value = '';
      document.getElementById('login-title').innerText = 'Welcome Setup';
      alert('Login credentials reset. Create a new username and password.');
    });
  }

  setReadyState(isReady) {
    this.isReady = Boolean(isReady);
    const loginBtn = document.getElementById('btn-login');
    if (!loginBtn) return;

    const locked = Number(localStorage.getItem('login_locked_until') || '0') > Date.now();
    loginBtn.disabled = !this.isReady || locked;
    if (!locked) loginBtn.textContent = this.isReady ? 'Continue' : 'Loading...';
  }

  checkAuth() {
    const savedUser = localStorage.getItem('billing_user');
    // For simplicity, if not set up, show login. If set up, also require login once per reload.
    // In a real PWA we might use session.
    // Let's just always require login for security if the screen reloads.
  }

  login() {
    this.isAuthenticated = true;
    app.navigate('billing');
  }

  logout() {
    this.isAuthenticated = false;
  }
}

window.auth = new Auth();
