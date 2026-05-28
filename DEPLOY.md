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

Open `index.html` via that URL (or the repo root if `index.html` is at the root).

## Notes

- GitHub Pages serves static files only; GC Match API calls go directly to Azure (`opm-config.js` / `opm-api-client.js`).
- OPM demo query example: `Need replacement for 2671001wb111kcd` (verified to return 3 recommendations).
- Local dev with API proxy: `python opm-dev-server.py` → `http://127.0.0.1:8765/index.html`
