# Minimalist Ad Desk (online copy)

Internal test tool. Minimalist (beminimalist.co) is used only as a test brand to build and prove an ad pipeline; nothing here is made by or for Minimalist, and no ad is for publication.

- **The tool:** paste a beminimalist.co product link and it shows that product's ads from the library, then builds every format it can fill from the page. Paste your own Claude API key (Settings) for AI-written copy and the AI judge; without one it uses the page's own wording and the rule checks. Keys stay in your browser tab and are never stored on the server. New images are not made online.
- **The ad library:** `docs/` is the static review page of every finished ad in 1:1, 4:5 and 9:16.

Runs with Node 20+, no install: `ONLINE=1 node server.js`. Deployed on Render from `render.yaml`; the gallery is served by GitHub Pages.
