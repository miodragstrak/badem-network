# BADEM Visual System

## Landing Audit

The existing `apps/landing/src/style.css` and `ProductionWalkthrough.css` are the
visual source of truth. This alignment changes presentation, not layout grids,
copy, API configuration, discovery scoring or proof/anchor behavior.

| Role | Extracted Value | Existing Use |
| --- | --- | --- |
| Page canvas | `#f8f8f1` | Landing page background |
| Light surface | `#fffef9` | Proof section and technical disclosures |
| Primary ink / green | `#172e27` | Body text, primary buttons |
| Muted text | `#64716a` | Supporting copy |
| Soft green surface | `#eaf0df` | Workflow band and selected walkthrough steps |
| Dark technical surface | `#142a24` | Node and network sections |
| Text on dark | `#e7eedf` | Node panel |
| Muted text on dark | `#b7c4ac` | Node labels |
| Lime highlight | `#d8ef8d` | Node accent |
| Olive text / focus | `#4b6830` | Walkthrough verification markers |
| Structural border | `#dce0d5` | Section dividers and light cards |
| Control border | `#71856c` | Existing secondary heading color, reused for legible input boundaries |
| Body font | DM Sans, sans-serif | Landing text/navigation |
| Heading font | Manrope, sans-serif | Landing headings |
| Width | `1240px` | Landing content maximum |
| Radius | `4px` / `5px` / `8px` | Buttons / image frames / cards |
| Spacing | `8px`, `12px`, `16px`, `24px`, `32px` | Existing controls, cards and dividers |
| Primary button | Dark green, white text, 14px / 600 | Landing primary CTA |
| Secondary button | Transparent, thin border, dark text | Landing navigation CTA |
| Badge | Muted green, outlined, restrained type | Prototype pill and simulation label |
| Logo | Original three-layer PNG | Header: 220px desktop, 170px mobile; footer: 240px |

The existing landing's negative tracking and viewport-scaled hero headings are
not extended to compact app surfaces. App type keeps zero letter spacing and
its current responsive sizes; only the font family and restrained weights align.
The landing's layout, hero composition, gallery and walkthrough remain intact.
At 380px and narrower, its hero uses a fixed 36px heading and a shrinkable
single-column track: the pre-existing long heading otherwise forced overflow
at 320px. No sections or layout breakpoints are reorganized.

## Shared Layer

`apps/shared/brand.css` centralizes the existing font import and namespaced
`--badem-*` color, typography, width and radius tokens. Each app retains its
existing selectors and local aliases; this is not a component/CSS rewrite.
Dark technical surfaces locally override foreground and border aliases so hashes,
timestamps, status text and controls remain readable.

Olive `#4b6830` is used instead of lighter decorative olive for small app text.
Muted text `#64716a` on the canvas has approximately 4.79:1 contrast; primary
ink has 13.52:1. Control boundaries use the existing `#71856c` color (3.73:1 on
the canvas). Dark panels use the landing's light text and lime focus outline.
The existing app's salmon error hue is retained as a soft surface/border and
darkened to `#8a382b` for readable error text; this is a semantic error color,
not a new brand palette.

The original logo is copied unchanged into `apps/web/public/brand/` so both
independently built apps have the same `/brand/badem-three-layer-lockup.png`.
Do not crop, recolor or strip its original background. Apps retain their existing
brand tagline; their navigation remains functional rather than copying landing
navigation.

Both Vite projects import the CSS from outside their application root. Builds
must retain `apps/shared/`. For separate Vercel projects rooted at `apps/landing`
or `apps/web`, enable **Include source files outside of the Root Directory in
the Build Step**. No hosting settings or deployment are changed by this pass.
See the [Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq)
for the shared-source setting.

## Intentionally Dark

- The proof receipt, including its hashes and Explorer action.
- The active anchored-on-Solana progression step.
- Existing landing Node/network panels and console header.

The discovery wizard and profile remain predominantly light. Public-data labels
use quiet olive/green treatment, not warning/error styling. Fit scores,
confidence, ranking, disclaimer text and all receipt values remain unchanged.
