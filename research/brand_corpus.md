# Minimalist (beminimalist.co) — Brand Corpus Evidence Base

Role: brand corpus researcher. This file is **evidence only** (verbatim quotes, counts, URLs). No rules are written here.
All quotes are copied verbatim from the source, including the brand's own typos and spacing. Where text is my summary, it is NOT in quotation marks.

---

## 1. Sources (all accessed 2026-10-02)

| # | Source | Notes |
|---|---|---|
| S0 | `research/products_snapshot_2026-10-02.json` (Shopify `/products.json`, 80 products) | Titles, handles, `body_html`, tags |
| S1 | https://beminimalist.co/ (homepage) | Value pillars, best-seller tiles, meta description |
| S2 | https://beminimalist.co/pages/about | About / mission / values |
| S3 | https://beminimalist.co/pages/our-values | Founding philosophy (anti-"natural", anti-"chemical-free") |
| S4 | https://beminimalist.co/products/niacinamide-10-with-matmarine | Full PDP incl. accordions + FAQ |
| S5 | https://beminimalist.co/products/salicylic-acid-2 | Full PDP incl. Consumer Studies + FAQ |
| S6 | https://beminimalist.co/products/light-fluid-spf-50-sunscreen | Full PDP incl. Clinical Results (ISO 24444) |
| S7 | https://beminimalist.co/products/alpha-arbutin-2 | Full PDP incl. in-vitro benchmark study + FAQ |
| S8 | https://beminimalist.co/products/multi-vitamin-spf-50 | Best-seller sunscreen PDP |
| S9 | https://beminimalist.co/products/vitamin-c-ethyl-ascorbic-acid-10-acetyl-glucosamine-1 | Best-seller Vit C PDP |
| S10 | https://beminimalist.co/blogs/skin-care/barrier-first-everything-else-later | Recent long-form "B12 deep-dive" (1,071 words) |
| S11 | https://beminimalist.co/blogs/guide/here-s-a-no-bs-guide-to-using-azelaic-acid-for-your-skin | Older guide, dated "12th Dec 2020" (2,805 words) |
| S12 | https://beminimalist.co/pages/faqs, /pages/disclaimer, /search?q=concentration+transparency | Checked for transparency content — none found (see §7) |

Important caveat on S0: the `body_html` corpus is thin — **2,064 words total across 80 products**. 4 bodies are empty, 46 are under 80 characters, and **32 bodies contain only "When to use: … Frequency: …"** (e.g. niacinamide-10, salicylic-acid-2, alpha-arbutin-2, light-fluid-spf-50, all hero SKUs). The real claim copy lives in theme sections (accordions) on the live PDP, which is why S4–S9 were read live. Counts in §4 are therefore reported separately for S0 and for the live pages.

---

## 2. Product naming convention

### 2.1 Core pattern — counted over 80 titles (S0)
- **49 / 80 titles contain a `N%` concentration.**
- **48 / 49** follow `<Active(s)> <N>% <Format>`, e.g. "Niacinamide 10% Face Serum", "Salicylic Acid 2% Face Serum", "Retinal 0.1% Face Serum".
  - Exception 1 (% at end): "Anti Dandruff Shampoo 3.5%" (only title ending in %).
  - Exception 2 (% mid-name, second active after it): "Ceramides 0.3% + Madecassoside Moisturizer".
- The 31 titles without `%` break down as: 17 kits/sets/duos/trio, 3 merch/freebies (Tote Bag, Travel Pouch, Free Surprise Gift), 6 SPF products, 4 baby-care ("Pediatrics" handles), 1 ppm product ("HOCL Skin Relief Spray 150 ppm").
- Of the 60 single-formula (non-kit, non-merch) products: **49 carry a %, 6 carry an SPF number, 1 carries ppm → 56 / 60 lead with a numeric strength.** Only the 4 baby-care products carry none ("Zinc Oxide + B5 Healing Ointment", "Provitamin D3 Massage Oil", "Ceramide & Vitamin B5 Delicate Cleanser", "Ceramide & Squalane Nourishing Lotion").

