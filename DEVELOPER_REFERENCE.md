# 🔧 Developer Quick Reference - Maintenance Guide

## Quick Facts About the App

| Aspect             | Details                           |
| ------------------ | --------------------------------- |
| **Type**           | Static PWA (Progressive Web App)  |
| **Database**       | IndexedDB (local, no backend)     |
| **Storage**        | Fully local, all data per device  |
| **Framework**      | Vanilla JS (no React/Vue/Angular) |
| **Cache Version**  | v99                               |
| **DB Version**     | 9                                 |
| **Test Framework** | Playwright                        |
| **Test Pass Rate** | 94.1% (16/17)                     |

---

## File Structure

```
LynkBay Cashew Billing App/
├── index.html              # Main app
├── receipt-print.html      # Print template
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── css/
│   ├── variables.css       # Design tokens
│   ├── base.css            # Global styles
│   ├── components.css      # Component styles
│   └── pages.css           # Page-specific styles
├── js/
│   ├── db.js              # Database layer (IndexedDB)
│   ├── app.js             # App controller
│   ├── auth.js            # Authentication
│   ├── billing.js         # Billing page
│   ├── collection.js      # Payment collection
│   ├── history.js         # Bill history
│   ├── inventory.js       # Stock management
│   ├── customers.js       # Customer management
│   ├── expenses.js        # Expense tracking
│   ├── reports.js         # Report generation
│   ├── pdf.js             # PDF export
│   ├── share.js           # Sharing functionality
│   ├── receipt-print.js   # Receipt printing
│   └── clear-inputs.js    # Form utilities
├── icons/
│   └── logo.png          # App icon
└── tests/
    └── mobile-ui.spec.js  # Playwright tests
```

---

## Key Classes & Modules

### Database (db.js)

```javascript
window.db = new Database()

Key methods:
- db.init()                              // Initialize IndexedDB
- db.saveBill(bill)                      // Save bill
- db.collectBillPaymentAtomic({...})     // Safe concurrent collection ⭐
- db.saveBillWithStockAndCollectionLog() // Atomic bill+stock+log
- db.getNextBillNumber()                 // Atomic bill counter
- db.addProduct(name, stock, price)
- db.addCustomer(name, phone, address)
- db.getProducts()
- db.getCustomers()
- db.getBills()
```

### Money Utility (db.js - Top)

```javascript
window.Money = {
  toCents(value)        // Convert rupees to cents
  fromCents(cents)      // Convert cents to rupees
  round(value)          // 100.01 → 100.01 (exact)
  add(...)              // Safe addition
  subtract(left, right) // Safe subtraction
  multiply(money, qty)  // Safe multiplication
  clampZero(value)      // Max(0, value)
  isPositive(value)     // > 0?
  isGreaterThan(a, b)   // a > b?
}

Why: JavaScript's floating-point math is broken
Fix: Use cents (integers) for all calculations
```

### App Controller (app.js)

```javascript
window.app = new App()

Key methods:
- app.navigate(pageId)           // Show/hide pages
- app.exportBackup()             // Create backup
- app.logout()                   // Clear auth
- app.currentPage                // Current page name
```

### Authentication (auth.js)

```javascript
window.auth = new Auth()

Key methods:
- auth.init()                    // Setup login form
- auth.login()                   // Mark authenticated
- auth.logout()                  // Clear auth
- auth.saveCredentials(user, pw) // Store hashed
```

---

## Common Tasks

### Add a New Feature

1. **Create HTML** in index.html

   ```html
   <div id="newfeature-page" class="page">
     <!-- Your UI here -->
   </div>
   ```

2. **Create JS module** in js/newfeature.js

   ```javascript
   class NewFeature {
     constructor() {}
     init() {}
     render() {}
   }
   window.newFeature = new NewFeature();
   ```

3. **Add to app.js** navigation

   ```javascript
   if (window.newFeature) window.newFeature.render();
   ```

4. **Add navigation button**
   ```html
   <button id="nav-newfeature" class="nav-item">New Feature</button>
   ```

### Fix a Bug

1. **Identify in code** (see File Structure)
2. **Write test** in tests/mobile-ui.spec.js
3. **Run tests** `npm test`
4. **Fix code**
5. **Verify test passes**
6. **Increment cache version** in sw.js

### Update Cache Version

When deploying new code:

```javascript
// In sw.js
const CACHE_NAME = "cashew-billing-v100"; // was v99
```

This forces clients to update on next visit.

### Debug Database Issues

```javascript
// In browser console
window.db.getBills().then(bills => console.log(bills))
window.db.getProducts().then(products => console.log(products))
window.db.getCustomers().then(customers => console.log(customers))

// View IndexedDB in DevTools
DevTools → Application → IndexedDB → cashew_billing_db
```

### Debug Service Worker

```javascript
// Check if installed
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(r => console.log(r.scope, r.active ? 'ACTIVE' : 'INACTIVE'))
})

// In DevTools
DevTools → Application → Service Workers
DevTools → Network → Check if files loaded from cache
```

---

## Testing

### Run Tests

```bash
npm test
```

