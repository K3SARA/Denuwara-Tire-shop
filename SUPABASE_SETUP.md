# LynkBay Supabase Free Cloud Sync Setup

This setup lets the laptop and mobile use the same cloud data through Supabase. It does not require the laptop to stay on.

## 1. Create Supabase project

1. Go to Supabase and create a new project.
2. Open **SQL Editor**.
3. Run the SQL from `supabase-schema.sql`.
4. In that SQL, change this value before production use:

```sql
CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
```

Use a long random secret, for example 32+ characters.

## 2. Add project keys to the app

In Supabase:

1. Open **Project Settings**
2. Open **API**
3. Copy:
   - Project URL
   - `anon` public key

Edit `js/supabase-config.js`:

```js
window.LYNKBAY_SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
window.LYNKBAY_SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
window.LYNKBAY_SUPABASE_SYNC_SECRET = 'THE_SAME_SECRET_FROM_SQL';
```

Then rebuild:

```powershell
npm run build:web
```

## 3. Deploy or host the app

The app can be served as a normal static web app. The mobile and laptop must both open this same hosted app version.

Simple options:

- Netlify free static hosting
- Vercel free static hosting
- GitHub Pages
- any shared web hosting

If testing locally on the laptop:

```powershell
npm run server
```

## 4. Existing data migration

If the client already has data:

1. Open the old local LynkBay app on the device with the correct data.
2. Export backup.
3. Open the new Supabase-enabled app.
4. Import the backup once.
5. After import, the app pushes that data to Supabase.

After this, use only the Supabase-enabled app on both devices.

## Important notes

- Supabase Free can work for this small two-device setup, but free-tier limits and policies can change.
- The app detects cloud revision conflicts. If both devices save at the exact same time, it may ask the user to reload instead of overwriting data silently.
- The local username/password screen is still app-level login. It is not Supabase Auth.
- Keep the Supabase project private and do not publish `js/supabase-config.js` in a public repository with real keys/secrets.


## Manual cloud backup and restore

After Supabase is configured and the app reloads, open the Bill History page and use:

- **Cloud Backup Now** to save the current full data snapshot to Supabase.
- **Restore Cloud Backup** to preview the latest cloud snapshot and restore it after confirming. A local JSON safety backup is downloaded before restore.

The current schema stores one latest snapshot, not multiple dated cloud restore points. Keep periodic **Export Backup** JSON files in a separate safe location. Cloud backup/restore requires a working internet connection.

### Security warning

The current browser-side shared-secret design is suitable only for controlled testing, not for sensitive production data: anything placed in `js/supabase-config.js` can be inspected by users of the app. Do not treat the sync secret as confidential once it is shipped to a browser. For production, move privileged writes behind an authenticated server/edge function and apply proper user authentication, authorization, rate limits, and audit controls. Replace the sample secret in `supabase-schema.sql` with a long random value before testing.