### 2.2 How the number is written
- **Space before `%`: 0 / 49** (always "10%", never "10 %").
- **Decimals: 14 / 49** (2.5%, 15.6%, 7.3%, 5.5% ×2, 1.25%, 3.5% ×2, 0.6%, 0.1%, 0.8%, 6.5%, 0.3% ×2). Sub-1 values always written with a leading "0." ("0.1%", "0.3%", "0.6%", "0.8%"), never ".3%".
- **Leading zeros in titles: 4 / 49** — "Salicylic + LHA 02% Cleanser 20ml" (×2, gift/mini SKUs), "Vitamin B12 + NMF 03% Face Toner", "Marula Oil 05% Cleansing Oil". The other 45 use no leading zero ("2%", "5%", "8%").
- **Leading zeros in URL handles: 15 / 80** (e.g. `alpha-lipoic-glycolic-07-cleanser`, `glycolic-acid-08-exfoliating-liquid-toner`, `vitamin-k-retinal-01-eye-cream`, `niacinamide-05-body-lotion`) — while the matching titles read "7%", "8%", "1%", "5%". So the leading-zero style survives in handles and some body copy but has mostly been dropped from display titles.
- Leading zeros also appear in kit body copy (S0, body-care-kit): "Salicylic Acid + LHA 02% Body Wash", "Nonapeptide + AHA 06% Roll-on", "Niacinamide 05% Body Lotion" — whereas those products' own titles are "Salicylic Acid + LHA 2% Body Wash", "Nonapeptide + AHA 6% Underarm Roll-On", "Niacinamide 5% Body Lotion". **Inconsistency is a finding.**
- Same product, two spellings: "Salicylic Acid + LHA 2% Cleanser" (full size) vs "Salicylic + LHA 02% Cleanser 20ml" (mini).
- The % in the title is often a **combined total of several actives**, not one active: "AHA PHA BHA 32% Face Peel" (handle `aha-25-pha-5-bha-2`), "Vitamin C + E + Ferulic 16% Face Serum", "Hair Growth + Anti-Grey 15.6% Hair Serum" (body: "a 15.6% blend of 6 proven actives"), "Multi-Peptides 10% Face Serum", "Multi Repair Actives 15% Face Serum".

### 2.3 Joining multiple actives
- **"+" used in 19 / 80 titles** (18 of the 49 % titles + "Zinc Oxide + B5 Healing Ointment"). E.g. "Copper Peptide + PDRN 1.25% Face Serum", "Kojic + Mandelic 2.5% Body Lotion".
- "&" used in 7 titles — never inside a %-led formula name; only in baby-care names ("Ceramide & Squalane Nourishing Lotion") and kit/gift names ("Glow & Protect Skincare Gift Set").
- One % title lists actives with no joiner at all: "AHA PHA BHA 32% Face Peel".

### 2.4 Format word
Format tokens after the % (S0): Face Serum 15, Cleanser 6 (incl. 20ml minis, "Gentle Cleanser"), Hair Serum 3, Face Moisturizer 3, Hair Shampoo 2, Face Toner 2, Body Lotion 2, Moisturizer 2, and singletons (Cleansing Oil, Lip Treatment Balm, Eye Cream, Anti-Dandruff Serum, Underarm Roll-On, Hair Mask, Body Wash, Exfoliating Liquid, Face Oil, Face Peel, Face Exfoliator, Face Cream). Body-area prefix present in 33 / 49 % titles ("Face" 24, "Hair" 6, "Body" 3).

### 2.5 SPF naming
- 7 titles contain "SPF": "SPF 50 Sunscreen", "SPF 60 Sunscreen", "Light Fluid SPF 50 Sunscreen", "SPF 30 Body Lotion", "Lip Balm SPF 30", "Frizz Control Complex SPF 30 Hair Serum", "Brightening & SPF Skincare Gift Set".
- Always "SPF" + space + number (0 instances of "SPF50"). **PA rating never appears in a display title**; it appears in the PDP subtitle ("Broad Spectrum SPF 50, PA++++") and in SEO page titles.

