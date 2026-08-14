# CTPay — Production deployment guide

How to host the full stack: **Vercel** (user + admin portals) + **Hostinger VPS** (backend API) + **Supabase** (database).

For **local run on a Mac**, use [`MAC.md`](MAC.md) instead of this file.

**Production URLs (example):**

| App | URL |
|-----|-----|
| User portal | `https://ctpay.tech` |
| Admin portal | `https://ct123.ctpay.tech` |
| Backend API | `https://api.ctpay.tech` |

Use a non-obvious admin subdomain (not `admin.ctpay.tech`).

---

## Architecture

```
ctpay.tech          → Vercel (apps/user-portal)
ct123.ctpay.tech    → Vercel (apps/admin-portal)
api.ctpay.tech      → Hostinger VPS (apps/backend, PM2 + Nginx)
*.supabase.co       → Supabase PostgreSQL
```

Browsers only talk to Vercel. Vercel server routes call the backend using `API_URL`. EscrowStack keys and RSA signing stay **only on the VPS**.

---

## Prerequisites

- Company GitHub repo with this monorepo
- [Vercel](https://vercel.com) account (company)
- [Hostinger](https://hostinger.com) KVM VPS (Node 22+ recommended)
- [Supabase](https://supabase.com) project
- Domain `ctpay.tech` with DNS access in Hostinger

---

## Step 1 — Supabase (database)

1. Create a Supabase project.
2. Open **SQL Editor** and run migrations **in order** from `apps/backend/supabase/migrations/`:

   `001` → `002` → `003` → `004` → `005` → `006` → `007` → `008` → `009` → `010` → `011` → `012` → `013` → `014` → `015` → `016`

   **016** is required: platform EscrowStack keys live in VPS `.env`, not merchant rows.

3. Copy from **Project Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - JWT secret (JWT Settings)

### Create admin (no API bootstrap)

Admins are created **only in Supabase** — there is no bootstrap endpoint.

**Table Editor → `admins`:**

| Column | Value |
|--------|--------|
| `username` | e.g. `admin` |
| `password` | plain text, min 6 characters |

Or SQL:

```sql
INSERT INTO public.admins (username, password)
VALUES ('admin', 'your-strong-password-here');
```

To reset a password later, edit the row in Supabase.

---

## Step 2 — DNS (Hostinger)

| Type | Name | Value | Purpose |
|------|------|--------|---------|
| **A** | `@` | Vercel IP (from Vercel domain settings, e.g. `216.198.79.1`) | Root → user portal |
| **CNAME** | `www` | Vercel target (e.g. `xxxx.vercel-dns-017.com`) | www → user portal |
| **CNAME** | `ct123` | Vercel target for admin project | Admin portal |
| **A** | `api` | Your VPS IP (e.g. `31.97.186.244`) | Backend only |

**Important:**

- **Only `api`** should point to the VPS IP.
- Do **not** point `@` or `www` to the VPS — you will see nginx 404 or backend “Hello World”.
- Wait 15–60 minutes after DNS changes for propagation.

Verify (Windows PowerShell): `nslookup ctpay.tech`  
On Mac: `dig ctpay.tech +short` or `nslookup ctpay.tech`

---

## Step 3 — VPS backend (Hostinger)

### 3.1 SSH and install stack

```bash
ssh root@YOUR_VPS_IP

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt update && apt install -y nodejs nginx git
npm install -g pnpm pm2
node -v   # should be v22.x
```

### 3.2 Clone repo

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/COMPANY/REPO.git escrow
cd escrow/apps/backend
```

### 3.3 Backend `.env`

Create `/var/www/escrow/apps/backend/.env` (never commit this file):

```env
PORT=3000
NODE_ENV=production

CORS_ORIGIN=https://ctpay.tech,https://ct123.ctpay.tech

JWT_SECRET=long-random-production-secret
JWT_EXPIRES_IN_SECONDS=604800

ADMIN_JWT_SECRET=different-long-random-secret
ADMIN_JWT_EXPIRES_IN_SECONDS=604800

ESCROWSTACK_BASE_URL=https://cashdfcpt.escrowstack.io
ESCROWSTACK_PAYOUT_URL=https://cashdfcpt.escrowstack.io/v1/pt/hdfc/payout
ESCROWSTACK_API_KEY=paste-live-jwt-here
ESCROWSTACK_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPASTE_FULL_KEY_HERE\n-----END PRIVATE KEY-----"
ESCROWSTACK_IFSC=HDFC0000060
ESCROWSTACK_VA_PREFIX=CHAK69
ESCROW_AES_MASTER_KEY=your-aes-master-key

SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
```

### 3.4 Build and run (PM2)

```bash
cd /var/www/escrow/apps/backend
pnpm install
pnpm build
pm2 start dist/main.js --name escrow-api
pm2 save
pm2 startup   # run the command it prints, then pm2 save again
```

Test on VPS:

```bash
curl http://127.0.0.1:3000/health
pm2 status
```

### 3.5 Nginx (API only)

```bash
nano /etc/nginx/sites-available/escrow-api
```

```nginx
server {
    listen 80;
    server_name api.ctpay.tech;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and remove wrong sites:

```bash
ln -sf /etc/nginx/sites-available/escrow-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/ctpay.tech
nginx -t && systemctl reload nginx
```

**Only `escrow-api` should remain in `sites-enabled`.**

### 3.6 SSL (Let’s Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.ctpay.tech
```

Test:

```bash
curl https://api.ctpay.tech/health
curl https://api.ctpay.tech/    # should return 404 (no public root page)
```

---

## Step 4 — Vercel (frontends)

Create **two separate Vercel projects** from the same GitHub repo.

### Project A — User portal

| Setting | Value |
|---------|--------|
| Root Directory | `apps/user-portal` |
| Framework | Next.js |
| Install | Enable monorepo / install from repo root if build fails |

**Environment variables:**

| Name | Value |
|------|--------|
| `API_URL` | `https://api.ctpay.tech` |
| `NODE_ENV` | `production` |

**Domain:** `ctpay.tech` and `www.ctpay.tech`

### Project B — Admin portal

| Setting | Value |
|---------|--------|
| Root Directory | `apps/admin-portal` |

**Environment variables:** same as user portal.

**Domain:** `ct123.ctpay.tech` (or your hidden admin subdomain)

Admin portal has `robots.txt` + `noindex` headers — not indexed by search engines.

### If Vercel build fails (monorepo)

- Set **Root Directory** correctly.
- Enable **Include source files outside of Root Directory**.
- Or set Install Command: `cd ../.. && pnpm install`

---

## Step 5 — Smoke test

| Check | Expected |
|-------|----------|
| `https://api.ctpay.tech/health` | JSON, status ok |
| `https://ctpay.tech` | CTPay login page |
| `https://www.ctpay.tech` | Same login (or redirect) |
| `https://ct123.ctpay.tech/login` | Admin login |
| Admin login | Works with Supabase admin row |
| Merchant login | Works after admin onboards merchant |

---

## Updating production after code changes

### Frontends (automatic)

```bash
git push origin main
```

Vercel redeploys **user** and **admin** projects automatically (if connected to `main`).

### Backend (manual — SSH to VPS)

```bash
cd /var/www/escrow
git pull
cd apps/backend
pnpm install
pnpm build
pm2 restart escrow-api
pm2 logs escrow-api --lines 30
```

**Summary:**

| App | On `git push` |
|-----|----------------|
| User portal | Vercel auto-deploy |
| Admin portal | Vercel auto-deploy |
| Backend API | **You must SSH and restart PM2** |

---

## Environment variables reference

### VPS (`apps/backend/.env`)

| Variable | Notes |
|----------|--------|
| `CORS_ORIGIN` | Comma-separated portal URLs (https) |
| `JWT_SECRET` / `ADMIN_JWT_SECRET` | Strong random strings, different from each other |
| `ESCROW_AES_MASTER_KEY` | Never expose; backs encrypted merchant keys |
| Supabase keys | Service role stays backend-only |

### Vercel (each portal project)

| Variable | Notes |
|----------|--------|
| `API_URL` | `https://api.ctpay.tech` |
| `NODE_ENV` | `production` |

**Never** put EscrowStack keys, RSA private keys, or Supabase service role on Vercel.

---

## Security (production)

- Admins: Supabase `admins` table only (no bootstrap API).
- Login rate limit: 10 attempts / 15 minutes per IP (merchant + admin).
- API root `/` returns 404 — use `/health` for monitoring.
- Admin subdomain hidden + `noindex`.
- Restrict Supabase dashboard access (plain passwords in DB).

---

## EscrowStack webhooks

**URL:** `POST https://api.ctpay.tech/webhooks/escrowstack`

**Where to look:** Supabase → Table Editor → **`callbacks`**

| Column | Meaning |
|--------|---------|
| `received_at` | When it arrived |
| `from_ip` | Who sent it |
| `body` | Full JSON from bank |

Every POST = **one new row**. If this table is empty, no callback arrived.

Run **`014_simple_callbacks.sql`** in Supabase SQL Editor before testing.

Browser check: `https://api.ctpay.tech/webhooks/escrowstack`

---

## Troubleshooting

### `ctpay.tech` shows Hello World or nginx 404

- `@` or `www` DNS still points to VPS IP → fix DNS to Vercel.
- Remove `ctpay.tech` / `default` from nginx `sites-enabled` on VPS.
- Only `api` → VPS.

### Vercel “Invalid Configuration”

- Match **exact** A/CNAME values from Vercel domain settings in Hostinger.
- Wait for DNS propagation (up to 1 hour).

### Login fails on portal

- Check Vercel `API_URL=https://api.ctpay.tech`.
- Check VPS `CORS_ORIGIN` includes both portal URLs.
- `pm2 restart escrow-api` after `.env` changes.

### PM2 `errored` / crash loop

- Use **Node 22** on VPS, or ensure `ws` package for Supabase on Node 20.
- `pm2 logs escrow-api --lines 50`

### Admin login fails

- Confirm row exists in Supabase `admins` with plain `password` (migration `011` applied).

---

## Local development

```bash
pnpm install
pnpm dev:backend   # :3000
pnpm dev:user      # :3001
pnpm dev:admin     # :3002
```

Copy `apps/backend/.env.example` → `apps/backend/.env` with localhost `CORS_ORIGIN`.

See [`Readme.md`](Readme.md) and [`About.md`](About.md) for architecture and API details.
