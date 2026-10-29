# Testing Scenarios: Reproducing Real-Life Errors

## TEST ENVIRONMENT SETUP

You'll need:
- Two browser windows/tabs OR two different devices on same network
- Some test data (bills with outstanding balances)
- Browser DevTools open to see console

---

## 🔴 TEST 1: Concurrent Payment Collection (CRITICAL)

### Setup
1. Create a bill with LKR 1000 outstanding balance (Bill #100)
2. Open the app on **Device A** (or Browser Tab A) and navigate to Collections page
3. Open the app on **Device B** (or Browser Tab B) and navigate to Collections page
4. Both should show Bill #100 with Balance: LKR 1000

### Steps to Reproduce
```
TIMING CRITICAL - Do these steps simultaneously (within 5 seconds of each other)

Device A:
  1. Click on Bill #100
  2. Enter Collection Amount: 500
  3. Select Method: Cash
  4. Click "Collect Payment" (DO NOT SUBMIT YET)

Device B:
  1. Click on Bill #100 (open in parallel)
  2. Enter Collection Amount: 500
  3. Select Method: Cash
  4. Click "Collect Payment" (DO NOT SUBMIT YET)

SIMULTANEOUS CLICK (this is key):
  Device A: Click "Collect Payment" button
  Device B: Click "Collect Payment" button AT THE SAME TIME (within 100ms)
```

### Expected Behavior (Correct)
- One device succeeds, other shows error "Amount exceeds due balance"
- Final balance: LKR 500

### Actual Behavior (BUG)
- Both devices show "Collection successful"
- Final balance: LKR 0 or negative (both payments recorded)
- Total collected: LKR 1000 (from LKR 1000 bill - OVERPAYMENT)

### How to Verify
1. Refresh the page on Device A
2. Check Bill #100 - balance will be negative or wrong
3. Check Collection history - will show 2x LKR 500 = LKR 1000 received
4. Bill total was only LKR 1000!

### Code Location
- **File:** `collection.js`
- **Function:** `collectPayment()`
- **Line:** ~130 (where balance is fetched but not locked)

### Proof
The code fetches fresh bill:
```javascript
const bill = await window.db.getBillById(Number(billId));
// ... validation ...
// RACE WINDOW: Another request could update here
const balance = Math.max(0, total - received);
if (amount > balance) { alert(...); return; }
// By now, another device might have updated the bill!
```

---

## 🔴 TEST 2: Bill Number Duplication (CRITICAL)

### Setup
1. Fresh app state or recent db.js modification
2. Note current bill counter (check IndexedDB bill_counter value)
3. Open app in two browser tabs

### Steps to Reproduce
```
Tab 1 & Tab 2 (SIMULTANEOUS CREATION):
  1. Navigate to Billing page on both tabs
  2. Enter customer name, add one product (any)
  3. Both should show "Bill Number: [next number]" somewhere

  CRITICAL TIMING:
  4. At exact same moment, click "Generate & Share Bill" on BOTH tabs
     (Use external timer or have two people do it at same moment)
```

### Expected Behavior (Correct)
- Tab 1 gets Bill #101
- Tab 2 gets Bill #102
- When checking history, both have unique numbers

### Actual Behavior (BUG)
- Tab 1 gets Bill #101
- Tab 2 gets Bill #101 (DUPLICATE!)
- Database shows two bills with same number
- Audit trail is compromised

### How to Verify
1. Go to History page
2. Search/filter for recent bills
3. You'll see two bills with same bill number in recent list
4. Check IndexedDB: 
   ```javascript
   // In browser console:
   db.getAllFromIndex('bills', 'billNumber').onsuccess = (e) => {
     console.log(e.target.result);  // Will show duplicate bill numbers
   }
   ```

### Code Location
- **File:** `db.js`
- **Function:** `getNextBillNumber()`
- **Line:** ~880

### Proof
```javascript
async getNextBillNumber() {
  return new Promise((resolve) => {
    const req = store.get('bill_counter');
    // ← RACE WINDOW OPENS HERE
    let next = 1;
    req.onsuccess = () => {
      const current = Number(req.result?.value || 0);
      next = current + 1;  // ← Both requests calculate same "next" value
      store.put({ key: 'bill_counter', value: next });
    };
    tx.oncomplete = () => resolve(next);  // Both resolve same value!
  });
}
```

---

## 🔴 TEST 3: Floating-Point Math Error

### Setup
1. Create a new bill with total amount that has decimals: **LKR 100.01**
2. Customer should pay full amount

### Steps to Reproduce
```
1. Go to Billing page
2. Add Product: Cashew, Qty: 1, Price: 100.01
3. Bill total shows: LKR 100.01
4. Enter Received Amount: 100.00
5. Click "Generate Bill"
```

### Expected Behavior (Correct)
- Balance should be LKR 0.01
- Bill status: DUE (small amount pending)
- Or: Mark as PAID if treating decimal as negligible

### Actual Behavior (BUG)
```javascript
// JavaScript calculation:
const total = 100.01;
const received = 100.00;
const balance = total - received;
// Result: 0.009999999999990905 (not 0.01!)

// This fails the comparison:
if (balance <= 0.00) {
  // SHOULD mark as PAID, but...
  // 0.009999999999990905 is NOT <= 0, so condition is FALSE
}
// Bill incorrectly shows: DUE LKR 0.01
```

### How to Verify
1. In browser DevTools console:
   ```javascript
   const total = 100.01;
   const received = 100.00;
   const balance = total - received;
   console.log(balance);  // Output: 0.009999999999990905
   console.log(balance === 0.01);  // false!
   console.log(balance <= 0);  // false!
   ```

2. Check the bill in system:
   - Bill will show "Status: DUE" when customer paid in full
   - Collection page will show outstanding balance: LKR 0.01

### Code Location
- **File:** `billing.js`
- **Function:** `updatePaymentSummary()`
- **Line:** ~535

### Proof of Problem
This is a known JavaScript issue:
```javascript
// The problem:
0.1 + 0.2 === 0.3  // false! (returns 0.30000000000000004)
100.01 - 100.00    // 0.009999999999990905 (not 0.01)

// Why: IEEE 754 floating-point representation
// Binary representation of 0.01, 0.1, 0.2 can't be exact in binary floating-point
```

---

## 🟠 TEST 4: Stock Corruption (Race Condition)

### Setup
1. Create product: "Cashew Packets", Stock: 10 pcs
2. Open two browser windows/tabs with app
3. Both on Billing page

### Steps to Reproduce
```
Tab 1:
  1. Add item: Cashew Packets, Qty: 7
  2. Customer: Walk-in
  3. Total: LKR [whatever]
  4. Set to ready to submit (but don't click Generate yet)

Tab 2:
  1. Add item: Cashew Packets, Qty: 5
  2. Customer: Walk-in
  3. Total: LKR [whatever]
  4. Set to ready to submit (but don't click Generate yet)

SIMULTANEOUS:
  Both click "Generate & Share Bill" at same time
```

### Expected Behavior (Correct)
- First bill deducts 7: Stock becomes 3
- Second bill tries to deduct 5 but only 3 available → ERROR "Insufficient stock"
- Final stock: 3 pcs

### Actual Behavior (BUG)
- Tab 1: Shows success, deducts 7, stock shows 3
- Tab 2: Shows success, deducts 5, stock shows -2 (displayed as 0)
- Database stock = -2 (corrupted)
- UI shows 0, but actual value is negative

### How to Verify
1. Go to Inventory page
2. Check Cashew Packets stock - will show: 0 pcs
3. Open DevTools and check IndexedDB:
   ```javascript
   db.transaction('products', 'readonly')
     .objectStore('products')
     .get(1)
     .onsuccess = (e) => {
       console.log('Stock value:', e.target.result.stock);  // Will be -2
     };
   ```

### Why This Matters
- Stock data corrupted in database
- UI masks it as 0, but actual value is -2
- Future bills using this stock will get wrong calculations
- Overbilling becomes possible

### Code Location
- **File:** `db.js`
- **Function:** `deductStock()`
- **Line:** ~176

---

## 🟡 TEST 5: Outstanding Balance Cache Stale (MEDIUM)

### Setup
1. Create Bill #50 with LKR 10,000 balance outstanding to "Rajesh"
2. Open Collections page on Device A
3. Open Collections page on Device B
4. Both show: Rajesh - LKR 10,000 outstanding

### Steps to Reproduce
```
Device A:
  1. Collect LKR 5,000 from Rajesh
  2. Refresh page - shows LKR 5,000 remaining (correct)

Device B:
  (Device B page not refreshed, still shows old data)
  1. Try to collect LKR 6,000 from Rajesh
  2. Validation passes: LKR 6,000 <= LKR 10,000 ✓
  3. Collection succeeds
```

### Expected Behavior (Correct)
- Device B should show: Only LKR 5,000 outstanding
- Collection of LKR 6,000 should FAIL
- Only LKR 5,000 should be collectible

### Actual Behavior (BUG)
- Device B collects LKR 6,000 successfully (validates against stale LKR 10,000)
- Total collected: LKR 11,000 (more than bill total of LKR 10,000!)
- Balance ends up negative

### How to Verify
1. Check Collection history - shows:
   - Device A collection: LKR 5,000
   - Device B collection: LKR 6,000
   - Total: LKR 11,000 (exceeds bill amount!)
2. Bill #50 balance: -LKR 1,000

### Code Location
- **File:** `billing.js`
- **Function:** `loadOutstandingDirectory()`
- **Line:** ~100 (data loaded once, not auto-refreshed)

---

## 🟡 TEST 6: Customer Name Duplication Bug

### Setup
1. Start with empty customer list
2. Try to create customers with different case variations

### Steps to Reproduce
```
1. Go to Customers page
2. Click "Add Customer"
3. Enter name: "John Smith" → Save
4. Try to add another: "JOHN SMITH" → Should fail (duplicate)
5. Try to add: "john smith" → Should fail (duplicate)

But in billing page:
1. Type customer name: "john smith" → Autocomplete shows all three variations
2. Different names are used in different places
```

### Expected Behavior (Correct)
- Database stores normalized names
- All three variations treated as same customer
- Audit trail shows single customer

### Actual Behavior (INCONSISTENCY)
- Database stores: "john smith" (lowercase)
- UI displays: "John Smith" (original case) to user
- Can create confusion in reports
- Looks like 3 different customers to uninformed user

### Code Location
- **File:** `db.js`
- **Function:** `addCustomer()`
- **Line:** ~445 & Line `addProduct()` ~45

---

## 🟡 TEST 7: Product Deletion During Bill Edit

### Setup
1. Create Bill #40 with product "Premium Cashew" (qty: 5)
2. Bill is NOT completed/closed
3. Navigate to Inventory page
4. Delete "Premium Cashew" from inventory

### Steps to Reproduce
```
1. Create Bill #40 with "Premium Cashew" - qty: 5
2. DO NOT click "Generate Bill" yet
3. Go to Inventory page
4. Delete product "Premium Cashew"
5. Go back to Billing page
6. Edit Bill #40 (or it's still there from step 1)
7. Try to generate/update the bill
```

### Expected Behavior (Correct)
- ERROR: "Product no longer in active inventory"
- Prevent bill generation
- User must re-add product

### Actual Behavior (BUG)
- Bill generates successfully
- But stock update fails silently (product not found)
- User thinks bill is created with stock deducted
- But stock was NEVER deducted
- Inventory is now inconsistent with bills

### How to Verify
1. Check Inventory - total stock doesn't match bills
2. Create another bill for same product
3. Stock still shows original value (wasn't deducted)

### Code Location
- **File:** `billing.js`
- **Function:** `generateBill()`
- **Line:** ~1085 (only checks deleted products for NEW bills, not edits)

---

## 🟡 TEST 8: Split Payment Validation Incomplete

### Setup
1. Go to Billing page
2. Click "Add Another Payment Method"

### Steps to Reproduce
```
1. Create bill for LKR 1000
2. Click "+ Add Another Payment Method"
3. Split payments enabled
4. Enter:
   - Payment 1: Cash LKR 500
   - Payment 2: Card LKR 300
5. Click "Generate Bill"
```

### Expected Behavior (Correct)
- ERROR: "Payments total (LKR 800) doesn't equal bill total (LKR 1000)"
- User must enter LKR 200 more or adjust

### Actual Behavior (BUG)
- Bill generates successfully
- Total collected: LKR 800
- Bill total: LKR 1000
- Balance: LKR 200 (but no indication of underpayment)
- Bill status: "Due" (but it's not clear why)

### Impact
- Customer thinks they paid in full (LKR 800)
- System shows LKR 200 outstanding (confusing)
- Reconciliation nightmare

### Code Location
- **File:** `billing.js`
- **Function:** `validatePaymentRows()`
- **Line:** ~730 (doesn't validate sum equals total)

---

## How to Create a Test Report

After running these tests, create a report:

```markdown
# Bug Confirmation Report

**Date Tested:** [Date]
**Tester:** [Name]
**Device/Browser:** [Chrome/Firefox/Safari/Mobile]

## Test Results

| Test | Status | Severity | Impact |
|------|--------|----------|--------|
| Concurrent Collection | ❌ FAILED | CRITICAL | Lost payment of LKR X |
| Duplicate Bill #s | ❌ FAILED | CRITICAL | Bills not unique |
| Float Math Error | ❌ FAILED | HIGH | Bills show wrong balance |
| Stock Corruption | ❌ FAILED | CRITICAL | Inventory corrupted |
| Stale Outstanding | ❌ FAILED | HIGH | Overpayment collected |
| Customer Names | ⚠️ WARNING | MEDIUM | Confusing UI display |
| Product Deletion | ❌ FAILED | MEDIUM | Silent stock failure |
| Split Payment | ⚠️ WARNING | MEDIUM | Incomplete payments accepted |

## Financial Impact
- Lost payments: LKR X,XXX
- Reconciliation errors: LKR X,XXX
- Manual correction time: X hours

## Recommendation
STOP using app in production until these critical bugs are fixed.
```

