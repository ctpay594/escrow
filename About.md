# CTPay / Escrow — Project Overview

This document describes how the **Escrow monorepo** works end to end: product purpose, architecture, money flows, database, APIs, and what each app does. Use it as context when onboarding, debugging, or feeding the codebase to an AI assistant.

---

## What this product is

**CTPay** is a closed-loop **B2B payout and ledger platform** for known merchants (not a public payment gateway).

- **Provider:** EscrowStack (HDFC / VouchPay)
- **Inbound:** Deposits only from **whitelisted** bank accounts into merchant virtual accounts
- **Outbound:** Merchants request bank transfers; **admin approves** before money leaves escrow
- **Branding:** User-facing product name is **CTPay**; repo folder is `escrow`

Merchants use the **user portal** to view balance, load funds, and request payouts. Admins use the **admin portal** to onboard merchants, manage balances, and approve/reject transfers. All EscrowStack API keys, RSA private keys, and payout signing happen **only on the backend**.

---

## Monorepo layout

| App | Path | Dev port | Production (planned) |
|-----|------|----------|----------------------|
| **User portal** | `apps/user-portal` | 3001 | Vercel — merchant domain |
| **Admin portal** | `apps/admin-portal` | 3002 | Vercel — `admin.*` |
| **Backend API** | `apps/backend` | 3000 | Hostinger VPS — `api.*` (PM2 + Nginx) |

**Package manager:** pnpm workspace  
**Database:** Supabase (PostgreSQL)  
**Migrations:** `apps/backend/supabase/migrations/` (run manually in Supabase SQL Editor)

**Reference files (repo root):**

- `Live-Credential.postman_collection.json` — live EscrowStack PT APIs (payout, status, balance)
- `payout.cts.txt` — Node RSA-SHA256 signing + payout flow (IST timestamp)
- `Readme.md` — quick start and commands
- `MAC.md` — clone and run on a Mac (after leaving Windows)
- `DEPLOYMENT.md` — production hosting (Vercel + VPS + DNS + updates)
- `.cursorrules` — Cursor agent rules for this repo

---

## High-level architecture

```mermaid
flowchart TB
  subgraph clients
    UP[User portal Next.js :3001]
    AP[Admin portal Next.js :3002]
  end

  subgraph server
    BE[NestJS API :3000]
    ES[EscrowStack APIs]
  end

  DB[(Supabase PostgreSQL)]

  UP -->|JWT cookie via BFF routes| BE
  AP -->|Admin JWT cookie via BFF routes| BE
  BE --> DB
  BE -->|Balance / payout / status| ES
  ES -->|POST /webhooks/escrowstack → callbacks| BE
```

Both frontends are **Next.js** apps that call the backend through **same-origin API routes** (`apps/*/src/app/api/...`). They never receive EscrowStack credentials.

---

## Database (Supabase)

Run `apps/backend/supabase/migrations/001_schema.sql` in the SQL Editor. Local Mac setup: [`MAC.md`](MAC.md).

| Migration | Purpose |
|-----------|---------|
| `001_create_users` | Merchant login users |
| `002_create_admins` | Admin accounts |
| `003_users_plain_password` | Merchant passwords stored plain (admin-visible) |
| `004_create_merchants` | Merchant profile, virtual account (legacy encrypted key columns) |
| `005_merchant_real_demo_balance` | `real_balance`, `demo_balance` columns |
| `006_create_transfers` | Payout requests + status lifecycle |
| `007_transfer_utr` | UTR / bank ref on transfers |
| `008_merchant_balance_mode` | `balance_mode`: `real` \| `demo` — what merchant portal displays |
| `009_transfer_batches` | Bulk upload batch grouping |
| `010_merchant_account_status` | `active` \| `on_hold` \| `terminated` |
| `011_admins_plain_password` | Admin passwords stored plain (like merchants) |
| `012`–`013` | Webhook event tables (older audit) |
| `014_simple_callbacks` | `callbacks` table — raw EscrowStack POSTs |
| `015_merchant_virtual_account_unique` | Unique `virtual_account_no` |
| `016_drop_merchant_encrypted_keys` | Keys live in backend `.env`, not per merchant |

### Core tables (conceptual)

**`users`** — portal login (username, plain password, linked to merchant)

**`admins`** — admin portal login (plain password, editable in Supabase)

**`merchants`** (extends user):