### 2.6 Other naming observations
- Brand name in title: 3 / 80 ("Minimalist Tote Bag", "Minimalist Travel Pouch", "Minimalist B12 + Repair Complex 5.5% Face Moisturizer 10g").
- Spelling: "Moisturizer" (US) in **6 / 6** titles; but "Moisturiser" (UK) in homepage image alt text ("Vitamin B5 10% Moisturiser"), in S10 ("B12 + Repair Complex 5.5% Moisturiser") and S8 ("moisturiser-meets-sunscreen"). Kits use "Kit" (10), "Gift Set" (4), "Duo" (2), "Trio" (1); body copy uses "Combo" (6).
- Emoji in titles: 1 / 80 ("🎁 Salicylic + LHA 02% Cleanser 20ml", a gift SKU).
- **SEO `<title>` tags differ sharply from display titles** — long, keyword-stacked, outcome-led:
  - S4: "Niacinamide 10% + Zinc & Matmarine for Blemishes, Acne Marks, Oil Balancing & Dark Spot - Clarifying Face Serum for Acne Prone or Oily Skin | Minimalist"
  - S7: "Alpha Arbutin 2% Face Serum for Pigmentation, Blemishes, Dark Spots & Tan Removal - Suitable for All Skin Types | Minimalist"
  - S9: "Vitamin C 10% for Brighter Glowing Skin - Stable & Effective Face Serum with pure Ethyl Ascorbic Acid & 1% Acetyl Glucosamine | Minimalist"
  - S6: "Light Fluid SPF 50 - Broad spectrum, PA++++ Rating, Water & Sweat Resistant - Suitable for All Skin Type | Minimalist"
- Concern sub-line under each tile (homepage S1), pattern = comma/ampersand list of concerns: "Acne Marks, Acne Prone & Oily Skin", "Dullness, Spots & Loss of Elasticity", "Acne, Oily Skin, Blackheads & Irritation", "Sun protection, UV exposure / damage", "Damaged Barrier, Oily & Dehydrated".

---

## 3. How claims are phrased on product pages

### 3.1 PDP structure (identical across S4–S9)
Concern headline → 1–2 sentence description → one customer quote ending "-Firstname I." → 4 badges → accordions "What Makes It Potent?", "Ideal For", ["Clinical Results" on S6, S7, S8], "How to Use", "Consumer Studies" → "Ingredients" (key actives) + "All Ingredients" (full INCI) → "FAQs" (specs, manufacturer).

Badge row, verbatim:
- S4, S5, S6, S7, S9: "Fragrance Free / Non-comedogenic / Essential Oil Free / pH: <range>" (pH ranges: S4 "pH: 5.5 - 6.5", S5 "pH: 3.2 - 4.0", S6 "pH: 5.0 - 6.0", S7 "pH: 4.7 - 5.2", S9 "pH: 3.8 - 4.8").
- S8: "Fragrance free / Non-comedogenic / White cast free / pH: 6.0 - 7.0".
→ pH is disclosed on **6 / 6** PDPs read; "Fragrance Free" on 6 / 6; "Non-comedogenic" on 6 / 6.

### 3.2 Consumer-perception stats — format and what is (not) disclosed
Format is consistently "NN% subjects <verb> <result> in/after N weeks". **No sample size (n), no study design, no dates, no lab named** for these perception stats. Verbatim:
- S5 Salicylic: "90% subjects noticed visible skin clarity in 4 weeks" / "93% subjects saw significant reduction in active acne in 4 weeks" / "97% subjects said skin felt less oily throughout the day after using this serum for 2 weeks"
- S7 Alpha Arbutin: "90% subjects noticed reduction in hyperpigmentation marks in 8 weeks" / "90% subjects said skin became clear & even looking in 8 weeks" / "93% subjects said it reduced sun tanning after 4 weeks of use"
- S9 Vitamin C: "88% subjects felt this serum improved skin radiance in 4 weeks" / "90% subjects said their dark spots faded after 8 weeks" / "93% subjects said skin felt healthier after 4 weeks of usage"
- S4 Niacinamide: no % stats; Consumer Studies reads only "The product has been evaluated for safety through patch testing under the supervision of a Dermatologist."
- Safety footnote, verbatim, on **6 / 6** PDPs: "The product has been evaluated for safety through patch testing under the supervision of a Dermatologist."

