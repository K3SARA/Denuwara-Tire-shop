(function () {
  const params = new URLSearchParams(window.location.search);
  const receiptKey = params.get('receipt');
  let payload = null;

  try {
    payload = receiptKey ? JSON.parse(localStorage.getItem(receiptKey) || 'null') : null;
  } catch (err) {
    payload = null;
  }

  if (!payload || !payload.bill || !window.share) {
    document.body.innerHTML = '<p>Receipt data is not available. Please go back and open the receipt again.</p>';
    return;
  }

  const bill = payload.bill;
  const appUrl = payload.appUrl || './index.html';
  const returnPage = payload.returnPage || 'billing';
  const receiptLanguage = ['en', 'si', 'ta'].includes(payload.receiptLanguage) ? payload.receiptLanguage : 'en';
  const receiptNavKey = 'receipt-nav-intent';

  function writeReceiptIntent(action) {
    try {
      localStorage.setItem(receiptNavKey, JSON.stringify({
        action,
        bill,
        page: action === 'edit' ? 'billing' : returnPage,
        createdAt: Date.now()
      }));
    } catch (err) {}
  }

  function returnToApp() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.replace(appUrl);
  }

  var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  window.BILL_DATA = bill;
  window.editBillInApp = function editBillInApp() {
    var opened = false;
    try {
      if (!isCapacitor && window.opener && !window.opener.closed && window.opener.billing && typeof window.opener.billing.setEditMode === 'function') {
        window.opener.billing.setEditMode(bill);
        if (window.opener.app && typeof window.opener.app.closeModal === 'function') {
          window.opener.app.closeModal('share-modal');
        }
        try { window.opener.focus(); } catch (e) {}
        opened = true;
      }
    } catch (e) {}

    if (!opened) {
      writeReceiptIntent('edit');
      window.location.replace(appUrl);
      return;
    }

    setTimeout(function () {
      try { window.close(); } catch (e) {}
    }, 120);
  };

  window.backToApp = function backToApp() {
    writeReceiptIntent('back');
    if (isCapacitor) {
      returnToApp();
      return;
    }
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      if (window.opener && !window.opener.closed) {
        try { window.opener.focus(); } catch (e) {}
      }
      if (!window.closed) {
        returnToApp();
      }
    }, 120);
  };

  window.toggleReceiptFormat = function toggleReceiptFormat() {
    try {
      const p = new URLSearchParams(window.location.search);
      const rKey = p.get('receipt');
      if (!rKey) return;
      const d = JSON.parse(localStorage.getItem(rKey) || '{}');
      d.receiptFormat = (d.receiptFormat === '80mm') ? 'a5' : '80mm';
      localStorage.setItem(rKey, JSON.stringify(d));
      window.location.reload();
    } catch (e) {}
  };

  window.toggleCleanView = function toggleCleanView() {
    document.body.classList.toggle('clean-screenshot-mode');
    setTimeout(fitReceiptToScreen, 40);
  };

  function fitReceiptToScreen() {
    const a5Receipt = document.querySelector('.receipt-a5');
    const a5Viewport = document.getElementById('a5-scale-viewport');
    if (a5Receipt) {
      a5Receipt.style.transform = 'none';
      if (a5Viewport) {
        a5Viewport.style.width = '';
        a5Viewport.style.height = '';
      }

      const naturalWidth = a5Receipt.offsetWidth || 530;
      const naturalHeight = a5Receipt.offsetHeight || 750;
      const availableWidth = Math.max(260, (window.innerWidth || document.documentElement.clientWidth || 360) - 12);
      const toolbar = document.querySelector('.screen-actions');
      const toolbarHeight = (toolbar && toolbar.offsetHeight && window.getComputedStyle(toolbar).display !== 'none') ? toolbar.offsetHeight : 0;
      const availableHeight = Math.max(300, (window.innerHeight || document.documentElement.clientHeight || 640) - toolbarHeight - 16);

      if (window.innerWidth < 600 || availableWidth < naturalWidth) {
        const scaleWidth = availableWidth / naturalWidth;
        const isPortrait = window.innerHeight >= window.innerWidth;
        const scaleHeight = availableHeight / naturalHeight;
        const scale = isPortrait
          ? Math.min(1, scaleWidth, Math.max(0.48, scaleHeight))
          : Math.min(1, scaleWidth);

        const scaledWidth = Math.ceil(naturalWidth * scale);
        const scaledHeight = Math.ceil(naturalHeight * scale);

        a5Receipt.style.transform = 'scale(' + scale + ')';
        a5Receipt.style.transformOrigin = 'top center';

        if (a5Viewport) {
          a5Viewport.style.width = scaledWidth + 'px';
          a5Viewport.style.height = scaledHeight + 'px';
          a5Viewport.style.overflow = 'hidden';
        }
      } else {
        a5Receipt.style.transform = 'none';
        if (a5Viewport) {
          a5Viewport.style.width = 'auto';
          a5Viewport.style.height = 'auto';
          a5Viewport.style.overflow = 'visible';
        }
      }
      return;
    }

    const thermalReceipt = document.querySelector('.receipt');
    const thermalViewport = document.getElementById('thermal-scale-viewport');
    if (thermalReceipt) {
      thermalReceipt.style.transform = 'none';
      if (thermalViewport) {
        thermalViewport.style.width = '';
        thermalViewport.style.height = '';
      }

      const naturalWidth = thermalReceipt.offsetWidth || 302;
      const naturalHeight = thermalReceipt.offsetHeight || 500;
      const availableWidth = Math.max(240, (window.innerWidth || document.documentElement.clientWidth || 360) - 12);

      if (availableWidth < naturalWidth) {
        const scale = availableWidth / naturalWidth;
        const scaledWidth = Math.ceil(naturalWidth * scale);
        const scaledHeight = Math.ceil(naturalHeight * scale);

        thermalReceipt.style.transform = 'scale(' + scale + ')';
        thermalReceipt.style.transformOrigin = 'top center';

        if (thermalViewport) {
          thermalViewport.style.width = scaledWidth + 'px';
          thermalViewport.style.height = scaledHeight + 'px';
          thermalViewport.style.overflow = 'hidden';
        }
      } else {
        thermalReceipt.style.transform = 'none';
        if (thermalViewport) {
          thermalViewport.style.width = 'auto';
          thermalViewport.style.height = 'auto';
          thermalViewport.style.overflow = 'visible';
        }
      }
    }
  }

  function waitForImages() {
    const images = Array.from(document.images || []);
    if (!images.length) return Promise.resolve();

    return Promise.race([
      Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
  }

  const receiptFormat = payload.receiptFormat || 'a5';
  const html = window.share.buildPrintHtml(bill, {
    showToolbar: true,
    appUrl,
    returnPage,
    language: receiptLanguage,
    format: receiptFormat
  });
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  document.title = parsed.title || 'Receipt';
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;

  fitReceiptToScreen();

  waitForImages().then(() => {
    fitReceiptToScreen();
  });

  window.addEventListener('resize', fitReceiptToScreen);
  window.addEventListener('orientationchange', fitReceiptToScreen);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitReceiptToScreen);
  }

  window.printReceiptView = function printReceiptView() {
    var nativePrint = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
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
  };
}());
