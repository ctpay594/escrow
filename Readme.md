# Escrow / CTPay

B2B payout and ledger platform built on **EscrowStack** (HDFC / VouchPay). Merchants use the **CTPay user portal**; admins onboard merchants and manage accounts from the **admin portal**. All EscrowStack keys and RSA signing stay on the backend only.

**Full project doc:** [`About.md`](About.md)

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
11. `011_admins_plain_password.sql` — re-bootstrap admin or set password manually after run

All files live in `apps/backend/supabase/migrations/`.

### 4. Create first admin (once)

Start backend, then:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/admin/auth/bootstrap" -Method POST `
  -ContentType "application/json" `
  -Body '{"username":"admin","password":"admin123456"}'
```

Only works when the `admins` table is empty. After migration `011`, existing bcrypt admins are removed — bootstrap again or insert a row in Supabase.

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

## Coming next

- Deposit webhooks crediting `real_balance` automatically
- Full payout webhook handling without manual reconcile
- Hourly CRON reconciliation (Supabase vs bank balance)
- Production deploy (Vercel + Hostinger VPS)

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
- `payout.cts.txt` — payout signing example
- `EStack-ESCROW-HDFC Chakrathalwar.postman_collection (1).json` — EscrowStack API collection

## GitHub

[github.com/0xali3n/escrow](https://github.com/0xali3n/escrow)
