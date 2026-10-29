# 🚀 Deployment & Hosting Guide

## Prerequisites

This is a **static web application** - it doesn't need a server or backend. Just static file hosting!

### Requirements

- ✅ Static web hosting (Apache, Nginx, GitHub Pages, Netlify, Vercel, etc.)
- ✅ HTTPS support (required for Service Worker)
- ✅ Ability to serve from a subdirectory or domain

---

## Hosting Options

### Option 1: Shared Hosting (cPanel)

**Best for:** Traditional hosting providers

```bash
1. Upload all files to public_html/
2. Enable HTTPS (free Let's Encrypt usually available)
3. Access at https://yourdomain.com/
```

**Files to upload:**

```
public_html/
├── index.html
├── receipt-print.html
├── manifest.json
├── sw.js
├── css/
├── js/
└── icons/
```

### Option 2: Nginx (VPS)

**Best for:** VPS or dedicated server

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    root /var/www/billing;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache busting for versioned files
    location ~* \.(js|css|png)$ {
        expires 1y;
    }

    # No cache for HTML
    location ~ \.html$ {
        expires -1;
    }
}
```

### Option 3: Apache (.htaccess)

**Best for:** Shared hosting without Nginx

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /

    # Don't rewrite files or directories
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d

    # Rewrite everything to index.html
    RewriteRule ^(.*)$ index.html [L]
</IfModule>

# Caching
<FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$">
    Header set Cache-Control "max-age=31536000, public"
</FilesMatch>

<FilesMatch "\.(html)$">
    Header set Cache-Control "max-age=0, no-cache, must-revalidate"
</FilesMatch>
```

### Option 4: Netlify (Free)

**Best for:** Quick deployment without technical setup

```bash
# Deploy
1. Push code to GitHub
2. Connect to Netlify
3. Build command: (leave empty, it's static)
4. Publish directory: / (root)
5. Auto-deployed and HTTPS enabled!
```

### Option 5: GitHub Pages (Free)

**Best for:** Non-profit or learning

```bash
# Deploy
1. Push code to GitHub
2. Go to Settings → Pages
3. Select main branch as source
4. Auto-deployed at https://username.github.io/billing/
```

---

## Configuration After Deployment

### 1. Security Headers (Essential)

**For Nginx:**

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

**For Apache (.htaccess):**

```apache
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set X-XSS-Protection "1; mode=block"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
```

### 2. MIME Types

Ensure correct MIME types are served:

```
.js    → application/javascript
.css   → text/css
.html  → text/html; charset=utf-8
.json  → application/json
.png   → image/png
.svg   → image/svg+xml
```

**For Apache (.htaccess):**

```apache
<IfModule mod_mime.c>
    AddType application/javascript .js
    AddType text/css .css
    AddType text/html .html
    AddType application/json .json
    AddCharset utf-8 .html .css .js .json
</IfModule>
```

### 3. Compression (Recommended)

Enable gzip compression for better performance:

**For Nginx:**

```nginx
gzip on;
gzip_types text/plain text/css text/xml text/javascript
           application/x-javascript application/xml+rss;
gzip_min_length 1024;
```

**For Apache (.htaccess):**

```apache
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html
    AddOutputFilterByType DEFLATE text/plain
    AddOutputFilterByType DEFLATE text/xml
    AddOutputFilterByType DEFLATE text/css
    AddOutputFilterByType DEFLATE text/javascript
    AddOutputFilterByType DEFLATE application/xml
    AddOutputFilterByType DEFLATE application/xhtml+xml
    AddOutputFilterByType DEFLATE application/rss+xml
    AddOutputFilterByType DEFLATE application/javascript
    AddOutputFilterByType DEFLATE application/x-javascript
</IfModule>
```

---

## HTTPS/SSL Setup

### Get Free SSL Certificate

**Using Let's Encrypt (Recommended):**

```bash
# Using Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --nginx -d yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

**Via cPanel:**

1. Go to AutoSSL
2. Issue certificate for your domain
3. It auto-renews yearly

---

## Service Worker & Offline Mode

### Verify Service Worker Installation

After deployment, check in browser:

**Chrome DevTools:**

```
DevTools → Application → Service Workers
Should show: "Scope: https://yourdomain.com/"
Status: Active and running
```

**If it doesn't install:**

1. Verify HTTPS is working
2. Check console for errors
3. Verify `sw.js` is accessible
4. Hard refresh (Ctrl+Shift+R)

### Force Service Worker Update

When updating the app, increment the cache version in `sw.js`:

```javascript
// Change this number to invalidate cache
const CACHE_NAME = "cashew-billing-v100"; // was v99
```

Users will get the new version automatically within 24 hours, or on force refresh.

---

## Database (IndexedDB) Notes

### Important

- **No backend needed** - IndexedDB is local storage
- **Data is per browser/device** - not synced across devices
- **Backup required** - users must export backups
- **No cloud sync** - app doesn't need internet to work

### Local Development Testing

```bash
# Simple Python server
python -m http.server 8000

