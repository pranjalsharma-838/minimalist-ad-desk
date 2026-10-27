# Minimalist ad style — from its own top-running STATIC Meta ads

Source: Minimalist's **static** ads still active on 4 Oct 2026 after **52–98 days**: 8 ads, 11 images (7 single images and the first 4 cards of a carousel), in `research/minimalist_top_ads/` (`index.json` has ids, start dates and days running; `index.html` is the gallery). They were collected from the Meta Ad Library page Minimalistinc (India, active ads) with `scripts/collect_own_top_ads.js`. The page has 27 unique active ad cards (~190 ads counting versions): **19 are videos and are excluded**. We make static ads, so only statics are evidence (user rule 2026-10-04, for competitors and for Minimalist). The 10 video cover frames used in the first version of this file are kept, on record only, in `excluded_video_covers/`.

**New concepts are welcome; the look, the tone and the amount of text must match this.**

## What the static winners have in common

| | Static top runners do | Our earlier ads did (and must not) |
|---|---|---|
| Text on the image | **0–15 words.** Two of the eight carry no text beyond the pack and its box. The rest: a 2–3-line title and one small grey line. Carousel follow-up cards explain in 2–3 short paragraphs (~30 words). | Headline + big % + subhead + 3 bullets + 2–3-line footnote + band |
| Product | **The hero**: large, crisp, often with a texture swatch (gel splash, oil drops, a water ripple, petri dishes of texture) or held or dispensed by a hand | A smaller product beside a text column |
| Background | Pure white or very light grey, soft daylight | Busier generated scenes behind translucent panels |
| Typography | Clean sans-serif; a medium-weight title, one small grey line; lots of white space; text set beside the pack | Many sizes and weights, dense blocks |
| Tags | At most **one small label**: black with white text ("Clinically Tested", "Updated"), or one accent tag on an offer ("FREE") | Several pills or badges |
| Claims | One idea per ad: product + strength + one benefit ("Brightening Cleanser · 2X Benefit · Exfoliates & Brightens", "100% Squalane Moisturizing Face Oil") | Several claims per ad |
| Offers | The offer in plain words as the title ("Three products, At the cost of two") with one tiny condition line, or one small boxed line ("FREE Bottle on purchase of 2 products") | Big offer headline + bold price + long footnote |
| Routine | A big title ("Glow Boosting Routine") and three packs with numbered steps (1 CLEANSE · 2 TREAT · 3 PROTECT), each with its name, % and one word | — |
| Update / comparison | Old pack → new pack with an arrow and an "Updated" tag ("The Oat Cleanser you loved" → "B12 + OAT EXTRACT 6.5%") | — |
| People | **None.** The statics show hands only: holding, dispensing, applying. Faces and creator footage appear only in the brand's videos. | Studio-feel AI people in cards |
| Details | In the **caption** (primary text), not on the image | Ratings, sourcing, dates and how-to lines on the image |
| CTA | None on the image (Facebook's own button carries it) | Large black pill + product name band |
| Colour | White, black, greys; the pack's thin accent line; one accent only on an offer tag | — |

## Rules for new ads (house style for Meta statics)

1. **On-image text budget:** one title (2–6 words, usually product + % or one plain idea), one supporting line (≤ 8 words), optionally one tag (≤ 3 words, only a fact the page states). **No bullet lists on the image.**
   - **The style check (`scripts/style_check.js`) uses the statics' observed maximum as its ceiling,** so it never tightens beyond the evidence: ≤ 20 words on single-image layouts (their routine card is about 20) and ≤ 30 on list/step layouts (their carousel explainer cards run about 30).
   - **Headlines are ≤ 8 words** (exact study quotes exempt). Footnotes are ≤ 2 lines.
2. **Everything else goes in the caption** (`caption` / primary text): how to use, extra benefits, rating, reviews, sourcing and dates. The caption is compliance-checked like the image.
3. **Footnote only when the law needs it on the creative:** offer condition + "T&C apply", the SPF lab qualifier, a study qualifier for a stat shown on the image, the basis of a comparison, or "AI illustration" for AI-made results. Two lines at most.
4. **The product fills 50–65% of the frame.** Use a texture swatch or a hand where it fits; white or very light grey backgrounds; soft daylight.
5. **CTA:** a small, quiet "Shop now →" label at the bottom (one line, brand black). It's a departure from the top runners, kept because a user review asked for a visible CTA. Facebook's button does the rest. No big bands.
6. **People:** the brand's statics use **hands, not faces**. Hands-with-product is the default people shot. Formats with a full person (lifestyle, usage, routine journey) are built because a user review asked for them (Indian women and men). They are a deliberate departure from the brand's static look, so they keep the same white or light, natural settings, a UGC feel and no studio gloss, and they carry the AI mark until real photos replace them.
7. **One idea per ad.** If a concept needs three claims, it's three ads.
8. **Sign-off:** "Hide Nothing." sits under the wordmark (the renderer draws it). The brand uses it under its logo on its Amazon gallery's brand slate and on the end card of its two longest-running videos (121 days). It doesn't appear on the statics, so it stays small and quiet.
