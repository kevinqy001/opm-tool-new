# Dev site (Parts Match)

This folder is the **development** build. **Production** lives in `../prod/`.

| | Production (`prod/`) | Dev (`dev/`) |
|--|----------------------|--------------|
| **Branch** | `master` / `main` (GitHub Pages) | Same repo, `dev/` folder |
| **OPM tool** | Parts Match `POST /api/match` | Parts Match `POST /api/match` |
| **UI** | Same features; no Dev badge | Same features; Dev badge in header |
| **Input** | Part number only | Part number only |

## Local

```powershell
python opm-dev-server.py
```

- **Prod:** http://127.0.0.1:8765/prod/index.html  
- **Dev:** http://127.0.0.1:8765/dev/index.html  

Parts Match needs `.env.partsmatch.local` (see repo root `opm-dev-server.py` header).

**Auth check:** http://127.0.0.1:8765/partsmatch/_auth-check  
Startup should print `Parts Match: auth probe OK`. If not, refresh the cookie in `.env.partsmatch.local`.

If you previously ran `$env:PARTSMATCH_AUTH_COOKIE = "..."` in PowerShell, clear it so it does not confuse debugging:

```powershell
Remove-Item Env:PARTSMATCH_AUTH_COOKIE -ErrorAction SilentlyContinue
```

## Sharing with colleagues (not everyone runs Python)

`opm-dev-server.py` is **local dev only**. For internal users, pick one:

| Approach | Who runs Python? | Notes |
|----------|------------------|-------|
| **Shared internal host** | One VM / App Service runs the proxy; colleagues open a URL | Fastest for hackathon; one person refreshes `.env` cookie |
| **MSAL login in OPM** | Nobody | Best UX; needs Parts Match team to allow your app registration + CORS |
| **API key (like GC Match)** | Nobody | Ask Parts Match backend for a service key |
| **GitHub Pages `/dev/` alone** | N/A | Will 401 — no cookie, no proxy |

Recommended path: deploy static `prod/` + `dev/` + `shared/` to **Azure Static Web Apps** or **internal IIS/nginx**, with a small **BFF proxy** (this Python script, Azure Function, or Container App) that holds `AppServiceAuthSession` or uses **managed identity / app registration** server-side.

## GitHub Pages

After deploy from `master`:

- **Prod:** https://kevinqy001.github.io/opm-tool-new/prod/ (root `/` redirects here)  
- **Dev:** https://kevinqy001.github.io/opm-tool-new/dev/  

Parts Match on Pages may require backend CORS/auth; local dev server is recommended for Match testing.
