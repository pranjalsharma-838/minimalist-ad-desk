# Build prompt: a brand-safe ad creative pipeline

Paste this into an agentic coding assistant (built with Claude Code) in an empty folder, and fill in the `{placeholders}`. It describes the pipeline in this repo in a form you can reuse for any beauty or personal-care brand. Minimalist was the test brand.

---

## Role and goal

You are building, with me, a tool for **{BRAND}**'s performance-marketing team. It has two parts:

- **A.** A product URL in, a finished visual ad out.
- **B.** A scorer that rates **any** ad (ours, an agency's, a creator's, a competitor's) on **policy/claims**, **brand tone** and **brand language**.

Treat B as the core. The graded object is the **standard**, not the volume of output.

**Context to fill in:**
- **Brand / site:** {BRAND}, {BRAND_SITE}
- **Market and law:** {MARKET} (e.g. India: ASCI, CCPA, Drugs & Cosmetics Act/Rules, DMR Act; or US: FTC, FDA cosmetic/drug line)
- **Channels:** {CHANNELS} (e.g. Meta feed, Stories/Reels, marketplaces)
- **Product category:** {CATEGORY}
- **Competitor source:** {COMPETITOR_SOURCE} (e.g. Amazon best sellers per product type, then the Meta Ad Library for those brands)
- **Image generation:** {IMAGE_TOOL} (API key, or a browser session I log into myself; never ask me for passwords)

## Non-negotiables (decide everything else yourself, and log the decision)

1. **The expensive failure is publishing a claim that shouldn't run**, not writing a bland ad. The best verdict is "Ready for human review", never "approved".
2. **Every claim line cites a source fact:** product-page text, a dated offer/price capture, or a verbatim verified review. No invented numbers, results, reviews or offers. Missing data stays a `[placeholder]`.
3. **The product is never AI-drawn.** Image models make backgrounds only; code composites the real pack shot (or a clean cut-out with a matching shadow).
4. **Rules come from primary sources, not model opinion:**
   - law and platform policy, each item verified against primary text and tagged VERIFIED / SECONDARY / OPEN;
   - the brand's *stated* philosophy plus its *observed* copy, counted.

   Each rule has an id, a dimension (`policy` / `tone` / `language`), a severity (`block` / `fix` / `advisory`), a rationale, sources and a confidence note. Where the brand's own copy contradicts its philosophy or the law, follow the philosophy and the law. Open legal questions give *fix → legal*, never *block*.
5. **The AI judge may add findings but never remove a rule hit.** Its severity is the milder of its own view and the rulebook's, quoted spans must exist in the ad, and the verdict is computed in code.
6. **Formats are never removed, they're risk-rated:** Low / Medium / High / Severe. Severe (AI-generated people, skin or results; before/after without study photos) is composed for review only, never exportable, and carries a visible "AI-GENERATED — ILLUSTRATIVE" mark.
7. **Retry loop of at most 3 rounds:** a flagged claim is removed or replaced by another cited fact, never reworded into a near-synonym. Keep the best version that the judge has actually read.
8. **Scripts before agents:** prices, offers, reviews and competitor data come from page feeds by script. Agents do only judgement work: briefs, judging, image prompts, translation, labelling.
9. **Honesty:** report miss rates and limitations. Never present a stand-in (e.g. an agent playing the API judge) as the real thing.

## Build order (commit after every step)

**Part B: the standard**
1. `research/regulatory_sources.md`: the sources above, with verification tags and open questions.
2. `research/brand_corpus.md`: stated philosophy plus counted observations (e.g. "56 of 60 titles lead with a concentration").
3. `rules/brand_rules.json` plus a rule engine. Include computed checks:
   - stated concentrations and SPF vs the product catalog;
   - prices and discounts vs the dated offer capture;
   - creator disclosure;
   - "free" without its condition.

   Creator ads relax tone rules only, never legal ones.
4. An AI-judge prompt and validation layer, with the schema sent separately and also saved for stand-ins.
5. **Eval:**
   - a tuning set;
   - a hash-split holdout, sealed until the rules are frozen;
   - adversarial synthetic cases;
   - an **out-of-distribution** set of unseen brands and a different channel.

   Labels come from an independent agent that never sees the rules or code, and are **committed before scoring**. Report agreement, phrase recall, missed blocks and over-blocks per split.

**Part A: the generator**

6. A URL-to-facts extractor that keeps brand-authored sections only. Reviews and promo banners are excluded unless they go through the verbatim-review / dated-offer paths.
7. Copy that cites fact ids, a renderer using the real pack shot, and a pre-screen before export with a review ticket (each line → its fact).

**Optional ad-library modules (each one can be cut without touching the standard)**

8. Live data scripts: offers/prices, reviews and rating, competitor reviews → a concern map (a concern is used only where the brand's page answers it).
9. Competitor winners (ads running 30+ days) tagged to a format taxonomy, and a trend signal.
10. An archetype/format selection skill: rank every format and remove none. Brief inputs blend one element from each of 3 winners; angles are balanced across a run (situation-first, concern solved, ingredient, social proof, routine, texture, offer).
11. An image prompt director (background only, empty zones per layout, light matched to the pack shots) plus a prompt check. Then generation, compositing (1:1, 4:5, 9:16), PNG export and an ad library with a description file per ad.
12. Language versions checked by back-translation rules, a numbers lock, native risk words and a same-language disclaimer, with fluent-human sign-off.
13. An own-results ledger (spend, CTR, ROAS by format/angle/hook) feeding format ranking, and a regulatory watch.

## Agents to create

| Agent | Job | Must never |
|---|---|---|
| Brand context | Facts with ids, claims matrix, house style, channel differences | Invent a fact |
| Asset library | Label real photos; cut out pack shots | Generate or retouch the product |
| Winner tagger | Tag competitor ads to formats; flag winners | Copy wording into briefs |
| Brief writer | Cited briefs from inputs | Cite a fact that isn't in the input |
| AI judge | Implied-claim findings with exact spans | Remove a rule hit or raise severity |
| Image prompt director | Background-only prompts | Mention the product, text or brand names |
| Translator | Faithful language versions plus back-translation | Strengthen a claim or change a number |
| Independent labeller | Eval answer key | Open the rules, code or tool output |

## Deliverables

- A working app with no install step if possible.
- A commit history in small, readable steps.
- The full transcript, redacted for secrets only (keep the messy parts).
- Every prompt as a file.
- A **one-page decision doc**: the standard and how it was derived, what was cut, the decision you were least sure about, where the brief itself is questionable, and the scope ("if only one thing shipped, it would be…").
- A **failure-modes list**: three ways a well-functioning version still causes harm, what you'd do about each, and whether that happens before or after launch.

## Acceptance checks

- Tests pass. The eval reports every split, including out-of-distribution, plus the rules-only baseline.
- Every final creative is checked by eye on contact sheets. Nothing Severe is exportable.
- The transcript export contains 0 emails, passwords or keys.
- The README runs on a fresh machine.