- Bank: `virtual_account_no` (`CHAK69` + 6 digits), `escrow_ifsc` (shared `HDFC0000060`)
- Ledger: `real_balance`, `demo_balance`, `pending_balance`
- Display: `balance_mode` (`real` \| `demo`)
- Access: `account_status` (`active` \| `on_hold` \| `terminated`)
- Company EscrowStack JWT + RSA private key: **backend `.env` only** (not in this table)

**`transfers`**:

- `merchant_id`, `amount`, beneficiary fields, `payout_mode`, `payout_ref`
- `status`: `PENDING_APPROVAL` → `PROCESSING` → `SUCCESS` \| `FAILED` \| `REJECTED`
- `batch_id` (optional, bulk uploads)
- `utr`, `bank_ref`, `escrow_response`

---

## Money flows

### 1. Inbound deposit (whitelisted)

1. Known customer sends IMPS/NEFT/RTGS to merchant **virtual account**
2. EscrowStack POST → `POST /webhooks/escrowstack` logs `callbacks`; auto-credit of `real_balance` by virtual account is **not wired yet**
3. Admin may refresh **real (bank)** balance from EscrowStack API
4. User portal shows **available** balance per `balance_mode` (real or demo)

### 2. Outbound payout (pending trick)

This is the core ledger pattern:

| Step | Who | What happens |
|------|-----|----------------|
| 1 | Merchant | Submits transfer on user portal |
| 2 | Backend | Deducts **available**, adds **pending_balance**, creates transfer `PENDING_APPROVAL` |
| 3 | Admin | Approves or rejects on admin portal |
| 4a | Approve | Backend signs with **platform** RSA key from `.env`, POST to EscrowStack → `PROCESSING` |
| 4b | Reject | Status `REJECTED`, funds returned to available |
| 5 | Bank / webhook | Success → `SUCCESS`, remove from pending; failure → `FAILED`, refund available |

### 3. Real vs demo balance

| Field | Meaning | Admin | User portal |
|-------|---------|-------|-------------|
| `real_balance` | Live EscrowStack bank balance | Shown + refresh | Shown only if `balance_mode = real` |
| `demo_balance` | Manual display balance | Editable | Shown only if `balance_mode = demo` |
| `balance_mode` | Which balance CTPay shows merchants | Toggle per merchant | Determines available/pending display |
| `pending_balance` | Funds held for in-flight payouts | Shown under real balance | Shown on dashboard |

Admin sets **CTPay shows Real / Demo** via glass segmented toggle on merchant list and detail.

### 4. Account status

| Status | User portal |
|--------|-------------|
| `active` | Full access |
| `on_hold` | View balance + history; **transfers blocked** |
| `terminated` | Read-only; no new transfers |

When not `active`:

- Top **banner** in portal shell explains restrictions
- **Status badge** on account dashboard, profile dropdown, and mobile menu (Active / On hold / Terminated)
- Transfer button disabled on dashboard; backend rejects `POST /transfers` via `assertCanTransfer()`

---

## EscrowStack integration (backend only)

**Services:** `apps/backend/src/escrowstack/`

- Balance: `POST /v1/pt/hdfc/get_account_balance` (base: `cashdfcpt.escrowstack.io`)
- Payout: `POST /v1/pt/hdfc/payout` — body `{ payouts, timestamp, signature }`, header `apikey`
- Payout status: `POST /v1/pt/hdfc/get_payout_status` — body `{ payout_ref, txn_date, mode }`; response `data.ALL_RECORDS[]` (`TXN_STATUS`, `OD_STATUS`, `UTR_NO`, `PAYMENTREFNO`)
- Signing: RSA-SHA256 on unsigned JSON + IST `timestamp`, then attach `signature`

**Security:**

- **One** company API key + RSA private key in `ESCROWSTACK_API_KEY` / `ESCROWSTACK_PRIVATE_KEY`
- Never expose keys, API secrets, or signing logic to frontends (not on Vercel)

**Payout lifecycle (EscrowStack):**

- Submit → `EL_PS` → our transfer `PROCESSING`
- Bank poll: `TXN_STATUS=Completed` / `OD_STATUS=TXSETT` → `SUCCESS` + UTR
- Webhook (if it arrives): `processed` (`PO_BP_DCP`) or `failed` (`ERR_BP_IPR`)
- After approve we poll for ~4 minutes; leftover `PROCESSING` rows are swept on boot and every 15 minutes; user/admin History also calls reconcile

---

## Backend API (NestJS)

Base URL: `http://localhost:3000` (dev)

### Health

- `GET /health` — Supabase connectivity check

### Merchant auth (`/auth`)

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Login rate-limited (10 attempts / 15 min per IP)
- JWT in httpOnly cookie (separate from admin JWT)