### 3.3 Lab / clinical results — where disclosure IS detailed
- S6 Light Fluid SPF 50: "Test type: IN-VIVO Evaluation of sun protection by International Standards - ISO 24444:2019Study Number: MS24.SPF.A1764.UPPL.ISO24444.ST10.REPSPF value obtained: 56PA rating: ++++ (Data based on in-vivo tests conducted by Advanced Science Laboratories, an independent third party product testing lab)"
- S6 also: "Thoroughly tested - IN VIVO ISO 24444:2019 by the US independent lab and confirmed SPF of 56 was obtained." and "Clinically tested on humans in US FDA-approved labs, this sunscreen provides a hydrating, non-greasy finish with no white cast, pilling, or irritation."
- S8 SPF 50: "Study Number: MS22.SPF.A1015.UPPL.ISO24444.ST15.REP.REVSPF value obtained: 56.6PA rating: ++++" and "Thoroughly tested by an independent lab and confirmed SPF of 50 was obtained" (note: same page states 56.6 and "SPF of 50").
- S7 Alpha Arbutin (in-vitro, vs an unnamed competitor): "We conducted in-vitro test (lab test) on skin identical model to evaluate the efficacy of this product in comparison to an Alpha Arbutin 2% serum from an international brand that offers active based products (called benchmark here). … While the benchmark product reduced melanin by 56%, Minimalist Alpha Arbutin 2% reduced melanin concentration by 70%. That is 25% more reduction than the benchmark product. Study objective: To assess the skin depigmentation efficacy of test products on Melanoderma skin 3D model.Tissue kit: MEL-312/300B, 12/24Pigment: Black skinStudy report no: PREC/USSL/SR/2021-144(Based on an in-vitro study conducted by MS Clinical Research Lab - an independent testing lab)"
- Ingredient-level clinical claims (attributed to the ingredient, not the finished product):
  - S4: "Pure 10% Niacinamide is clinically proven to promote protein synthesis, reduce melanin concentration & improve skin complexion in 2 weeks"
  - S5: "Formulated with White Horehound Extract which has anti-microbial & anti-inflammatory properties and it is clinically proven to reduce number of blackheads by 50% after 28 days of application"
  - S7: "Found to have 20 times more potent inhibitory activity than Kojic Acid in a clinical study" and "Alpha Arbutin (9 times more effective than Beta Arbutin)"
  - S9: "\"Ethyl Ascorbic Acid\" that has 86% pure Vitamin C content. That is much higher than 40-50% content present in other Vitamin C derivatives."
- Supplier name-drops, verbatim, on 5 / 6 PDPs: S4 "Our Niacinamide comes from Lonza, Switzerland and Matmarine is sourced from Lipotec USA, USA"; S5 "RonaCare Salicylic Acid Extra Pure from Merck, Germany"; S6 "The primary filters are sourced from BASF, Germany."; S7 "sourced from Alfa Aesar, USA"; S8 "sourced from BASF, Germany and Royal DSM, Netherlands"; S9 "ET-VC, high purity Ethyl Ascorbic Acid, from Corum Inc, Taiwan".
- Blog S10 cites numbered references ("[1] Mack Correa et al. (2023). Skin Barrier Function. Cells. PMC10706187") and labels a stat's basis: "+31.1% skin water content · 2h / −8.8% water loss (TEWL) · 2h / In-vivo study on selected ingredients".

### 3.4 Hedged vs. direct phrasing (both present)
Hedged / cosmetic-safe ("visibly", "appearance", "-looking", "helps"):
- S0 kojic: "Formulated to visibly reduce the appearance of dark spots and sun-induced hyperpigmentation while gently exfoliating for a brighter, more even-looking skin tone."
- S0 hair-growth: "visibly reduces grey hair density and helps restore natural hair pigment"
- S10: "topical B12 may help calm visible signs of reactivity and discomfort." / "Helps support barrier repair" / "helps soothe the feel of irritation, reduce the look of redness"
Direct / absolute:
- S4: "Niacinamide reduces the sebum level of the skin, improves the barrier & evens our skin tone."
- S7: "for dramatically reducing dark spots and blemishes" / "that ensures even tone in 5 weeks"
- S0 anti-dandruff: "Experience visible results from the first wash" / "clinically proven blend of Piroctone Olamine, Climbazole, and Salicylic Acid"
- S0 maleic gift set: "formulated to reverse hair damage and frizz"
- S9: "Formulated in Centella Water to soothe and heal skin"
- S5 FAQ: "Is salicylic acid good for acne treatment? Yes. Not only does it reduce active acne, …"
- S7 key ingredient: "It helps treat hyperpigmentation by effectively reducing the production of melanin"

