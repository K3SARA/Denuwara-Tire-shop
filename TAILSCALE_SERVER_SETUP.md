# LynkBay Tailscale + Laptop Server Setup

This setup makes the laptop the single data owner. The mobile and laptop both open the same LynkBay URL, and the app stores billing data in `data/lynkbay-db.json` on the laptop.

## 1. Install Tailscale

Install Tailscale on:

- the laptop that will run LynkBay
- the mobile device

Sign in to the same Tailscale account on both devices.

## 2. Start LynkBay on the laptop

From this project folder:

```powershell
npm install
npm run server
```

The server listens on port `3000`.

Local laptop URL:

```text
http://localhost:3000
```

## 3. Open from mobile through Tailscale

On the laptop, get the Tailscale IP:

```powershell
tailscale ip -4
```

On the mobile browser, open:

```text
http://TAILSCALE_IP:3000
```

Example:

```text
http://100.80.12.34:3000
```

Do not use router port forwarding for this app. Keep access private through Tailscale.

## 4. Existing data migration

If the client already has data in the old local app:

1. Open the old app on the device that has the correct data.
2. Export a backup from LynkBay.
3. Open the new laptop server URL.
4. Import that backup once.

After that, both devices should use only the laptop server URL.

## 5. Daily backup

The shared server data file is:

```text
data/lynkbay-db.json
```

Use the app's existing backup export regularly. Also copy `data/lynkbay-db.json` to an external drive or cloud folder if possible.

## Important limits

- The laptop must be powered on.
- `npm run server` must be running.
- The laptop must be connected to the internet for outside-mobile access.
- The current Android APK remains local-only unless it is rebuilt to point at the server URL. For this setup, use the mobile browser/PWA at the Tailscale URL.
