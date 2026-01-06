# Expense PWA (GitHub Pages + IndexedDB + Google Drive appDataFolder backup)

This is a **static** web app (no server) designed to be hosted on **GitHub Pages**.
- Local-first storage: IndexedDB (via Dexie)
- Weekly & Monthly shopping lists (planned vs actual)
- Manual expenses with category + date
- Summary charts + filters
- Manual **encrypted** backup/sync to **Google Drive appDataFolder**
- Record-level merge + conflicts inbox (delete-wins vs edit)

## Quick start (local)
Just serve the folder with any static server (required for ES modules + service worker).

Example (Python):
```bash
cd expense_pwa
python -m http.server 8000
```
Open: http://localhost:8000

## Configure Google Drive backup
Edit `config.js` and set your `GOOGLE_CLIENT_ID`.
See deployment steps in the chat response.
