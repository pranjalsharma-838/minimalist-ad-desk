# Image studio queue

The app never calls an image API. When someone asks for "a different image" in the app, it writes one request here and shows it as queued:

`<timestamp>_<handle>.json`

```json
{ "id": "20261005T101500Z_salicylic-acid-2", "handle": "salicylic-acid-2", "product": "Salicylic Acid 2% Face Serum",
  "prompt": "what the user typed", "base_image": "brand_packs/minimalist/assets/ai_renders/<handle>/<accepted>.png",
  "requested_at": "2026-10-05T10:15:00.000Z", "status": "queued" }
```

`base_image` is the verified master render (`assets/ai_renders/<handle>/`, the file named "accepted" in `verification.json`) if there is one, else `assets/hires/<handle>.jpg|png`, else the product page photo URL.

`npm run studio` (scripts/image_studio_worker.mjs) now does this by itself, without Claude: every 10 s it takes the oldest `queued` request, sets `working` (with a `progress` line the app shows), drives ChatGPT in its own visible Edge window, saves `<id>.png`, runs `scripts/verify_pack.py` against the real pack (the `<handle>_render.png` cut-out if there is one, else `base_image`), re-prompts in the same chat on FAIL/REVIEW (3 rounds in all), and writes the result: `done` (auto-check PASS), `needs_review` (still failing after 3 rounds; shown with a warning, not offered for ads) or `failed` (could not make it). It also writes `<id>_check.png` (real | AI | difference sheet) and `worker.log`. `STUDIO_DRY=1` runs it without a browser (the base image stands in), for testing. The older manual route below (`scripts/image_queue.mjs` + Playwright) still works.

The operator script works through the queue with the user's own ChatGPT (web), checks the pack label word by word against the real pack (up to 3 rounds), and writes the result beside the request:

`<id>.result.json`

```json
{ "status": "done", "image": "image_requests/<id>.png", "rounds": 2, "notes": "label verified" }
```

`status` is one of `queued`, `working`, `done`, `needs_review`, `failed`; `image` is a path inside the project folder (relative to the project or to this folder). The app polls this folder and shows the image when `image` exists. Any person in a result is an AI model: Severe risk with the AI mark, as everywhere else.
