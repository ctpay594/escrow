# Escrow / CTPay

B2B payout and ledger platform on **EscrowStack** (HDFC passthrough). Merchants use the **CTPay user portal**; admins onboard merchants and approve transfers. EscrowStack API keys and RSA signing stay on the **backend only**.

| Continue on Mac | Architecture | Production |
|-----------------|--------------|------------|
| **[`MAC.md`](MAC.md)** — clone, tools, `.env`, run | [`About.md`](About.md) | [`DEPLOYMENT.md`](DEPLOYMENT.md) |

---

## Moving from Windows to Mac

1. Push this repo to GitHub (**do not** commit `apps/backend/.env` or `key/`).
2. Copy `apps/backend/.env` to the Mac yourself (AirDrop / USB / password manager).
3. On the Mac follow **[`MAC.md`](MAC.md)** (Homebrew, Node 22, pnpm, clone, `pnpm install`, three terminals).

Local URLs after that:

| App | Path | URL |
|-----|------|-----|
| Backend API | `apps/backend` | http://localhost:3000 (`/health`) |
| User portal | `apps/user-portal` | http://localhost:3001 |
| Admin portal | `apps/admin-portal` | http://localhost:3002 |

Frontends need no local `.env` in development (`API_URL` defaults to `http://localhost:3000`).

---

## Apps

| App | Path | Port | Stack | Hosting |
|-----|------|------|-------|---------|
| User portal (CTPay) | `apps/user-portal` | 3001 | Next.js | Vercel — `ctpay.tech` |
| Admin portal | `apps/admin-portal` | 3002 | Next.js | Vercel — `ct123.ctpay.tech` |
| Backend API | `apps/backend` | 3000 | NestJS | Hostinger VPS — `api.ctpay.tech` |

**Database:** Supabase (PostgreSQL). Migrations: `apps/backend/supabase/migrations/`  
**Package manager:** pnpm 10 (see `packageManager` in root `package.json`). **Node:** 20+.

---

## What's built

### Backend
- Supabase + `GET /health`
- Merchant JWT and admin JWT (separate secrets, httpOnly cookies)
- Onboard merchant: auto **CHAK69 + 6 digits** VA, shared IFSC **HDFC0000060**
- **One company** EscrowStack JWT + RSA private key in `.env` (not stored per merchant)
- Live balance fetch + RSA-SHA256 payout signing
- Ledger: available / pending hold on transfer request
- Single + bulk transfers; admin approve/reject
- Payout status reconcile polling
- Webhook receiver logs to `callbacks` (deposit credit to ledger still to wire)
- Account status: `active` / `on_hold` / `terminated`
- Login rate limit: 10 / IP / 15 minutes

### Admin portal (`localhost:3002`)
- Login (7-day session)
- Merchants hub: **Add merchant** (closed by default) — name in, generated username + password shown, then VA/IFSC after create
- Merchant detail: status, real/demo mode, approve/reject transfers
- Demo balance is edited on the merchant row/detail, not on the onboard form

### User portal (`localhost:3001`)
- Account, transfer (single + bulk), history
- Transfers blocked when account is not `active`

### Real vs demo

| Balance | Field | Who sets it |
|---------|--------|-------------|
| Real | `real_balance` | EscrowStack / refresh / (later) deposit webhook |
| Demo | `demo_balance` | Admin, after the merchant exists |

Admin toggle **CTPay shows Real / Demo** per merchant.

### Transfer flow

1. Merchant submits → `PENDING_APPROVAL`, funds held  
2. Admin approves → sign + POST EscrowStack → `PROCESSING`  
3. Reject → funds released  
4. Reconcile / webhook → `SUCCESS` or `FAILED`

---

## Quick start (any OS)

### 1. Install

```bash
pnpm install
```

### 2. Backend env

Copy `apps/backend/.env.example` → `apps/backend/.env` and fill Supabase + JWT + EscrowStack fields. See [`MAC.md`](MAC.md) for the full list.

### 3. Migrations (Supabase SQL Editor, in order)

`001` … `016` in `apps/backend/supabase/migrations/`

Latest that matter for current code:

- **015** — unique virtual account  
- **016** — drop per-merchant encrypted key columns  

### 4. Admin user

No bootstrap API. Insert in Supabase `admins` (plain password).

### 5. Run (three terminals)

```bash
pnpm dev:backend
pnpm dev:user
pnpm dev:admin
```

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace apps |
| `pnpm dev:backend` | NestJS watch — port 3000 |
| `pnpm dev:user` | User portal — port 3001 |
| `pnpm dev:admin` | Admin portal — port 3002 |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |

---

## Production

| App | URL |
|-----|-----|
| User | https://ctpay.tech |
| Admin | https://ct123.ctpay.tech |
| API | https://api.ctpay.tech |

Vercel env: `API_URL=https://api.ctpay.tech`. Backend `.env` only on the VPS.

```bash
cd /var/www/escrow && git pull && cd apps/backend && pnpm install && pnpm build && pm2 restart escrow-api
```

Full steps: [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Coming next

- Collect webhook → credit merchant `real_balance` by virtual account  
- Payout webhook without manual reconcile  
- Hourly CRON vs bank balance  

---

## Secrets — never commit

- `apps/backend/.env`
- `key/` (OpenSSL RSA files)
- EscrowStack JWT / PEM

`.gitignore` already excludes these.

---

## Docs

- [`MAC.md`](MAC.md) — Mac install and run  
- [`About.md`](About.md) — architecture, APIs, money flows  
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Vercel + VPS + DNS  
- `payout.cts.txt` — signing example  
- EscrowStack Postman collections in the repo root  