### Merchant transfers (`/transfers`) — JWT required

- `GET /transfers` — list merchant’s transfers
- `POST /transfers` — single IMPS/NEFT/RTGS/UPI request
- `POST /transfers/bulk` — batch upload (many rows → one `batch_id`)
- `POST /transfers/reconcile-status` — poll EscrowStack for processing UTR updates

### Admin auth (`/admin/auth`)

- `POST /admin/auth/login`, `GET /admin/auth/me`, `POST /admin/auth/logout`
- Login rate-limited (10 attempts / 15 min per IP)
- **No bootstrap endpoint** — create admins in Supabase `admins` table only

### Admin merchants (`/admin/users`) — admin JWT

- `GET /admin/users` — list merchants with balances
- `POST /admin/users` — create merchant (auto VA + IFSC; portal username/password from admin UI)
- `PATCH /admin/users/:id` — username, password, demo balance, balance_mode, account_status
- `POST /admin/users/:id/refresh-balance` — fetch real balance from EscrowStack
- `DELETE /admin/users/:id`

### Admin transfers (`/admin/transfers`) — admin JWT

- `GET /admin/transfers` — all transfers (filter by status, merchant)
- `POST /admin/transfers/:id/approve` — sign + submit payout
- `POST /admin/transfers/:id/reject` — release held funds
- `POST /admin/transfers/batches/:batchId/approve-all` — approve whole bulk batch
- `POST /admin/transfers/reconcile-status` — admin-wide status poll

---

## Admin portal (`apps/admin-portal`)

**URL:** `localhost:3002`

### Routes

| Route | Purpose |
|-------|---------|
| `/login` | Admin sign-in |
| `/` | **Merchants hub** — stats, onboard form, merchant table |
| `/merchants/[id]` | Merchant detail — status toggle, real/demo toggle, balances, portal access, embedded transfers |

Transfers are managed **per merchant** on the detail page (not a separate global transfers page in current UI).

### Key features

- Onboard merchant: **Add merchant** → name → generated username/password → auto VA/IFSC
- Glass **iOS-style segmented controls**: portal status (Active / On hold / Terminated), CTPay balance mode (Real / Demo)
- Approve/reject transfers with confirm dialog
- Yes/No confirm dialogs for status changes, deletes, batch approve, and other sensitive actions
- Refresh real bank balance per merchant
- Mobile-responsive: hamburger nav, card layouts on small screens

### UI system

- `src/lib/glass-styles.ts` — frosted surfaces, inset tiles, table rows
- `src/components/ui/glass-card.tsx`, `glass-segmented-control.tsx`
- Light gradient shell, frosted header, professional bank-like tables

---

## User portal (`apps/user-portal`)

**URL:** `localhost:3001`  
**Product name:** CTPay

### Routes

| Route | Purpose |
|-------|---------|
| `/login` | Merchant sign-in |
| `/` | **Account** — balances, load account, IFSC, actions |
| `/transfer` | Single transfer wizard + bulk Excel/CSV upload |
| `/history` | Last 48 hours, search, export, transfer detail popup |

### Key features

- Dashboard: available / pending / settled today (light glass card, admin-style inset tiles)
- Single transfer: amount, beneficiary, account, IFSC → confirm → `PENDING_APPROVAL`
- Bulk transfer: sample sheet, drag-drop, preview table, submit batch
- History: full payment ref + UTR in table; detail popup matches admin fields
- CSV export: Excel-safe text for long numeric IDs (`="..."` formula + UTF-8 BOM)
- Account status badge on profile (Active / On hold / Terminated) — not hardcoded to Active
- Account status banners block transfers when on hold / terminated
- Mobile-responsive: stacked filters/buttons, history card view on small screens, viewport meta

### UI system

Same glass design language as admin (`glass-styles.ts`, `GlassCard`, frosted dialogs/inputs). Shared components: `AccountStatusBadge`, `AccountStatusBanner`, `canMerchantTransfer()`.

---

## Transfer statuses (both portals)

| Status | Merchant label | Meaning |
|--------|------------------|---------|
| `PENDING_APPROVAL` | Pending approval | Awaiting admin |
| `PROCESSING` | Processing | Sent to EscrowStack / bank |
| `SUCCESS` | Completed | Paid |
| `FAILED` | Failed | Bank failed; funds returned (webhook/reconcile) |
| `REJECTED` | Cancelled | Admin rejected; funds returned |

---

## Security rules (non-negotiable)