### 3.5 "Dermatologist / clinically" claim wording
- S0 (all 4 baby-care bodies), verbatim: "Proven Safe: Clinically Tested to be Hypoallergenic, Non-Comedogenic, Sensitive skin safe, Pediatrician-approved & Kind to Biome Certified, this Ointment is clinically validated for safety. All tests are conducted on humans in presence of a certified Dermatologist & Pediatrician in an Independent UK lab." (2 of 4 add "recognized by the National Eczema Association (NEA) with the Seal of Acceptance™").
- S6: "This dermatologist-approved sunscreen offers photostable, broad-spectrum protection for sensitive and eczema-prone skin."
- S2 About page badges: "Clinically Proven" / "Recommended by Dermatologist" (no supporting detail on that page).
- S11 byline: "Medically reviewed by Minimalist Health Specialist -  Written by Arpita Singh (Beauty Expert)  on 12th Dec 2020"

### 3.6 SPF / PA claims
- PDP subtitle, S6 and S8: "Broad Spectrum SPF 50, PA++++"
- S6: "protect against UVA / UVB rays" / "Meets EU recommendation of SPF / UVA ratio (3:1) for protection against UVA & UVB rays." / "A Sweatproof, fast-absorbing sunscreen" / "water-resistant"
- S8: "This broad spectrum SPF 50 with PA++++ rating" / "It is a Photostable & Acne safe sunscreen that does not leave any white cast on application."
- S0 gift set: "lightweight sunscreen with a PA++++ rating for sun protection"
- Reapplication language, verbatim on S6 and S8: "Apply sunscreen at least 15 minutes before sun exposure. For added protection, reapply in case of continued sun exposure, swimming, perspiring or towel drying."
- Pregnancy caveat tied to a named filter, S6: "we recommend avoiding sunscreens formulated with this filter during pregnancy or the lactation period." (S8 same, naming Octocrylene).

### 3.7 Suitability / age / pregnancy statements (risk disclosure)
- "Ideal For" block lists skin type, concern, minimum age: S4 "Suitable for: 16+ years of agePregnancy/Lactation: Safe"; S5 "Suitable for: 18+ years of age"; S7 "Suitable for: 18+ years of age"; S9 "Suitable for: 16+ years of agePregnancy/Lactation: Safe".
- S5 FAQ on purging: "Any active ingredient that promotes cell turnover can cause purging in certain people … purging usually subsides in 3-4 weeks. … If you are new to acids, apply 2-3 times a week, and gradually increase your frequency."
- S5 FAQ: "People with specific skin conditions or health issues shall also consult their doctor before using any direct acid."
- Frequency is disclosed per product in S0 bodies: counts — "Everyday" 28, "Alternate days" 4, "Twice a week" 2, "Once in 2 weeks" 1.

---

## 4. Vocabulary

### 4.1 Term counts — S0 `body_html` (80 products, 2,064 words). Format: occurrences (products containing)
**Hype / absolute terms — 0 is a finding:**
flawless 0 · miracle 0 · magic 0 · glow-up / glow up 0 · instant 0 · instantly 0 · overnight 0 · guarantee(d) 0 · "100%" 0 · best 0 · "#1" 0 · number one 0 · amazing 0 · incredible 0 · revolutionary 0 · breakthrough 0 · superior 0 · luxury 0 · premium 0 · permanent(ly) 0
Low but non-zero: ultimate 1 (1) · perfect 2 (2) · powerful 5 (5) · potent 1 (1) · advanced 3 · expertly 1 · youthful 2 · glow 2 (1) · glow-boosting 1 · radiant 3 (3)

