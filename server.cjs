const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const fakeIndexedDb = require('fake-indexeddb');

const { Pool } = require('pg');

const HOST = process.env.LYNKBAY_HOST || '0.0.0.0';
const PORT = Number(process.env.LYNKBAY_PORT || process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || DATA_DIR;
const DATA_FILE = process.env.LYNKBAY_DATA_FILE || path.join(DEFAULT_DATA_DIR, 'lynkbay-db.json');
const SECRET_FILE = path.join(DEFAULT_DATA_DIR, 'lynkbay-api-secret.txt');
const DB_SCRIPT = path.join(ROOT_DIR, 'js', 'db.js');
const ALLOWED_ORIGINS = String(process.env.LYNKBAY_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const DATABASE_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
let pgPool = null;

if (DATABASE_URL) {
  try {
    const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    });
    console.log('[PostgreSQL] Database pool initialized.');
  } catch (err) {
    console.error('[PostgreSQL] Failed to initialize pg Pool:', err.message);
  }
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS lynkbay_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  payload JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lynkbay_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lynkbay_products (
  id TEXT PRIMARY KEY,
  name TEXT,
  stock NUMERIC DEFAULT 0,
  billing_price NUMERIC DEFAULT 0,
  invoice_price NUMERIC DEFAULT 0,
  category TEXT,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lynkbay_customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  address TEXT,
  opening_balance NUMERIC DEFAULT 0,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lynkbay_bills (
  id TEXT PRIMARY KEY,
  bill_number TEXT,
  customer_name TEXT,
  total NUMERIC DEFAULT 0,
  paid NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  status TEXT,
  bill_date TIMESTAMPTZ,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lynkbay_expenses (
  id TEXT PRIMARY KEY,
  category TEXT,
  amount NUMERIC DEFAULT 0,
  expense_date TEXT,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function initPgSchema(pool) {
  await pool.query(PG_SCHEMA);
}

async function loadStateFromPg(pool) {
  const res = await pool.query("SELECT payload, revision FROM lynkbay_state WHERE id = 'main' LIMIT 1");
  return res.rows[0] || null;
}

async function syncRelationalMirror(pool, data) {
  if (!pool || !data || typeof data !== 'object') return;
  try {
    if (Array.isArray(data.products)) {
      await pool.query('TRUNCATE TABLE lynkbay_products');
      if (data.products.length > 0) {
        await pool.query(`
          INSERT INTO lynkbay_products (id, name, stock, billing_price, invoice_price, category, payload, updated_at)
          SELECT 
            coalesce(id::text, '')::text, 
            coalesce(name::text, 'Unnamed')::text, 
            coalesce(stock, 0)::numeric, 
            coalesce("billingPrice", 0)::numeric, 
            coalesce("invoicePrice", 0)::numeric, 
            category::text, 
            elem, 
            now()
          FROM jsonb_array_elements($1::jsonb) AS elem,
               jsonb_to_record(elem) AS (id text, name text, stock numeric, "billingPrice" numeric, "invoicePrice" numeric, category text)
        `, [JSON.stringify(data.products)]);
      }
    }

    if (Array.isArray(data.customers)) {
      await pool.query('TRUNCATE TABLE lynkbay_customers');
      if (data.customers.length > 0) {
        await pool.query(`
          INSERT INTO lynkbay_customers (id, name, phone, address, payload, updated_at)
          SELECT 
            coalesce(id::text, '')::text, 
            coalesce(name::text, 'Unnamed')::text, 
            phone::text, 
            address::text, 
            coalesce("openingBalance", 0)::numeric, 
            elem, 
            now()
          FROM jsonb_array_elements($1::jsonb) AS elem,
               jsonb_to_record(elem) AS (id text, name text, phone text, address text, "openingBalance" numeric)
        `, [JSON.stringify(data.customers)]);
      }
    }

    if (Array.isArray(data.bills)) {
      await pool.query('TRUNCATE TABLE lynkbay_bills');
      if (data.bills.length > 0) {
        await pool.query(`
          INSERT INTO lynkbay_bills (id, bill_number, customer_name, total, paid, balance, status, bill_date, payload, updated_at)
          SELECT 
            coalesce(id::text, '')::text, 
            coalesce("billNumber"::text, id::text, '')::text, 
            coalesce("customerName"::text, customer::text, '')::text, 
            coalesce(total, 0)::numeric, 
            coalesce(paid, 0)::numeric, 
            coalesce(balance, total - paid, 0)::numeric, 
            status::text, 
            case when "createdAt" is not null and "createdAt"::text ~ '^\\d{4}' then "createdAt"::timestamptz else now() end, 
            elem, 
            now()
          FROM jsonb_array_elements($1::jsonb) AS elem,
               jsonb_to_record(elem) AS (id text, "billNumber" text, "customerName" text, customer text, total numeric, paid numeric, balance numeric, status text, "createdAt" text)
        `, [JSON.stringify(data.bills)]);
      }
    }

    if (Array.isArray(data.expenses)) {
      await pool.query('TRUNCATE TABLE lynkbay_expenses');
      if (data.expenses.length > 0) {
        await pool.query(`
          INSERT INTO lynkbay_expenses (id, category, amount, expense_date, payload, updated_at)
          SELECT 
            coalesce(id::text, '')::text, 
            category::text, 
            coalesce(amount, 0)::numeric, 
            coalesce(date::text, "expense_date"::text, '')::text, 
            elem, 
            now()
          FROM jsonb_array_elements($1::jsonb) AS elem,
               jsonb_to_record(elem) AS (id text, category text, amount numeric, date text, "expense_date" text)
        `, [JSON.stringify(data.expenses)]);
      }
    }
  } catch (err) {
    console.warn('[PostgreSQL] Relational mirror sync warning:', err.message);
  }
}

function resolveApiSecret() {
  if (process.env.LYNKBAY_API_SECRET && process.env.LYNKBAY_API_SECRET.trim()) {
    return process.env.LYNKBAY_API_SECRET.trim();
  }
  if (process.env.API_SECRET && process.env.API_SECRET.trim()) {
    return process.env.API_SECRET.trim();
  }
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (stored) return stored;
    }
  } catch (err) {}

  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, 'utf8');
  } catch (err) {}
  return generated;
}

