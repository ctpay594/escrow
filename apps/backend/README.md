# Backend (NestJS)

CTPay API. Run from the **monorepo root**, not this folder.

Mac setup: [`../../MAC.md`](../../MAC.md)  
Overview: [`../../Readme.md`](../../Readme.md)

```bash
# from repo root
cp apps/backend/.env.example apps/backend/.env   # then paste secrets
pnpm install
pnpm dev:backend    # http://localhost:3000/health
```

EscrowStack keys stay in `.env` only. Never put them on Vercel.