**Fairness / whitening family:**
fair / fairness / fairer 0 · whitening / whiten 0 · lighten / lightening 0 · brighten 2 (2) · brightening 1 (1) · "skin tone" 3 (3) · complexion 2 (2) · dark spots 3 (3) · pigmentation 2 · hyperpigmentation 2 · tan 0

**Medical / drug-like verbs:**
cure / cures 0 · treat / treats 0 · treatment 2 (2; "deep treatment" hair mask, "Lip Treatment Balm") · heal 1 (1) · healing 1 (1; both baby ointment: "prevent and heal diaper rashes") · eliminate 1 · reverse 1 · combats 2 · fights 1 · fight 1 · prevent(s) 5 · repair 17 · repairs 6 · restore(s) 4

**"Natural / chemical / clean" family:**
chemical-free / chemical free 0 · toxin / toxic / non-toxic 0 · natural 4 (4; all descriptive: "natural shine", "natural hair pigment", "Natural Moisturising Factors", "natural texture") · naturally 0 · clean beauty 0 · clean 5 (4; "clean matte finish" bag, "easy to clean", "refreshed, clean")

**Ageing spelling:** anti-aging 2 (2) · aging 3 (2) · anti-ageing 0 · ageing 0 in S0. BUT live pages use UK "ageing": S2 "acne, pigmentation, ageing, dehydration"; S9 "targets visible signs of ageing". Kit title uses "Anti Aging Skin Care Kit". → Mixed US/UK.

**Hedge words:** helps 5 (5) · help 2 · may 0 · can 1 · visibly 4 (4) · visible 2 · appearance 1 · -looking 2 · reduce/reduces 7 · improve(s) 0 · fade/fades/fading 7

**Proof / safety vocabulary:** clinically 10 (5) · clinically tested 5 (4) · clinically proven 1 (1) · clinically validated 4 · proven 7 (7) · dermatologist 4 (4; all baby-care) · certified 8 · hypoallergenic 6 · pediatrician-approved 4 · non-comedogenic 5 (4) · tested 5 · formulated 8 (8) · concentration 1 · study / studies 0 · research 0 · science 0 · efficacy 0 · transparen* 0 · fragrance-free 0 (but "Fragrance Free" badge on every PDP, see §3.1) · sulfate-free 1 · aluminium-free 1 (UK spelling) · cruelty / vegan / paraben 0 · patent 0 · FDA 0

**Sun:** uv 5 · spf 4 · pa++++ 1 · broad-spectrum 1 · water-resistant 1 · white cast 1

**Top content words (S0, stopwords removed):** hair 38, frequency 32, everyday 28, repair 17, acid 16, vitamin 16, serum 15, formula 10, clinically 10, lightweight 9, formulated 8, safe 8, certified 8, proven 7, ceramide 7, sensitive 7, barrier 6, gentle 6, hypoallergenic 6, nourishes 6, protects 6.
→ Vocabulary is ingredient-names + mechanism verbs + texture ("lightweight", "non-greasy", "fast-absorbing").

### 4.2 Live-page (S1, S4–S9) occurrences of terms that are 0 in S0 — these exist on the site
- "flawless": S5 "keeps your oils in check for that flawless matt looking skin."
- "lightening" / "lightens": S7 "a potent & safe skin lightening active Alpha Arbutin"; S7 FAQ "It lightens the areas that are darker such as age spots, sun damage, hyperpigmentation" and "it is a safe skin lightening active suitable for all skin tones."
- "Tan Removal": S7 SEO title. "Tanning & Sunspot" in S7 Ideal For.
- "dramatically": S7 "for dramatically reducing dark spots and blemishes".
- "best": S1 pillar "Only the best / Ingredients sourced from across the world"; S1 meta "ensuring only the best products reach you"; S4 "Formulated with best ingredients sourced from leading global suppliers"; S7 "Use sunscreen during the day for best results"; "Best Seller" badge on tiles; S7 "Formulated with the most effective Alpha Arbutin".
- "treat" / "treatment": S7 "It helps treat hyperpigmentation"; S5 FAQ "Is salicylic acid good for acne treatment?"
- "heal": S9 "to soothe and heal skin".
- "glow": S9 "A glow-boosting daily serum", "to give skin a glow", "giving skin the much-needed glow"; S9 SEO "Brighter Glowing Skin".
- S11 (2020 blog): "You must have heard about hydroquinone being an excellent skin-whitening ingredient." (descriptive, about a different ingredient).
- Customer reviews on PDPs/homepage (UGC, not brand copy) contain "works like magic", "amazing", "best", emoji — the brand surfaces these. E.g. S4 review: "The best serum which works like magic for combination skin girlies".