let API_SECRET = resolveApiSecret();

const ALLOWED_METHODS = new Set([
  'addProduct',
  'addInventoryLog',
  'getInventoryLogs',
  'updateProduct',
  'deleteProduct',
  'restoreProduct',
  'deductStock',
  'addBackStock',
  'cancelBillAndReturnStock',
  'saveBillWithStockAndCollectionLog',
  'collectBillPaymentAtomic',
  'deleteOpeningBalanceCollectionAtomic',
  'updateOpeningBalanceCollectionAtomic',
  'collectCustomerOpeningBalanceAtomic',
  'deleteCollectionPaymentAtomic',
  'updateCollectionPaymentAtomic',
  'updateBillWithStockAndCollectionLog',
  'getProducts',
  'getCustomers',
  'updateCustomer',
  'renameCustomerInBills',
  'addCustomer',
  'deleteCustomer',
  'upsertCustomerByName',
  'syncCustomersFromBills',
  'deleteBillAndReturnStock',
  'updateBill',
  'deleteBill',
  'getBillById',
  'getBills',
  'addCollectionLog',
  'getCollectionLogs',
  'getCollectionLogsByBill',
  'addExpense',
  'getExpenses',
  'updateExpense',
  'deleteExpense',
  'addAuditLog',
  'getAuditLogs',
  'saveSetting',
  'getSetting',
  'getNextBillNumber',
  'recalculateBillCounter',
  'saveImportRollback',
  'getImportRollback',
  'getImportRollbacks',
  'clearImportRollback',
  'exportAllData',
  'importAllData'
]);

const READ_ONLY_PREFIXES = ['get', 'export'];
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

let db;
let queue = Promise.resolve();

function createDatabase() {
  const memStore = new Map();
  const mockLocalStorage = {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k),
    clear: () => memStore.clear()
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    fetch: undefined,
    location: undefined,
    window: null,
    localStorage: mockLocalStorage,
    indexedDB: fakeIndexedDb.indexedDB,
    IDBKeyRange: fakeIndexedDb.IDBKeyRange
  };
  context.window = context;
  Object.assign(context, fakeIndexedDb);

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(DB_SCRIPT, 'utf8'), context, { filename: DB_SCRIPT });
  return new context.Database();
}

