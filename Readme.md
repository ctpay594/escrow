# Escrow / CTPay

B2B payout and ledger platform built on **EscrowStack** (HDFC / VouchPay). Merchants use the **CTPay user portal**; admins onboard merchants and manage accounts from the **admin portal**. All EscrowStack keys and RSA signing stay on the backend only.

**Full project doc:** [`About.md`](About.md)  
**Production hosting:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

## Apps

| App | Path | Port | Stack |
|---|---|---|---|
| User portal (CTPay) | `apps/user-portal` | 3001 | Next.js |
| Admin portal | `apps/admin-portal` | 3002 | Next.js |
| Backend API | `apps/backend` | 3000 | NestJS |

**Database:** Supabase (PostgreSQL) — migrations in `apps/backend/supabase/migrations/`

## What's built

### Backend
- Supabase connection + `GET /health`
- Merchant auth (JWT, httpOnly cookie) + admin auth (separate JWT)
- Merchant onboarding with EscrowStack integration
- AES-256 encryption for EscrowStack API key + private key (never sent to frontends)
- Live EscrowStack fetch: balance, virtual account, IFSC
- Internal ledger: available / pending balance hold on transfer request
- Transfer API: single + bulk batch upload
- Admin transfer approval with RSA-SHA256 payout signing
- Payout status reconcile polling (webhook wiring planned)
- Merchant **account status** enforcement (`active` / `on_hold` / `terminated`) on transfer API
- Login rate limit: 10 attempts per IP per 15 minutes (merchant + admin)
- No public root page on API (`GET /` returns 404); use `GET /health` only

### Admin portal (`localhost:3002`)
- Login / logout (7-day session)
- **Merchants hub** (`/`) — stats, search, onboard form, merchant table
- **Merchant detail** (`/merchants/[id]`) — status toggle, real/demo balance mode, portal access, embedded transfers
- Two-step onboarding: fetch EscrowStack details → create merchant
- Glass UI with iOS-style segmented controls (status, balance mode)
- Approve / reject transfers (single + bulk batch)
- Yes/No confirm dialogs for destructive or sensitive actions
- Mobile-friendly layout (responsive tables → cards, hamburger nav)

### User portal / CTPay (`localhost:3001`)
- Login / logout (7-day session)
- **Account** (`/`) — balances, load account, IFSC, status badge, quick actions
- **Transfer** (`/transfer`) — single payout wizard + bulk Excel/CSV upload
- **History** (`/history`) — last 48 hours, search, export, transfer detail popup
- Account status banner + profile badge when **on hold** or **terminated**
- Transfers blocked in UI and on backend when not active
- Glass UI aligned with admin portal; mobile-responsive

### Real vs demo balance

| Balance | Field | Admin | User portal |
|---|---|---|---|
| **Real** | `real_balance` | Live EscrowStack, refresh anytime | Shown when `balance_mode = real` |
| **Demo** | `demo_balance` | Editable display amount | Shown when `balance_mode = demo` |

Admin sets **CTPay shows Real / Demo** per merchant via segmented toggle.

### Account status

| Status | User portal |
|---|---|
| `active` | Full access |
| `on_hold` | View balance + history; transfers disabled |
| `terminated` | Read-only; no new transfers |

### Transfer flow

| Step | Actor | Action |
|---|---|---|
| 1 | Merchant | Submits on `/transfer` → `PENDING_APPROVAL`, funds held |
| 2 | Admin | Reviews on merchant detail, **Approve** or **Reject** |
| 3a | Approve | Backend signs + POSTs to EscrowStack → `PROCESSING` |
| 3b | Reject | Status → `REJECTED`, held funds released |
| 4 | Reconcile / webhook | Bank confirms → `SUCCESS` / `FAILED` |

## Quick start

### 1. Install

```bash
pnpm install
```

### 2. Backend env

Copy `apps/backend/.env.example` → `apps/backend/.env` and fill in:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`, `ADMIN_JWT_SECRET`
- `ESCROWSTACK_BASE_URL`, `ESCROWSTACK_PAYOUT_URL`, `ESCROW_AES_MASTER_KEY`
- `CORS_ORIGIN=http://localhost:3001,http://localhost:3002`

