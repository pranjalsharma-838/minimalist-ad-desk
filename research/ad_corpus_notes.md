# Ad corpus notes (collected 2026-10-02)

## What was collected
`ad_corpus.json` has 33 entries, all from the **Meta Ad Library** (country = India, active ads only). Every entry was copied word for word from the rendered ad card. `source_url` is the ad's own Library link (`facebook.com/ads/library/?id=<Library ID>`). `notes` records the start date and the search page where the ad was seen.

- **18 Minimalist ads** (`is_minimalist: true`). The advertiser is checked to be the page **Minimalistinc** (page ID `107597820995682`). Its ads link to beminimalist.co and @beminimalist__, so this is not an unrelated "minimalist" brand. I pulled them straight from that page's ad list (`view_all_page_id=107597820995682`, 27 active ad cards in total).
  - 13 are written by the brand itself (launches, brand-trust videos, routine/kit ads, promos, a Zepto quick-commerce ad).
  - 5 are **creator partnership ads** ("<creator> with Minimalistinc", marked #Ad). They are in the creator's voice, not the brand's, so you may want to score them separately.
  - I left out near-duplicates and say so in `notes` (for example, the same primary text running under 3 headlines, or identical copy on several Library IDs). I also left out one Blinkit ad that had no copy.
- **15 competitor or category ads** (`is_minimalist: false`). I found them with keyword searches (mamaearth, plum goodness, dot and key, pilgrim, deconstruct, the derma co, dark spots, glow serum, acne) and kept only ads posted by the brand's own page.
  - Brands: Deconstruct (2), The Derma Co (2), Dot & Key (2), Pilgrim (2), Mamaearth, Dermatouch, Sanfe, Heaven Magic, Cureskin, Kozicare, Chemist At Play.
  - Plum turned up no active skincare ads from its own page. I skipped a Bangladesh reseller page posting as "Dot & Key Skincare".
  - One Pilgrim entry is a hair-growth serum, kept on purpose as the highest-risk claim case ("growth guaranteed").
- **On-image text**: I read it from card screenshots for 6 Minimalist ads only. Elsewhere `on_image_text` is empty, meaning it wasn't captured, not that the image has no text. Videos were not transcribed.

## What blocked me
- **No login wall.** The Ad Library loaded and searched normally without logging in, so I didn't need the Instagram, YouTube or Google fallback.
- **Shared browser.** The Playwright MCP browser was being used by another session at the same time (it moved my tab to beminimalist.co). To avoid a clash, I did the actual collection in a separate Playwright browser of my own that runs in the background without a window, and closed it after each run. I did not close the other session's tabs.
- Some ads have a short Library ID in the headline area and no headline. Where a headline isn't shown, that field is empty.

## 5 observations: Minimalist vs competitors
1. **Strengths in the product name.** Minimalist states the percentage of the active ingredient on almost every product (B12 + Oat Extract 6.5%, Kojic + Mandelic 2.5%, Vitamin C 10% / "86% pure", 5% Marula Oil, 7% Glycolic, Salicylic + LHA 02%). Deconstruct and The Derma Co do the same (2% Arbutin + 5% Niacinamide, 2% Kojic). Mass brands (Pilgrim, Mamaearth, Dot & Key, Sanfe, Heaven Magic) mostly use ingredient or fruit names with no strength given.
2. **Claim style.** Minimalist mostly explains how the product works and softens the result ("helping inhibit melanin production", "even-looking skin tone", "a little extra support", "visibly brighter"). Competitors promise outright results with timeframes:
   - "fades dark spots in 10 mins" / "visibly lighter skin INSTANTLY" (Sanfe)
   - "visible glow in just 7 days" + "No Side Effects" (Heaven Magic)
   - "fall finished, growth guaranteed" in 28 days (Pilgrim)
   - "acne-free skin" / "Rapid acne relief" (Dot & Key)
   - "kills 4X more acne-causing bacteria than neem" (Derma Co)
   - "1.6x better brightening" and "in just 4weeks" (Deconstruct)
3. **Minimalist is not claim-clean, which makes it a useful test.** Some of its own ads contain absolutes the scorer should still flag:
   - "In-vivo tested for **guaranteed** UV safety" and "**Absolutely zero** white cast" (SPF 50)
   - "clinically proven Glow Boosting Routine" and "reduces dark spots" / "Fades dark spots" (Vitamin C ads)
   - an unsourced on-image statistic, "60% of skin is water"

   The retail and routine ads (the Zepto ad, the glow kit) also slide into generic marketplace wording ("Say goodbye to oiliness, acne breakouts...", "Tired of dull, uneven skin?").
4. **Fear and problem framing.** Competitors lean on "pain point" openers: "Struggling with...", "Tired of...", "Warning ⚠️", "Dark & pigmented lips? Not anymore!", and Cureskin's "the dark spot it leaves behind can stay much longer". Minimalist's brand ads mostly open neutrally ("Meet...", "Introducing...", "Skincare with absolutely nothing to hide"). They build trust through openness ("sharing every single percentage", "formulated in-house") rather than badge lists ("No Nasties", "No Harmful Chemicals", "Cruelty-free", "Trusted by 100,000+ Women").
5. **Emojis and urgency.** Minimalist's brand-written ads are almost emoji-free; the only exception is the Zepto ad 🛡️⚡🛒. Its creator ads do use emojis. Competitors use many: Pilgrim, Dot & Key, Chemist At Play and Heaven Magic put emoji bullets on every line. Promotions differ too. Minimalist uses coupon freebies (B2G3RDFREE, a free bottle worth ₹599). Competitors use countdown-style discounts ("Biggest Flash Sale Alert! ... once it's over, it's over!", B1G1, "Get 50% off/-", "Limited stock").

## Caveats
- I can't tell which of these Minimalist ads the scorer's authors have already seen. The safest holdout set is the newest ones: Kojic + Mandelic body lotion (Sep 25, 2026), B12 cleanser (Jul 5), custom bundle (Jul 24) and Vitamin C (Jul 28).
- Ad Library card text can include text from the link area (headline, link description). I split these into fields using where each line appears on the card. Extra link lines are kept in `notes`.