---

## 5. Tone markers

| Marker | S0 body_html | Live PDPs (S4–S9) | S10 (recent blog) | S11 (2020 blog) |
|---|---|---|---|---|
| Words | 2,064 | ~150–350 per PDP accordion set | 1,071 | 2,805 |
| Mean / median sentence length | 14.0 / 14 words (147 sentences; p90 = 24) | not computed | not computed | not computed |
| "you" / "your" | 1 / 16 | low; mostly imperative ("Apply 2-3 drops…") | 0 / 2 | 37 / 31 |
| "we" / "our" | 0 / 3 | "Our high-purity salicylic acid…", "We conducted in-vitro test" | 0 / — | 1 / — |
| Exclamation marks | **1** ("Glow, protect, and renew with every step!") | 0 in brand copy captured (reviews excluded) | 0 | 2 (incl. title "No BS Guide to Using Azelaic Acid for Your Skin!") |
| Emoji | 0 (1 in a gift-SKU title: 🎁) | 0 in brand copy; present in reviews | 0 | 0 |
| hedges may / can / helps | 0 / 1 / 5 | low | 4 / 4 / 12 | 10 / 24 / 3 |

Educational framing (explains mechanism, names the molecule):
- S5: "Our high-purity salicylic acid easily penetrates the pore lining and scoops out the dirt, debris, and sebum, so skin looks clear and baby-soft"
- S5 key ingredient: "It dissolving dead skin cells and sebum from inner walls of pores (where AHAs cannot reach as they are water soluble)." (typo verbatim)
- S0 roll-on: "Nonapeptide-1 inhibits hyperproduction of melanin induced by α-MSH, hence fading underarm darkness & making it even looking."
- S0 roll-on: "keeps your underarms odour-free instead of masking it with fragrance."
- S10: "It acts as a scavenger of nitric oxide (NO), a molecule that promotes inflammation and irritation in reactive or sensitive skin."
- S10 pull-quote: "Barrier repair isn't one step in a routine. It's the prerequisite for every other step to work."
- S10: "The pink tint is pure Vitamin B12 (Cyanocobalamin). No dyes. Just the formula at work."
- S10: "Sensitive skin isn't fragile. It's responsive, and B12 helps it respond better."

Fear / insecurity framing:
- Brand copy (S0, S4–S9): no shame/insecurity framing observed; problems are named as clinical concerns ("Acne, Oily Skin, Blackheads & Irritation", "Damaged Barrier"). The strongest problem-agitation is mechanistic (S10 "the sensitivity loop begins", "Piling on actives during a flare only makes it worse").
- S3 explicitly **criticises** fear framing by other brands: "inaccurate advice & incorrect claims being made by beauty brands which results in fear mongering, misconceptions".
- S11 (2020, older voice) is casual and mildly agitating: "Acne, without any prior notice, can come knocking at your door. Think about the surprise tests that the kids get at school." / "So, be prepared for the hassles that come with it!" — tonal contrast with S10's clinical, figure-labelled style ("FIG. 01 · SKIN BARRIER STRUCTURE").

Register notes: copy uses "&" heavily in headlines ("Reduces Dark Spots, Marks & Evens Skin Tone"); clinical nouns (TEWL, tyrosinase, stratum corneum, ISO 24444:2019) appear un-simplified on consumer pages; typos are present in live copy (S5 "It dissolving", S8 "unwated residue", S6 "Ethylhexyl methoxycinnamte", S7 key-ingredient copy "In a study, Butyresorcinol exhibited").

---

## 6. Explicit brand-philosophy statements (verbatim)

