# Deploy to GitHub Pages

## One-time setup

1. Install Git (if missing):
   ```powershell
   winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
   ```
   Restart the terminal, then run `git --version`.

2. Create a GitHub repository (empty, no README), e.g. `your-org/opm-ui`.

3. In this folder, initialize and push:
   ```powershell
   cd "path\to\opm tool_new"
   git init
   git add .
   git commit -m "Update OPM demo example part and GitHub Pages workflow"
   git branch -M main
   git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
   git push -u origin main
   ```

4. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

After the `Deploy GitHub Pages` workflow succeeds, the site is at:

`https://YOUR_ORG.github.io/YOUR_REPO/`

## Repository layout

```
/
  index.html          → redirects to prod/index.html
  prod/               → production (Parts Match)
  dev/                → development (Parts Match, Dev badge)
  shared/             → shared CSS, JS, assets
  opm-dev-server.py   → local dev + API proxies
```

## URLs

| Environment | GitHub Pages | Local (`python opm-dev-server.py`) |
|-------------|--------------|-------------------------------------|
| **Production** | `/` or `/prod/` | http://127.0.0.1:8765/prod/index.html |
| **Development** | `/dev/` | http://127.0.0.1:8765/dev/index.html |

## Notes

- **Production & development:** both use Parts Match (`POST /api/match`, catalog lifecycle for Series Coverage). `dev/` shows a Dev badge; `prod/` does not.
- **Local dev:** `python opm-dev-server.py` proxies `/partsmatch`; Parts Match needs `.env.partsmatch.local` (see `opm-dev-server.py` header).
- **GitHub Pages:** the browser calls the Parts Match API directly; the backend must allow CORS for your Pages origin (or use a BFF).
- OPM demo part number example: `N4100`.
