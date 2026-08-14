# Run this project on a Mac

You shut down Windows and continue here. Clone from GitHub, copy secrets that Git never stores, then run three terminals.

**Do not put `.env`, RSA keys, or EscrowStack JWTs in GitHub.** Those stay on your machines only.

---

## 1. Before you leave Windows

1. **Commit and push** the repo (code + docs only).
2. Copy these **off the PC** (AirDrop, USB, 1Password, or a private note). Git will not have them:

   | What | Where on Windows |
   |------|------------------|
   | Backend env | `apps/backend/.env` |
   | RSA private key (if not already inside `.env`) | `key/private.key` (folder is gitignored) |

3. Confirm `.env` and `key/` are **not** in `git status`. If they show as new files, do not add them.

---

## 2. Install tools (Mac)

Open **Terminal**. Install [Homebrew](https://brew.sh) if you do not have it, then:

```bash
brew install git node@22
brew install pnpm
```

Check versions (Node **20+**, this repo expects **pnpm 10**):

```bash
node -v
pnpm -v
git -v
```

If `node` is missing after brew, add it to PATH (Apple Silicon):

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

Optional: install [Cursor](https://cursor.com) and open the cloned folder.

---

## 3. Clone from GitHub

Use **your** remote (personal or company). Example:

```bash
cd ~
git clone https://github.com/YOUR_ORG/YOUR_REPO.git escrow
cd escrow
```

SSH instead of HTTPS if you use a GitHub SSH key:

```bash
git clone git@github.com:YOUR_ORG/YOUR_REPO.git escrow
cd escrow
```

---

## 4. Secrets on the Mac (required)

GitHub clone has **no** working API keys.

```bash
cp apps/backend/.env.example apps/backend/.env
```

Then paste values from the Windows `.env` you copied. You need at least:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `JWT_SECRET`, `ADMIN_JWT_SECRET`
- `ESCROWSTACK_BASE_URL`, `ESCROWSTACK_PAYOUT_URL`
- `ESCROWSTACK_API_KEY` (company JWT)
- `ESCROWSTACK_PRIVATE_KEY` (full PEM, newlines as `\n` inside quotes)
- `ESCROWSTACK_IFSC=HDFC0000060`
- `ESCROWSTACK_VA_PREFIX=CHAK69`
- `CORS_ORIGIN=http://localhost:3001,http://localhost:3002`

User portal and admin portal need **no** `.env` for local dev. They call `http://localhost:3000` by default.

Never commit `apps/backend/.env`.

---

## 5. Database (same Supabase as Windows)

You do **not** install Postgres locally. The Mac talks to the same **Supabase** project.

In **Supabase → SQL Editor**, run migrations **in order** if any are not applied yet:

`001` → `002` → `003` → `004` → `005` → `006` → `007` → `008` → `009` → `010` → `011` → `012` → `013` → `014` → `015` → `016`

Files: `apps/backend/supabase/migrations/`

**016** drops per-merchant encrypted API/private key columns. Platform keys live in `.env` only.

If you already have an admin row, skip this. Otherwise:

```sql
INSERT INTO public.admins (username, password)
VALUES ('admin', 'your-strong-password-here');
```

---

## 6. Install and run

From the **repo root** (`escrow/`):

```bash
pnpm install
```

Open **three** Terminal tabs:

```bash
pnpm dev:backend   # http://localhost:3000  — API (health: /health)
pnpm dev:user      # http://localhost:3001  — merchant CTPay portal
pnpm dev:admin     # http://localhost:3002  — admin portal
```

| App | URL |
|-----|-----|
| Health check | http://localhost:3000/health |
| User portal | http://localhost:3001 |
| Admin portal | http://localhost:3002 |

Log into admin with the `admins` table username/password. Onboard a merchant with **Add merchant** (name only; username/password and CHAK69 VA are generated).

---

## 7. If something fails

| Symptom | Fix |
|---------|-----|
| `pnpm: command not found` | `brew install pnpm` and reopen Terminal |
| Backend crash on missing env | `.env` missing or empty keys — copy from Windows |
| `GET /health` fails | Wrong `SUPABASE_*` keys |
| Admin list error | Run migrations through **016** |
| Create merchant fails on encrypted columns | Run **016** |
| Port already in use | Quit old Node: `lsof -i :3000` then `kill <PID>` |
| Frontends cannot reach API | Backend not running, or `CORS_ORIGIN` missing `3001`/`3002` |

---

## 8. What this product is (short)

Closed-loop **B2B payout + ledger** (CTPay). EscrowStack HDFC passthrough. One company API key + RSA key in backend `.env`. Each merchant gets a **CHAK69** virtual account and shared IFSC **HDFC0000060**. Admin approves payouts; signing never happens in the browser.

Full architecture: [`About.md`](About.md)  
Production (Vercel + VPS): [`DEPLOYMENT.md`](DEPLOYMENT.md)  
Commands: [`Readme.md`](Readme.md)
