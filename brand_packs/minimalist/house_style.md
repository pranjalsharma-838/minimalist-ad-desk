# Minimalist house style (voice + visual)

Built 2026-10-03 from:
- the website (`research/brand_corpus.md`, 80 titles, 6 product pages);
- 118 gallery images (`assets/index.json`);
- 18 live Minimalist Meta ads (`research/ad_corpus.json`);
- Amazon.in listings for the top 10 sellers (`raw/amazon_in.json`).

**Not yet captured:** Instagram organic posts, Flipkart, and Amazon for sellers 11–20. Tags: **[stated]** means the brand says it; **[observed]** means we counted or saw it.

## Voice

- **Ingredient and concentration first** [observed: 56 of 60 single products lead with a strength; titles follow "<Active> <N>% <Format>"]. The concentration is written exactly as on the pack, with no space before %. Sub-1 values keep the leading zero ("0.3%").
- **Educational, calm, declarative** [observed: 14-word mean sentence length in product copy, 1 exclamation mark across the whole catalog text, 0 emoji in brand-written copy]. Explain what the active does, in plain words.
- **Hedge results to appearance and feel** ("visibly", "the look of", "helps") [observed: the brand is inconsistent; follow the hedged form].
- **No fear, no fluff, no "natural" or "chemical-free" framing** [stated: "No unnecessary marketing fluff", "chemical-free products don't exist", against "fear mongering"].
- **Proof with its method:** ISO standard, lab, report number; consumer stats stay worded as "% subjects said…" with the timeframe [observed on product pages].
- **Labelled values are the claims; lab results go in the footnote**, unless lab results are the ad's theme (house rule, 2026-10-03).

## Visual

- **Palette:** white #FFFFFF, off-white #F4F2EE, black #111111, studio grey #E5E9EA. Each pack carries one thin accent line (green Niacinamide, pink Salicylic, orange SPF, yellow Vitamin C/Arbutin, purple Retinol); an accent may echo it at low saturation [observed].
- **Pack photography:** studio grey sweep, soft key light from the upper left, shadow falling lower right, product upright and centred [observed: all 20 top-seller pack shots]. Generated scenes must match this light.
- **Packaging:** black or amber dropper bottles and white tubes with white labels; a bold sans-serif wordmark [observed].
- **Brand infographics:** benefit callout cards, a "who is it for" card with dimensions, ingredient cards, stat cards [observed: 71 of 118 gallery images].
- **People:** none in the brand's own gallery. Two real hand or application photos exist (Light Fluid SPF 50, B12 + Oat cleanser) [observed].

## Ads on Meta: the creative standard (observed in top-running STATIC ads)

Full detail is in `ad_style_top_runners.md`, built from Minimalist's 8 static ads still running after 52–98 days (11 images). Videos are excluded: we make statics (user rule 2026-10-04).
- **Text:** 0–15 words on the image (one title, one short line, at most one small tag).
- **Product:** the hero, large on white or light grey, often with a texture swatch or held in a hand.
- **Offers:** in plain words as the title, with one tiny condition line.
- **Where details go:** in the caption.
- **CTA:** none on the image beyond a quiet "Shop now →".
- **People:** hands only in the statics, never faces. Full-person formats are a requested departure (see rule 6 there).
- **Sign-off:** "Hide Nothing." under the wordmark (Amazon brand slate; video end cards).

New concepts are welcome; look, tone and text density must match.

## Channel conflicts to watch (Amazon.in vs website)

The Amazon titles and bullets claim more than the website. Examples:
- "Anti-Acne" (face wash);
- "Dark Spots *Removal* Serum" (Alpha Arbutin);
- "Pore *Tightening* Treatment" (Salicylic serum);
- "moisturized for up to *12 hours*" (Vitamin B5; not on the website).

**Ads follow the website wording and the claims matrix, never the Amazon titles.**

## Do-not-use reminders

See `claims_matrix.md` (13 DO NOT USE). Also:
- the **Niacinamide 5% pack label itself says "heals"**, so it is flagged whenever that pack shot is used;
- 11 gallery infographics carry do-not-use claims ("anti-bacterial", "healing", "skin lightening"); never reuse them as-is (`assets/index.json` notes).