async function initDatabase() {
  db = createDatabase();
  await db.init();

  if (pgPool) {
    try {
      console.log('[PostgreSQL] Connecting and verifying database tables...');
      await initPgSchema(pgPool);

      if (!process.env.LYNKBAY_API_SECRET && !process.env.API_SECRET) {
        const secRes = await pgPool.query("SELECT value FROM lynkbay_config WHERE key = 'api_secret' LIMIT 1");
        if (secRes.rows[0] && secRes.rows[0].value) {
          API_SECRET = secRes.rows[0].value;
          console.log('[PostgreSQL] Restored API secret from database configuration.');
        } else {
          await pgPool.query(
            "INSERT INTO lynkbay_config (key, value) VALUES ('api_secret', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            [API_SECRET]
          );
          console.log('[PostgreSQL] Saved generated API secret into database configuration.');
        }
      }

      const state = await loadStateFromPg(pgPool);
      if (state && state.payload) {
        console.log(`[PostgreSQL] Loaded active state (revision ${state.revision || 1})`);
        await db.importAllData(state.payload);
      } else if (fs.existsSync(DATA_FILE)) {
        console.log('[PostgreSQL] No database state found yet. Seeding from local data file...');
        const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        await db.importAllData(payload);
        await persistDatabase();
      } else {
        console.log('[PostgreSQL] Initializing fresh state in database...');
        await persistDatabase();
      }
      return;
    } catch (err) {
      console.error('[PostgreSQL] Initialization error:', err.message);
      if (!fs.existsSync(DATA_FILE)) {
        throw err;
      }
      console.warn('[PostgreSQL] Falling back to local file storage...');
    }
  }

  if (fs.existsSync(DATA_FILE)) {
    const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    await db.importAllData(payload);
  } else {
    await persistDatabase();
  }
}

async function persistDatabase() {
  const payload = await db.exportAllData();

  if (pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO lynkbay_state (id, payload, revision, updated_at)
         VALUES ('main', $1, 1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload,
             revision = lynkbay_state.revision + 1,
             updated_at = NOW()`,
        [payload]
      );
      syncRelationalMirror(pgPool, payload.data).catch((err) => {
        console.warn('[PostgreSQL] Background mirror warning:', err.message);
      });
    } catch (err) {
      console.error('[PostgreSQL] Failed to persist state:', err.message);
      throw err;
    }
  }

  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  } catch (fileErr) {
    if (!pgPool) throw fileErr;
  }
}

function isReadOnly(method) {
  return READ_ONLY_PREFIXES.some((prefix) => method.startsWith(prefix));
}

function runExclusive(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(payload));
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(req) {
  const origin = req?.headers?.origin;
  if (!isAllowedOrigin(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-LynkBay-Secret, X-API-Key, Authorization',
    'Vary': 'Origin'
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON request.'));
      }
    });
    req.on('error', reject);
  });
}

function getProvidedAuthSecret(req, payload) {
  const headerKey = req.headers['x-lynkbay-secret'] || req.headers['x-api-key'];
  if (headerKey) return String(headerKey).trim();

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (payload && payload.authSecret) {
    return String(payload.authSecret).trim();
  }

  return '';
}

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-LynkBay-Secret, X-API-Key, Authorization'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(req, res, 200, {
      ok: true,
      storage: pgPool ? 'postgres' : 'file',
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/db/call') {
    sendJson(req, res, 404, { ok: false, error: 'API route not found.' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const providedSecret = getProvidedAuthSecret(req, payload);

    if (!API_SECRET || providedSecret !== API_SECRET) {
      sendJson(req, res, 401, { ok: false, error: 'Unauthorized: Invalid or missing API secret.' });
      return;
    }

    const method = String(payload.method || '');
    const args = Array.isArray(payload.args) ? payload.args : [];

    if (!ALLOWED_METHODS.has(method) || typeof db[method] !== 'function') {
      sendJson(req, res, 400, { ok: false, error: `Unsupported database method: ${method}` });
      return;
    }

    const result = await runExclusive(async () => {
      const value = await db[method](...args);
      if (!isReadOnly(method)) {
        await persistDatabase();
      }
      return value;
    });

    sendJson(req, res, 200, { ok: true, result });
  } catch (err) {
    sendJson(req, res, 500, { ok: false, error: err.message || 'Server error.' });
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  if (pathname === '/js/deploy-config.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(`window.LYNKBAY_API_BASE_URL = window.LYNKBAY_API_BASE_URL || '';\nwindow.LYNKBAY_API_SECRET = ${JSON.stringify(API_SECRET)};\n`);
    return;
  }

  const filePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.js' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

initDatabase()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        handleApi(req, res);
        return;
      }
      serveStatic(req, res);
    });

    server.listen(PORT, HOST, () => {
      console.log(`LynkBay server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      console.log(`Storage engine: ${pgPool ? 'PostgreSQL' : 'Local file (' + DATA_FILE + ')'}`);
    });

    const shutdown = async () => {
      console.log('Shutting down LynkBay server...');
      server.close();
      if (pgPool) {
        await pgPool.end().catch(() => {});
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
