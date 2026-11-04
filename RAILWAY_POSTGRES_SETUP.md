# Hosting on Railway with PostgreSQL

This guide explains how to deploy and host the app on [Railway](https://railway.com/) with a managed **PostgreSQL** database for automated cloud persistence.

---

## Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │             Railway Cloud              │
                      │                                        │
  Browser / Mobile    │  ┌──────────────────┐                  │
 ───────────────────> │  │   Node Server    │                  │
   (HTTPS Web App)    │  │   (server.cjs)   │                  │
                      │  └─────────┬────────┘                  │
                      │            │ (DATABASE_URL)            │
                      │            ▼                           │
                      │  ┌──────────────────┐                  │
                      │  │    PostgreSQL    │                  │
                      │  │  Managed Service │                  │
                      │  └──────────────────┘                  │
                      │     • lynkbay_state (Atomic JSONB)     │
                      │     • lynkbay_products                 │
                      │     • lynkbay_customers                │
                      │     • lynkbay_bills                    │
                      │     • lynkbay_expenses                 │
                      └────────────────────────────────────────┘
```

- **Stateless Container Safe**: Railway containers are ephemeral. PostgreSQL stores all business data (`products`, `customers`, `bills`, `expenses`, `auditLogs`, and configuration) persistently across deployments and server restarts.
- **Auto-Provisioning**: On startup, `server.cjs` automatically provisions all required PostgreSQL tables and schemas.
- **Relational Tables for Direct SQL**: In addition to atomic JSONB state snapshot in `lynkbay_state`, live relational tables are automatically mirrored for queries in Railway's Data Explorer.
- **Local Fallback**: If running locally without `DATABASE_URL`, the server automatically falls back to local file storage (`data/lynkbay-db.json`).

---

## Step-by-Step Deployment Guide

### Step 1: Sign in to Railway
1. Open [railway.com](https://railway.com/) and log in (or sign up with your GitHub account).
2. Click **"+ New Project"**.

### Step 2: Deploy from GitHub Repo
1. Select **"Deploy from GitHub repo"**.
2. Choose your repository: **`K3SARA/Sunbakers`** (or your repo name).
3. Click **"Deploy Now"**.

### Step 3: Add a PostgreSQL Database Service
1. In your Railway project canvas, click **"+ Create"** or **"+ New"** (top right).
2. Select **"Database"** ➔ **"Add PostgreSQL"**.
3. Railway will provision a managed PostgreSQL database in seconds.

### Step 4: Link Database to the Web Service
Railway connects services within the same project automatically, but verify:
1. Click on your web service in the Railway canvas.
2. Go to the **"Variables"** tab.
3. Click **"New Variable"** ➔ **"Add Reference"**.
4. Set:
   - Variable Name: `DATABASE_URL`
   - Reference: `${{Postgres.DATABASE_URL}}` (or `${{PostgreSQL.DATABASE_URL}}`)
5. *(Optional)* Set a custom API secret:
   - Variable Name: `LYNKBAY_API_SECRET`
   - Value: `<choose-a-random-secret>` *(If not provided, the server auto-generates and stores one persistently in the database config table)*.

### Step 5: Generate Public Domain
1. Click on your web service.
2. Go to the **"Settings"** tab.
3. Scroll down to **"Networking"** ➔ **"Public Networking"**.
4. Click **"Generate Domain"** (e.g. `sunbakers-production.up.railway.app`).

### Step 6: Verify Deployment
1. Visit your public URL in the browser.
2. Check the health status endpoint:
   ```
   https://<your-domain>.up.railway.app/api/health
   ```
   It will return:
   ```json
   {
     "ok": true,
     "storage": "postgres",
     "timestamp": "2026-11-04T..."
   }
   ```
   When `storage: "postgres"` appears, the app is fully connected and running on PostgreSQL.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes (for PostgreSQL)** | Automatically injected by Railway when adding PostgreSQL. |
| `PORT` | Auto | Injected automatically by Railway (defaults to 3000 locally). |
| `LYNKBAY_API_SECRET` | Optional | Shared API authentication secret. |
| `LYNKBAY_ALLOWED_ORIGINS` | Optional | Comma-separated CORS allowed origins. |