Transparency
- S1: "Transparency / Full disclosure of ingredients used & their concentration"
- S2: "It was founded in 2020 with a belief that the skincare industry requires a revolution with respect to transparency of ingredients."
- S2: "Transparency / We believe in being honest and clear, whether it’s about our ingredients or how we communicate."
- S3: "Founded in 2020 with the belief that beauty industry requires a revolution with respect to TRANSPARENCY."

Not over-claiming / anti-fluff / anti-"natural"
- S3: "There is lot of inaccurate advice & incorrect claims being made by beauty brands which results in fear mongering, misconceptions and eventually consumers making wrong decisions."
- S3: "For example, the blind march towards beauty products with 'Natural' claims is really concerning. There is a misconception that 100% natural is safe & effective and anything that sounds like a chemical is unsafe. This is completely wrong."
- S3: "\"Everything is a chemical – water is a chemical – therefore, chemical-free products don’t exist.\""
- S3: "We wanted to address this issue of lack of transparency through a range of products that are straightforward, honest and do what they claim to do. No unnecessary marketing fluff. And this is how Minimalist was born."
- S2: "At Minimalist, we aim to make skincare simple, honest, and backed by science.We aim to eliminate the guesswork from skincare, empowering individuals with trustworthy products and knowledge to make informed choices."

Efficacy / science
- S1: "Embrace Minimalist, where each element is chosen for its scientific merit, offering you authentic, effective skincare solutions."
- S1: "Efficacy / Formulations developed in our in-house laboratories"
- S2: "Minimalist is a high-performance skincare brand rooted in scientific research."
- S2: "Our mission is to improve skin health. Dedicated to this purpose, we make one simple promise—to provide advanced skincare backed by science."
- S2: "High-Performance / We deliver exceptional results through dedication, expertise, and a focus on quality."

Pricing / accessibility
- S1 `<title>`: "Minimalist - Honest, Authentic & Affordable Beauty Products"
- S1: "Affordable / Skincare, accessible to all"
- S1 meta description: "We believe our products should be accessible to all, but we will never compromise on quality, ensuring only the best products reach you. Our products are priced to allow you to test and play with ingredients to build your perfect skincare or haircare routine, for your ever changing needs."

Scale claim (unsubstantiated on page)
- S2: "We cater to an ever expanding community of 300 million+ customers across 5 continents and 17 countries with a mission to grow further."

Observed tension (for the rules author, not a rule): the philosophy pages reject over-claiming, yet live PDPs contain "flawless", "dramatically", "skin lightening", "Tan Removal", "heal", "ensures even tone in 5 weeks", and perception stats without sample sizes. The S0 Shopify descriptions are markedly more restrained than the live PDP theme copy.

---

## 7. Could NOT verify

1. **No dedicated "ingredient transparency" / "why we disclose concentrations" page found.** Checked homepage links, /pages/faqs (shipping/returns only), /pages/disclaimer (fraud notice only), and site search "concentration transparency" (0 page/article results). The transparency position exists only as the pillar lines in S1/S2/S3.
2. **Sample size, duration design, and who ran the "NN% subjects" consumer studies** — not stated anywhere on S5, S7, S9. Cannot verify n or methodology.
3. **"Clinically Proven" and "Recommended by Dermatologist" badges on S2** — no study, dermatologist, or link given on the page.
4. **"300 million+ customers"** (S2) — no source; not checked externally.
5. **Live-page term counts across all 80 PDPs** — only 6 PDPs were read live; §4.1 counts cover S0 `body_html` only. A full-site count would need every PDP's accordion text.
6. **Physical packaging / label naming** (whether packs print "02%" or "2%") — not checked; only web titles and handles were.
7. **Instagram / ads / app / Amazon / Nykaa copy** — out of scope; tone on paid social may differ from site copy.
8. **Whether S11's 2020 casual tone is still representative** — it is still live, but S10 suggests the current house style is clinical/figure-led. Publication date of S10 was not exposed on the page.
9. **Cause of US/UK spelling mix** (Moisturizer vs Moisturiser; aging vs ageing) — observed, not explained.
10. **minimalistinc.com** (global site linked from /pages/blogs "View more") — not read.
11. Body_html of PDP accordion sections ("What Makes It Potent?", etc.) are rendered by the theme, not in `/products.json`; their per-product source (metafields) was not inspected.