# Or Node.js
npx http-server

# Or Live Server (VS Code extension)
# Just click "Go Live"
```

Visit: `http://localhost:8000` (won't have service worker, but app works)

---

## Monitoring & Maintenance

### Things to Monitor

1. **SSL Certificate Expiration**
   - Ensure auto-renewal is working
   - Most hosts handle this automatically

2. **Service Worker Cache**
   - Monitor for browser caching issues
   - Clear cache when updating if users complain

3. **User Feedback**
   - Check for any JavaScript errors in console
   - Monitor offline functionality
   - Track performance on different devices

### Log Monitoring

Monitor access logs for:

- 404 errors on .js, .css files (means files not uploaded)
- 5xx errors (server misconfiguration)
- POST requests (shouldn't have any - it's static)

Example suspicious patterns:

```
404 /js/app.js          ← File missing!
404 /css/base.css       ← File missing!
404 /manifest.json      ← PWA won't install
```

---

## Testing Deployment

### Pre-Launch Checklist

```bash
# 1. Files are accessible
curl https://yourdomain.com/index.html
curl https://yourdomain.com/manifest.json
curl https://yourdomain.com/sw.js

# 2. HTTPS working
https://yourdomain.com/  # No warnings

# 3. Response codes
curl -I https://yourdomain.com/nonexistent.html
# Should redirect to index.html, not 404
```

### Mobile Testing

1. **iOS:**
   - Open app in Safari
   - Tap Share → Add to Home Screen
   - App should work offline

2. **Android:**
   - Open app in Chrome
   - Tap menu → Install app
   - App should work offline

3. **Test Offline:**
   - Enable Airplane Mode
   - Tap app icon
   - Should load from cache

---

## Troubleshooting

### Problem: "Service Worker failed to install"

**Solution:**

- Verify HTTPS is working
- Check `sw.js` exists and is accessible
- Check browser console for CORS errors
- Hard refresh page

### Problem: "Stuck on loading screen"

**Solution:**

- Check files are uploaded (index.html, app.js, etc.)
- Check MIME types are correct
- Check browser console for errors
- Try different browser

### Problem: "App shows old version"

**Solution:**

- Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
- Clear browser cache
- Increment CACHE_VERSION in sw.js

### Problem: "Can't collect payments"

**Solution:**

- This is 100% local, no internet needed
- Check browser IndexedDB storage space
- Check browser console for errors

---

## Performance Optimization

### Current Performance

- **Initial Load:** < 2 seconds
- **Bill Creation:** < 500ms
- **Database Queries:** < 100ms

### If Slow

1. **Enable Gzip Compression**

   ```
   js files: ~10KB → 3KB
   css files: ~20KB → 5KB
   ```

2. **Upgrade to CDN** (optional)
   - Not needed for local use
   - Optional if many users globally

3. **Monitor Database Size**
   - IndexedDB has no size limits (usually)
   - Encourage backups/exports for old data

---

## Version Management

### Current Version

- **App Version:** v1.0
- **Cache Version:** v99
- **Database Version:** 9

### When Updating App

1. Update files locally
2. Increment cache version in `sw.js`
3. Upload to hosting
4. Users get new version on next visit or force refresh

---

## Backup Your Files

### Recommended Backup Strategy

```bash
# Daily backup of production files
rsync -av /var/www/billing/ /backups/billing-$(date +%Y%m%d).tar.gz

# Or use your host's backup feature
# Or store in GitHub (private repo)
```

---

## Contact for Issues

If deployment fails, check:

1. **Files uploaded correctly**

   ```
   ✅ index.html (main file)
   ✅ manifest.json (PWA)
   ✅ sw.js (offline support)
   ✅ css/ folder
   ✅ js/ folder
   ✅ icons/ folder
   ```

2. **HTTPS working**

   ```
   Browser shows 🔒 (locked)
   No certificate warnings
   ```

3. **Rewrite rules correct**

   ```
   http://yourdomain.com/anything → index.html
   ```

4. **MIME types set**
   ```
   .js files → application/javascript
   .json files → application/json
   ```

If still failing, provide:

- Web hosting provider
- Error messages from console
- Server type (Apache/Nginx/Other)
- File upload location

---

## Summary

**The app is ready to deploy!**

✅ No backend needed  
✅ Static files only  
✅ Works offline  
✅ HTTPS required for PWA  
✅ Easy to update

Just upload the files and enjoy! 🚀