1. **Never** put EscrowStack API keys or RSA private keys in frontends or git
2. Separate JWT secrets: `JWT_SECRET` (users) vs `ADMIN_JWT_SECRET` (admins)
3. Merchant passwords: plain in DB (admin-managed visibility)
4. Admin passwords: plain in DB (editable in Supabase table editor) — migration `011`; treat DB access as full admin access
5. CORS limited to portal origins
6. Payout signing only in backend `escrowstack` + `transfers` services
7. Account status enforced server-side on transfer create (UI disable is supplementary)
8. Login rate limit on merchant + admin auth (in-memory, per VPS instance)
9. API root (`GET /`) returns 404 — no public “Hello World” page
10. Admins created only in Supabase — no `/admin/auth/bootstrap`

---

## Production deployment

| App | URL | Host |
|-----|-----|------|
| User portal | `https://ctpay.tech` | Vercel |
| Admin portal | `https://ct123.ctpay.tech` | Vercel |
| Backend API | `https://api.ctpay.tech` | Hostinger VPS (PM2 + Nginx) |
| Database | Supabase cloud | — |

**DNS:** Only `api` subdomain → VPS IP. `ctpay.tech`, `www`, and admin subdomain → Vercel.

### Updating production

| Change | Action |
|--------|--------|
| Frontend code | `git push` → Vercel redeploys both portal projects automatically |
| Backend code | SSH to VPS → `git pull` → `pnpm install` → `pnpm build` → `pm2 restart escrow-api` |
| Env vars | Vercel dashboard (frontends) or `/var/www/escrow/apps/backend/.env` (API) |

**Vercel env per portal:** `API_URL=https://api.ctpay.tech`, `NODE_ENV=production`.

### Create / reset admin

Supabase → `admins` table → insert or edit `username` + `password` (plain text, min 6 chars). No API bootstrap.

```sql
INSERT INTO public.admins (username, password) VALUES ('admin', 'strong-password');
```

---

## Local development

**Mac (after Windows):** follow [`MAC.md`](MAC.md).

```bash
pnpm install
pnpm dev:backend   # :3000
pnpm dev:user      # :3001
pnpm dev:admin     # :3002
```

Copy `apps/backend/.env.example` → `apps/backend/.env` and set Supabase, JWT, EscrowStack (`ESCROWSTACK_API_KEY`, `ESCROWSTACK_PRIVATE_KEY`), `CORS_ORIGIN`. Frontends need no `.env` locally.

Create admin in Supabase `admins` table (see above). Run `001_schema.sql`.

---

## Implementation roadmap (from `.cursorrules`)

| Step | Status | Description |
|------|--------|-------------|
| 1 | Done | Monorepo scaffold |
| 2 | Done | Supabase connected |
| 3 | Done | Admin auth + user CRUD |
| 4 | Done | Internal ledger + `PENDING_APPROVAL` |
| 5 | Done | EscrowStack signing engine |
| 6 | Partial | Webhooks + reconcile polling |
| 7 | Done | Admin approval UI |
| 8 | Done | User portal balance + transfers |
| 9 | Planned | CRON reconciliation (hourly) |
| 10 | Done | Production deploy (Vercel + Hostinger VPS) |

**Still planned / incomplete:**

- Deposit webhooks crediting `real_balance` automatically
- Full payout webhook handling (`SUCCESS` / `FAILED` without manual reconcile)
- Hourly Supabase vs bank balance reconciliation
- Production hosting cutover

---

## How frontends talk to the backend

Each Next.js app proxies authenticated requests:

- User: `apps/user-portal/src/app/api/**` → `backendFetch('/transfers')` etc. with session cookie
- Admin: `apps/admin-portal/src/app/api/**` → same pattern with admin session

Session cookies are httpOnly; middleware redirects unauthenticated users to `/login`.

---

## Using this document with AI / future you

When starting a new chat or agent session on this repo:

1. **Attach or paste `About.md`** plus `.cursorrules` for product and security context
2. Point to the specific app: `apps/user-portal`, `apps/admin-portal`, or `apps/backend`
3. For money bugs, trace: **user action → transfers.service → merchants ledger → EscrowStack**
4. For UI work, both portals share the **glass design system**; keep admin and user visually aligned
5. Schema changes always need a new file in `apps/backend/supabase/migrations/`

---

## Reference docs

- [`Readme.md`](Readme.md) — quick start, migrations, commands
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — production deploy, DNS, VPS, Vercel, troubleshooting
- [`About.md`](About.md) — architecture, APIs, money flows (this file)

---

*Last updated: July 2026*
