class ClearInputsManager {
  constructor() {
    this.bound = false;
    this.observer = null;
  }

  isEligibleInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (!el.classList.contains('input-field')) return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'checkbox', 'radio', 'file'].includes(type)) return false;
    return true;
  }

  setBtnVisibility(input, btn) {
    const hasValue = String(input.value || '').length > 0;
    const canEdit = !input.disabled && !input.readOnly;
    btn.classList.toggle('visible', hasValue && canEdit);
  }

  enhanceInput(input) {
    if (!this.isEligibleInput(input)) return;
    if (input.dataset.clearEnhanced === '1') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'clearable-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    input.classList.add('clearable-input');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clear-input-btn';
    btn.setAttribute('aria-label', 'Clear input');
    btn.innerText = 'x';
    wrapper.appendChild(btn);

    const sync = () => this.setBtnVisibility(input, btn);
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('focus', sync);
    input.addEventListener('blur', () => {
      setTimeout(sync, 100);
    });

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    btn.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      sync();
    });

    input.dataset.clearEnhanced = '1';
    sync();
  }

  scan(root = document) {
    const inputs = root.querySelectorAll ? root.querySelectorAll('input.input-field') : [];
    inputs.forEach((input) => this.enhanceInput(input));
  }

  initObserver() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches && node.matches('input.input-field')) {
            this.enhanceInput(node);
          }
          this.scan(node);
        });
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  init() {
    if (this.bound) return;
    this.scan(document);
    this.initObserver();
    this.bound = true;
  }
}

window.clearInputs = new ClearInputsManager();
