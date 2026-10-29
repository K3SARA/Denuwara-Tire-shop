const fs = require('fs');
const path = require('path');

const root = process.cwd();
const webDir = path.join(root, 'web');
fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });

const include = ['css', 'icons', 'js', 'vendor', 'index.html', 'manifest.json', 'receipt.html', 'receipt-print.html', 'sw.js', '_headers'];

for (const name of include) {
  const src = path.join(root, name);
  const dest = path.join(webDir, name);
  if (!fs.existsSync(src)) continue;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

const apiBaseUrl = String(process.env.LYNKBAY_API_BASE_URL || '').replace(/\/+$/, '');
fs.writeFileSync(
  path.join(webDir, 'js', 'deploy-config.js'),
  `window.LYNKBAY_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`
);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
