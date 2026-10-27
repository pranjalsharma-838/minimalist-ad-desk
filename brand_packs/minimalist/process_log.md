# Brand pack process log

- **2026-10-02:** website product catalog snapshot (80 products) and brand-language corpus (`research/brand_corpus.md`).
- **2026-10-03:**
  - website facts for the top-20 sellers (`raw/website.json`; 2 pages returned HTTP 503 and succeeded on retry);
  - `product_catalog.md` and `claims_matrix.md` built by `scripts/build_brand_pack.js` (rule-layer classification);
  - Amazon.in: collector captured the top 10 sellers, then stopped (`raw/amazon_in.json`, 11–20 "pending");
  - Flipkart and Instagram collectors were launched but saved nothing before the session reset. **Not captured.**
- **2026-10-03:**
  - asset library: 118 gallery images, 20 cut-outs (13 clean, 7 white packs unusable), all labelled (`assets/index.json`);
  - `house_style.md` written from the website, gallery, Meta ads and Amazon (Instagram missing).

**Known gaps:** Instagram, Flipkart, Amazon 11–20. The usage rights for customer before/after photos are unconfirmed.