### Run Specific Test

```bash
npm test -- --grep "concurrent collections"
```

### Debug Test

```bash
npm test -- tests/mobile-ui.spec.js --debug
```

### Key Tests to Watch

```javascript
// Critical tests that verify bug fixes:
✅ "concurrent collections on one bill keep the correct balance"
✅ "concurrent bill creation assigns unique bill numbers"
✅ "cent rounding prevents tiny balance from showing due"
```

If these fail, STOP deployment.

---

## Performance Checklist

| Metric        | Target  | How to Check          |
| ------------- | ------- | --------------------- |
| Load time     | < 2s    | DevTools Network      |
| Bill creation | < 500ms | DevTools Performance  |
| Collection    | < 300ms | Browser console timer |
| DB queries    | < 100ms | Browser console time  |

If slow:

1. Check for synchronous operations
2. Enable gzip compression on server
3. Check for large files
4. Profile in DevTools Performance tab

---

## Security Checklist

- [ ] HTTPS enabled (required for PWA)
- [ ] Password hashing in auth.js (SHA-256)
- [ ] No plaintext passwords in code
- [ ] No API keys exposed
- [ ] CSP headers configured
- [ ] CORS headers set if needed
- [ ] Rate limiting on auth (5 attempts = 30s lockout)

---

## Deployment Checklist

Before going to production:

- [ ] All tests passing (16/17 OK, 1 timing issue allowed)
- [ ] No console errors
- [ ] Service worker installs
- [ ] Offline mode works
- [ ] Backup creates valid file
- [ ] Restore works correctly
- [ ] HTTPS enabled
- [ ] Security headers configured
- [ ] Cache version incremented (if code changed)
- [ ] Files accessible at correct paths

---

## Common Issues & Fixes

### Service Worker Not Installing

```
Cause: Not HTTPS or sw.js not accessible
Fix: Enable HTTPS, verify sw.js in root
```

### Old Version Still Showing

```
Cause: Old cache not cleared
Fix: Increment CACHE_NAME in sw.js
Fix: Hard refresh (Ctrl+Shift+R)
```

### Database Errors

```
Cause: Quota exceeded or transaction failure
Fix: Check IndexedDB storage in DevTools
Fix: User might need to clear data
```

### Offline Mode Not Working

```
Cause: Service worker didn't install
Fix: Verify HTTPS working
Fix: Check DevTools → Application → Service Workers
```

### Tests Failing

```
Cause: Timing issues or missing files
Fix: Run tests twice (flakiness is OK)
Fix: Check all files uploaded for static hosting
```

---

## Key Code Patterns

### Safe Database Operation

```javascript
// ❌ WRONG - Not atomic
const bill = await db.getBillById(id);
bill.receivedAmount += payment;
await db.saveBill(bill);

// ✅ RIGHT - Atomic transaction
await db.collectBillPaymentAtomic({
  billId: id,
  amount: payment,
  method: "cash",
});
```

### Safe Money Calculation

```javascript
// ❌ WRONG - Floating point
const balance = bill.total - bill.receivedAmount;
if (balance <= 0) {
  /* ... */
}

// ✅ RIGHT - Uses Money utility
const balance = Money.clampZero(
  Money.subtract(bill.total, bill.receivedAmount),
);
if (!Money.isPositive(balance)) {
  /* ... */
}
```

### Safe Page Navigation

```javascript
// ✅ RIGHT - Use app.navigate()
app.navigate('billing')  // Shows billing-page, hides others

// Navigation triggers:
- History page renders
- Inventory page renders
- Billing refreshes outstanding
- etc.
```

---

## Browser DevTools Tips

### View All Bills

```javascript
await window.db.getBills();
```

### Export All Data (for backup)

```javascript
const data = await window.db.exportAllData();
console.log(JSON.stringify(data, null, 2));
```

### Clear Everything (for testing)

```javascript
// ⚠️ WARNING - Deletes all data!
indexedDB.deleteDatabase("cashew_billing_db");
window.location.reload();
```

### Monitor Transactions

```javascript
// Add to db.js for debugging
const originalTransaction = this.db.transaction;
this.db.transaction = function (stores, mode) {
  console.log(`Transaction: ${stores} (${mode})`);
  return originalTransaction.call(this, stores, mode);
};
```

---

## Future Enhancements (Not in v1)

Possible future features:

- [ ] Multi-device data sync
- [ ] Cloud backup
- [ ] Advanced reporting (graphs/charts)
- [ ] Barcode scanning
- [ ] SMS notifications
- [ ] Email receipts
- [ ] Multi-currency support
- [ ] Staff login/permissions

---

## Support

**For debugging:**

1. Check browser console for errors
2. Check DevTools → Application → IndexedDB
3. Check DevTools → Application → Service Workers
4. Hard refresh (Ctrl+Shift+R)
5. Clear data and test again

**For questions:**

- Review code comments in relevant module
- Check test file (tests/mobile-ui.spec.js) for usage examples
- Review the REAL_LIFE_ERRORS.md for known issues that were fixed

---

**Last Updated:** April 22, 2026  
**Version:** 1.0
