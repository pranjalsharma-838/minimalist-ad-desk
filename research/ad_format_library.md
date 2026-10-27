# Ad format library (derived from 74 competitor Meta ads, 2026-10-02)

Source: `research/competitor_ads/*.json`. These are 74 active ads, each running 14+ days, from 10 Indian skincare brands. Counts use the collectors' `ad_type` tag; layout notes come from their `visual_notes`.

The first table describes what competitors do. The second describes how each format is rebuilt so it stays honest for an ingredient-transparency brand: which layout the renderer uses, which fields the brief must fill, and what is NOT carried over.

| Competitor format | n | Brands | What it looks like on Meta |
|---|---|---|---|
| offer_promo | 17 | 8 | Big discount or "Buy any 3 @ ₹799" block, products on pedestals or acrylic blocks, app badges |
| product_hero | 15 | 10 | Pack shot on a colour field, two-tone headline, 2–3 icon or check-mark benefits |
| before_after | 9 | 7 | Split skin close-ups (spots vs clear, acne vs clear), sometimes a face-split slider |
| problem_solution | 9 | 6 | Skin-problem macro (whiteheads, pore strip) or concern thumbnails linked to the product |
| routine_regimen | 7 | 6 | Step 1 / Step 2 products, a "daily duo", a kit group shot |
| testimonial_ugc | 7 | 4 | Review card with stars and "verified", or a creator selfie / unboxing |
| ingredient_explainer | 6 | 6 | Ingredient-to-benefit callouts (icons, lines) around the bottle |
| expert_authority | 2 | 2 | A doctor in a lab coat, or stat callout lines footnoted to a test |
| comparison | 1 | 1 | "European v/s Korean sunscreens" on graph paper, "Why choose?" |
| other (range guide) | 1 | 1 | Flat-lay of the range, each product tagged with a skin-type or benefit label |

## How each format is rebuilt (renderer `layout`, brief fields, what's dropped)

| Layout | Used for | Brief fields (all cited) | Not carried over, and why |
|---|---|---|---|
| `hero` | product_hero | headline, subhead, proof_points | Star ratings (social proof needs a source) |
| `actives` | ingredient_explainer | actives[] = {pct, name, line} | Ingredient efficacy shown as product efficacy (ASCI BPC report). Each line describes what the ingredient *does*, not a product result |
| `journey` | routine_regimen | steps[] = {label, product_handle, line}: real pack shots of 2–3 of our products | Kit "savings" claims, unless the marketer supplies the offer terms |
| `stat` | testimonial_ugc | stat = {value, label}, qualifier in the footnote | Customer reviews used as claims (CCPA 13). A consumer-study stat with its qualifier replaces them |
| `callouts` | problem_solution, expert_authority | callouts[] = {text}: concern or benefit labels pointing at the product | Skin close-ups (implied results; ASCI synthetic-content guideline). Doctors (need a real, consenting expert) |
| `spec` | comparison | specs[] = {label, value}: our own tested facts | Comparison with other brands or "regular" products without like-for-like data (ASCI 4.1) |
| `usvsthem` | comparison (Us vs Them, 2026-10-04) | compare {us, them, rows[] = {label, us, them}} + basis in the footnote | A named or recognisable brand, a rival's pack, "others hide / fake / harmful"; any row without a page fact behind both sides |
| `range` | range guide | range[] = {product_handle, label} | Benefit tags our facts don't support |
| `offer` | offer_promo | offer = {line, condition, valid_till}, entered by the marketer and marked unverified | Countdown / false urgency (ASCI dark-patterns guideline). "Free" without its condition (CCPA 7) |
| `before_after` | before_after | headline + footnote; two photo frames | AI-generated or retouched results. The frames stay empty and export stays blocked until real study photos are attached |