### 3. Supabase migrations

Run these in **Supabase → SQL Editor** (in order):

1. `001_create_users.sql`
2. `002_create_admins.sql`
3. `003_users_plain_password.sql`
4. `004_create_merchants.sql`
5. `005_merchant_real_demo_balance.sql`
6. `006_create_transfers.sql`
7. `007_transfer_utr.sql`
8. `008_merchant_balance_mode.sql`
9. `009_transfer_batches.sql`
10. `010_merchant_account_status.sql`
11. `011_admins_plain_password.sql` — insert admin password manually in Supabase after run

All files live in `apps/backend/supabase/migrations/`.

### 4. Create admin (Supabase only)

There is **no bootstrap API**. Add the first admin in **Supabase → Table Editor → `admins`**:

| Column | Value |
|--------|--------|
| `username` | e.g. `admin` |
| `password` | plain text, min 6 chars |

Or run in SQL Editor:

```sql
INSERT INTO public.admins (username, password)
VALUES ('admin', 'your-strong-password-here');
```

Login at the admin portal (`/login`). To reset a password later, edit the row in Supabase.

### 5. Run dev servers

Use separate terminals:

```bash
pnpm dev:backend   # API on http://localhost:3000
pnpm dev:user      # User portal on http://localhost:3001
pnpm dev:admin     # Admin portal on http://localhost:3002
```

## Commands

| Command | Description |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev:backend` | NestJS API (watch mode) |
| `pnpm dev:user` | User portal dev server |
| `pnpm dev:admin` | Admin portal dev server |
| `pnpm build` | Build all apps |
| `pnpm build:backend` | Build backend only |
| `pnpm build:user` | Build user portal only |
| `pnpm build:admin` | Build admin portal only |
| `pnpm lint` | Lint all apps |

## Production (CTPay)

| App | URL |
|-----|-----|
| User portal | `https://ctpay.tech` |
| Admin portal | `https://ct123.ctpay.tech` (hidden subdomain) |
| Backend API | `https://api.ctpay.tech` |

**Hosting:** User + admin on **Vercel**; backend on **Hostinger VPS**; database on **Supabase**.

### Deploy after code changes

See **[`DEPLOYMENT.md`](DEPLOYMENT.md)** for full hosting setup (DNS, VPS, Vercel, Supabase).

| App | How |
|-----|-----|
| **User portal** | Push to GitHub → Vercel auto-deploys (`apps/user-portal`) |
| **Admin portal** | Push to GitHub → Vercel auto-deploys (`apps/admin-portal`) |
| **Backend** | SSH to VPS, then: |

```bash
cd /var/www/escrow
git pull
cd apps/backend
pnpm install
pnpm build
pm2 restart escrow-api
```

Vercel env (each frontend project): `API_URL=https://api.ctpay.tech`, `NODE_ENV=production`.

Backend `.env` on VPS only — update `CORS_ORIGIN` if portal domains change.

## Coming next

- Deposit webhooks crediting `real_balance` automatically
- Full payout webhook handling without manual reconcile
- Hourly CRON reconciliation (Supabase vs bank balance)

## Transfer request fields (EscrowStack)

| Field | Required | Notes |
|---|---|---|
| `amount` | Yes | Deducted from available balance |
| `payout_mode` | Yes | `IMPS`, `NEFT`, `RTGS`, `UPI` |
| `beneficiary.account_name` | Yes | Beneficiary name |
| `beneficiary.account_no` | Bank modes | IMPS / NEFT / RTGS |
| `beneficiary.ifsc` | Bank modes | IMPS / NEFT / RTGS |
| `beneficiary.vpa` | UPI | UPI ID |
| `transaction_note` | Optional | Your reference note |

## Reference files

- `About.md` — full architecture, APIs, money flows, security
- `DEPLOYMENT.md` — production hosting step-by-step
- `payout.cts.txt` — payout signing example
- `EStack-ESCROW-HDFC Chakrathalwar.postman_collection (1).json` — EscrowStack API collection

## GitHub

[github.com/0xali3n/escrow](https://github.com/0xali3n/escrow)
