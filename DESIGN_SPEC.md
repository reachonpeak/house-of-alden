# House of Alden — Design Spec

Single source of truth, extracted from the client's reference screenshot (1280px viewport).
Every page MUST build against these tokens and this class contract. Do not invent new tokens.

## 0. Brand facts (verified — Udyam Registration Certificate)

| Field | Value |
|---|---|
| Legal name | House Of Alden |
| Udyam Reg. No. | UDYAM-PB-03-0079079 |
| Enterprise type | Micro (2026–27) |
| Incorporated | 01 July 2026 → **EST. 2026** |
| Address | 1560, Ward No. 5, Near Dispensary, Maur Mandi, Block Maur, Bathinda, Punjab 151509 |
| Email | mannkawalpreet3@gmail.com |
| Kawalpreet Kaur | +91 70875 11282 (also the Udyam-registered mobile → WhatsApp number) |
| Parvinder Kaur | +91 6283 531 410 |

**Reference image says "EST. 2024" — that is WRONG for this business. Use EST. 2026 everywhere.**
Sells **watches and earrings** only.

## 1. Direction

"Aged-paper heritage catalogue" — a 19th-century engraved trade catalogue rendered as a shop.
Warm cream paper, sepia ink, one gold accent, ornamental rules. Quiet everywhere.

**Signature device (exactly one):** the oversized brand shield watermark bleeding off the
hero's right edge. Everything else stays calm so it lands. Do not add a second signature.

**The logo.** `images/logo-mark.webp` is the real House of Alden mark (crown, shield, HA
monogram, diamond), keyed off the brand card onto transparency. It lives in ONE place —
the `#i-crest` symbol in each page's sprite — and every `<use href="#i-crest">` (masthead,
footer, hero watermark) picks it up. Replace that one file to change it everywhere.
It is a raster, so unlike the rest of the sprite it does **not** take `currentColor`:
the gold is the brand's own. If a vector original (.ai/.svg) ever turns up, prefer it —
swap the `<image>` inside `#i-crest` for paths and the whole system keeps working.

## 2. Tokens (defined in `css/style.css` `:root` — reference only, never redefine)

```
--paper:        #EDE4D1   page base
--paper-warm:   #EAE0CA   panel base
--paper-deep:   #DDD0B0   vignette / inset
--ink:          #3B2B1A   headings
--ink-body:     #5A4630   body copy
--ink-soft:     #7A6349   muted / captions
--bark:         #3A2A19   dark bar, buttons, footer
--bark-lift:    #6B5334   inner border on dark
--gold:         #A98A56   accent — the ONLY accent
--gold-soft:    #C4B392   hairlines, rules
--line:         #C9B896   borders
```

Spacing: 8px base. Steps 4/8/16/24/32/48/64/96.

## 3. Type

- Display: **Cormorant Garamond** (300/400/500) — wordmark, headings, prices.
- Body: **EB Garamond** (400/500, italic) — copy, nav, labels.
- Both self-hosted-optional via Google Fonts; always ship the serif fallback stack.

| Role | Size | Tracking | Case |
|---|---|---|---|
| Nav | 12px | .16em | upper |
| Wordmark "HOUSE OF" | 28px | .30em | upper |
| Wordmark "ALDEN" | 62px | .06em | upper |
| "EST. 2026" | 12px | .28em | upper |
| Hero tagline | 17px italic | .01em | sentence |
| Hero body | 15px / 1.75 | — | sentence |
| Button label | 11px | .18em | upper |
| Panel title | 13px | .20em | upper |
| Panel body | 11px / 1.7 | — | sentence |
| Panel link | 9px | .18em | upper |

Numerals: lining + tabular for all prices (`font-variant-numeric: lining-nums tabular-nums`).

## 4. Home layout (match the reference exactly)

```
┌─ .site-frame (1px --line, inset 4px from viewport) ────────────┐
│  .masthead                                                      │
│    .nav-left   HOME · ABOUT · COLLECTION      (left, y≈74)      │
│    .crest      ornate oval + A   (dead centre, y≈30–115)        │
│    .nav-right  LOOKBOOK · JOURNAL · CONTACT · cart(0)           │
│    HOME active → small gold ornament beneath                    │
│  .wordmark   HOUSE OF / ALDEN / EST. 2026 / ornament (centred)  │
│  .hero  2-col                                                   │
│    left:  house engraving  (≈320×320)                           │
│    right: tagline · ornament rule · 3-line copy · button        │
│    .hero-monogram  giant A, right bleed, opacity .05            │
│  .panels  3 × .panel, 1px vertical rules between                │
│    each: img left (≈150×215) | ornament · TITLE · copy · link   │
│    corner ornaments on each panel                               │
│  .footer  dark bar: © left | tagline+crest centre | social right│
└────────────────────────────────────────────────────────────────┘
```

Panel copy is **exactly** as in the reference:
- ABOUT US — "Our story is rooted in heritage and brought to life through thoughtful craftsmanship." → READ MORE
- COLLECTION — "Discover pieces that speak of timeless elegance and quiet luxury." → VIEW COLLECTION
- JOURNAL — "Thoughts on style, heritage, and the beauty of living with intention." → EXPLORE JOURNAL

Hero copy (reference, verbatim): "House of Alden is a celebration of timeless design, crafted with heritage, made for today. and made to be passed down."
→ Fix the broken grammar to: "House of Alden is a celebration of timeless design — crafted with heritage, made for today, and made to be passed down."

Footer: "Crafted with intention." · crest · "Worn with character." · Instagram | Pinterest | Email

## 5. Class contract (page authors use these — do not rename)

Layout: `.site-frame` `.masthead` `.nav-left` `.nav-right` `.crest` `.wordmark` `.hero`
`.hero-monogram` `.panels` `.panel` `.footer` `.page-head` `.page-body` `.rule`
Components: `.btn` `.btn--solid` `.btn--ghost` `.ornament` `.ornament--sm`
`.product-grid` `.product-card` `.filters` `.filter` `.is-active`
`.pdp` `.pdp-media` `.pdp-info` `.price` `.qty` `.cart-table` `.cart-row` `.cart-summary`
`.field` `.input` `.notice` `.toast` `.empty`

Every page: same masthead + footer markup, only the `.is-active` nav item changes.

## 6. Motion

- Easing `--ease: cubic-bezier(.22,.61,.36,1)`. Durations 180–360ms.
- Page load: masthead → wordmark → hero copy → panels, staggered 60ms, translateY(8px)+opacity.
- Animate `transform`/`opacity` only.
- `@media (prefers-reduced-motion: reduce)` → all durations 0.01ms, no transforms.

## 7. Non-negotiables

- Contrast ≥ 4.5:1 for body text. `--ink-soft` on `--paper` is the floor — never lighter.
- Visible `:focus-visible` ring (2px `--gold`, 2px offset). Never remove outlines.
  Beware specificity: a rule like `.input:focus { outline: none }` is (0,2,0) and silently
  beats the (0,1,0) `:where(...):focus-visible` ring. Restyle the border, never the outline.
- Any sprite `<svg>` styled from CSS needs **both** `width` and `height`. These `<svg>`s
  carry no `viewBox`, so a width alone leaves the height at the CSS default of 150px —
  which silently blows out rows and inflates tap targets.
- Every image has real alt text. Decorative ornaments are `aria-hidden="true"` inline SVG.
- Cart count in the masthead reflects live `localStorage` state on every page.
- Mobile: single column below 860px; nav collapses to a disclosure button.
- No emoji as icons. Inline SVG only.
- No external JS/CSS frameworks. Vanilla only.
