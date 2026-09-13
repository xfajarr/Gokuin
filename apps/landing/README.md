# @gokuin/landing

Gokuin's own editorial landing page, built as a standalone TanStack Start
app to the design system in
[`spec/landing-design-spec.md`](../../spec/landing-design-spec.md): the
1440px reference scale, the frame with its hairlines, both hatch bands, the
plus texture, the solid/ghost buttons with crop-mark corners, the customer
strip, the mobile drawer, and the full millisecond entrance animation
timeline. The copy and the editor mock's content are Gokuin's own, not the
spec's placeholder reference copy (see "What changed from the spec" below).

## Why this is a separate app, not a route in `apps/web`

The spec's viewport scale sets:

```css
html { font-size: clamp(0.72px, 0.069444vw, 1.30px); }
```

Every layout number on this page (`Xrem`) is meant to be read against that
tiny root font-size (1rem is about 1px at a 1440px viewport). `apps/web`
sizes its whole UI in `rem` against a normal root font-size, so dropping this
rule into that document would shrink every existing Gokuin page to
near-invisible. The two design systems also don't share a palette or a font
(cream `#efede8` plus Figtree here, warm charcoal plus IBM Plex there). They
can't coexist in one `<html>`, so this is its own app with its own root
document.

## Run it

```bash
bun install            # from the repo root, or here, it's a workspace package
bun run dev             # apps/landing, port 3010 (apps/web uses 3000)
bun run build            # client + SSR build
bun run typecheck
bun run preview          # serve the production build, port 3010
```

## Structure

- `src/routes/__root.tsx`, the document head: lang, viewport
  (`viewport-fit=cover`), theme-color, title, description, the Google Fonts
  links (Figtree + JetBrains Mono, `display=block`), and the pre-paint
  `js-anim` script.
- `src/routes/index.tsx`, the entire page (one route) plus the entrance
  animation, run once via the Web Animations API in a `useEffect`.
- `src/styles.css`, the whole stylesheet, one file, imported once by the
  root route. Kept as a single file on purpose: this is a reproduction of one
  design system and should stay checkable line by line, not spread across
  component-scoped CSS.

## What changed from the spec: content, not structure

The spec was written against a generic developer-tool reference page. This
app keeps every structural and motion detail from the spec and replaces only
the content with Gokuin's own:

- **Headline**: "Every Route Sells Protection" / "Nobody Has Ever Checked".
- **Subtitle**: "Flashbots Protect and MEV Blocker claim they stop most
  sandwich attacks. Gokuin checks that claim on-chain." (tuned to hold
  exactly two lines at desktop, see below).
- **CTAs**: solid "Read the Evidence" (`#`, no evidence page yet), ghost
  "View on GitHub" (`https://github.com/xfajarr/Gokuin`).
- **Nav**: Method, Evidence, Routes, Credibility, Docs. The first three are
  real disclosure buttons now (not decorative chevrons): click opens a
  dropdown of placeholder links, click outside or Escape closes it. There's
  no Sign In / Register in the header or the drawer; this page has no auth.
- **Brand mark**: the header/drawer brand icon is
  `public/image/gokuin-icon-nav.png` (the actual Gokuin seal), not a drawn
  SVG placeholder.
- **Editor mock**: instead of a syntax-highlighter demo, it shows the
  detector's own JSON output for Sepolia block 11693970, the block where a
  sandwich staged against our own probe was caught. Full front-run, victim,
  and back-run transaction hashes, the pool address, and the attacker
  address are rendered in full (not truncated, the mock is wide enough), and
  the `.kw` / `.st` / `.hx` classes now highlight JSON keys, string values,
  and the hex digits inside `0x...` strings respectively, the same split the
  spec used for hex colours. Two trailing comment lines report the decoded
  swap deltas (front-run +0.000600 WETH, victim +0.000200 WETH at a worse
  price, back-run -0.000593 WETH), which is real decoded data, not invented
  filler. Eyebrow, project label, and tab were changed to match: "Substreams
  Output" over "SANDWICH-DETECT@V0.1.0", tab `block-11693970.json`.
- **File tree**: the repo's own shape (`apps`, `node_modules`, `docs`
  collapsed; `substreams` expanded into `sandwich-detect` with
  `sandwich-detect.spkg` and the highlighted `block-11693970.json`;
  `contracts` expanded into `ProbeLedger.sol`). The spec's duplicate
  filename quirk (`card.jsx` twice) wasn't carried over since nothing here
  naturally duplicates without reading as a mistake; long filenames get an
  ellipsis in the fixed-width tree column instead of a hard clip.
- **Ecosystem strip**: became a "built on" strip. The reference's four
  CloudFront logos belonged to someone else's project and had no business
  implying they're Gokuin customers, so the four cells now hold a small
  line-art icon plus label for what this project is actually built on:
  Ethereum (leftmost, everything else sits on top of it), The Graph, ENS,
  Chainlink CRE, at the same `max-height` and grid/hairline discipline a
  logo row would have kept. Icons are original line art in the same visual
  language as the tree's folder/file icons (currentColor stroke, no fill),
  not borrowed brand marks.
- **Meta**: title "Gokuin: every route promises privacy, nobody has ever
  checked", description is the subtitle sentence, theme-color unchanged.

## Two more sections, below the hero

The hero (`.frame`) is still exactly the one-screen sheet the spec
describes, untouched. Two more sections were added below it, as siblings
outside `.frame`, so the page now scrolls past the hero instead of being a
single screen. Both reuse the existing tokens (palette, hairlines, Figtree,
no gradients) rather than introducing a second design language:

- **`.flow` ("Anatomy Of A Sandwich")**: a three-node diagram (front-run,
  victim/our probe, back-run) for the same block 11693970 evidence, with a
  connecting line and three small beams that continuously travel left to
  right (`@keyframes flow-move`, CSS only, staggered, infinite) to visualize
  the transaction order inside the block. This is the "flow/beam"
  visualization; it is a deliberate, always-on decorative loop, not part of
  the one-shot hero entrance, and it is governed by the same
  `prefers-reduced-motion` rule as everything else (near-zero duration, one
  iteration).
- **`.method` ("Built To Be Checked, Not Trusted")**: a 2x2 card grid
  (commit-before-probe, every row carries its hash, one authorized ENS
  writer, "we don't sell routing"), laid out with the black-background/
  hairline-gutter grid trick, adapted from the reference "Code Quality,
  Features" grid pattern. Copy is grounded in what the contracts and tests
  actually enforce (see `spec/decisions.md` and `spec/agent-briefs.md`), not
  generic feature-card filler.

Both sections play a one-shot reveal (opacity/translateY via CSS
transition, staggered per child with a `--i` custom property) the first
time they scroll into view, via `IntersectionObserver` (`threshold: 0.2`,
disconnects after firing once per element). This is separate from the
hero's load-time WAAPI timeline on purpose: these sections are below the
fold, so animating them at page-load time would mean animating something
the visitor can't see yet. Reduced-motion visitors get the `is-revealed`
state immediately, no observer.

## A structural fix the new copy forced

The headline ("Every Route Sells Protection", kept to the same character
count through a later copy revision) measures about 6 to 8% wider per
character than the spec's original reference headline. At the two mobile
`h1` clamps
(`<=1040px` and `<=470px`) that was enough to break the spec's "exactly two
lines" requirement across nearly the whole mobile range (checked at 300 to
1040px), not just at one narrow edge case. Rather than hand-picking new
clamp numbers, both mobile clamps are scaled by one documented constant,
`--h1-fit: 0.9` in `src/styles.css`, applied to the floor, the preferred
value, and the ceiling alike, so the 470px seam between the two clamps still
lines up exactly as before. The `>=1040px` base size (48rem) needed no
change: it scales proportionally with the viewport up there and already had
comfortable margin at every width tested.

## The pre-paint script

The spec requires the `js-anim` class to land on `<html>` before first paint
so the CSS entrance pre-states (headline lines pushed down, nav/actions/sub/
editor invisible, etc.) are already in place when the page first becomes
visible, otherwise there'd be a flash of the final state before the
animation started.

This is a raw, synchronous `<script>` written directly in `__root.tsx`'s
`<head>`, not a React effect:

```js
(function(){try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('js-anim');}}catch(e){}})();
```

Verified with `curl http://localhost:3010/`: it's present verbatim in the
server-rendered HTML `<head>`, before `<body>`. Being a classic (non-async,
non-deferred) inline script inside `<head>`, the browser executes it while
still parsing `<head>` and before it ever reaches `<body>`'s content, so it
is genuinely pre-paint. One caveat worth naming: React 19's automatic
hoisting of `<title>`/`<meta>`/`<link>` tags can reorder this script to
after those tags in the emitted HTML, but nothing before it is paintable, so
the guarantee holds regardless of that reordering.

## Entrance animation

Implemented with `element.animate()` (Web Animations API) in a `useEffect`
on the index route, timed to the millisecond list in the spec (brand at
80ms, nav items staggered from 160ms, headline unmask at 420/540ms, editor
rise at 1000ms, and on through the editor chrome, tree, line numbers, and
code lines), reading `--lift` / `--rise` / `--ed-detail` from computed style
so it adapts to the active breakpoint. It waits for `document.fonts.ready`
(1200ms timeout fallback) then one `requestAnimationFrame` before starting,
per spec. This did not change when the content changed; the timeline is
content-agnostic, it just animates whatever elements are mounted.

The guard against running the timeline twice lives on the *timeline itself*
(a `hasStarted` ref checked inside `run()`), not on the effect. That matters
because React's dev-mode mount, cleanup, mount double-invoke would otherwise
let the *first* invocation's cleanup cancel the only scheduled run while the
*second* invocation never gets to schedule one; the on-effect guard was
tried first and reproduced exactly that bug (the page stuck fully
invisible). Guarding inside `run()` instead means whichever invocation's
promise chain survives (isn't cancelled) is the one that actually builds the
animations, so the sequence always plays exactly once.

When every animation's `.finished` promise settles, each touched element is
snapped to its resting inline style (opacity 1, no transform), then every
`Animation` is `.cancel()`ed, `js-anim` is removed from `<html>`, and the
inline styles are removed again, so nothing keeps running and no CSS
pre-state can re-hide anything afterward.

## Other implementation notes / judgment calls

The spec is precise about tokens and numbers but leaves a handful of things
unspecified; these were filled in reasonably rather than invented from
nothing:

- **Crop-mark corners**: implemented with the preferred technique, one
  bordered ghost-button box (`::before`, `--rule` colored) masked by two
  orthogonal `linear-gradient` masks with `mask-composite: intersect` /
  `-webkit-mask-composite: source-in`, so all eight corner arms come from
  the same geometry and are guaranteed identical. Verified visually at 4x
  zoom: all four corners render matching L-shaped brackets.
- **Animation durations not given explicitly** (actions, CTAs, chrome-dot
  group items, tree rows, line numbers, code lines) use consistent
  400 to 520ms durations in the spec's "soft" easing; only the values the
  spec states outright (560, 620, 660, 950, 340ms) are exact.
- Icon shapes (folder, file, tree chevrons, nav chevron, brand mark) are
  built as inline SVG to the stated geometry (viewBoxes, stroke widths,
  colors) since the spec describes them by shape/color rather than by exact
  path data.

Everything else, the palette, the `rem` scale formula, section heights, the
editor's `--e` container-query unit system, and the breakpoint list, is
reproduced as specified, not reinterpreted.

## The brand icon in `apps/web` too

`public/image/gokuin-icon-nav.png` is also copied into `apps/web/public/image/`
and used in that app's `.brand` (replacing the old "極印" text mark). That
icon is drawn in black ink, which disappears against `apps/web`'s dark theme
(its default, since it follows `prefers-color-scheme`), so `apps/web/src/
styles.css` adds an `--icon-filter` token (`none` in the light palette,
`invert(1)` in dark, defined in the same three places the other theme tokens
already are) applied to `.brand-icon` via `filter: var(--icon-filter)`.
Verified in a real browser in both the default (dark) and toggled (light)
themes.

## Verification performed

- `bun run build` (client + SSR) and `bun run typecheck`, both clean, for
  `apps/landing`; `bun run verify` from the repo root stays green (it now
  also runs `@gokuin/landing typecheck` and `@gokuin/landing build`).
- `bun run dev` and checked in a real browser (via CDP) at 1440, 800, and
  ~350 to 380px:
  - Frame, both hatch bands, and the two-line headline and two-line
    subtitle render correctly (measured natural-vs-available text width
    directly in the browser across 300 to 1040px, no wrap anywhere in that
    range for either).
  - The editor mock is anchored to the bottom of the stage and clipped by
    the hero at wide viewports, and shows the real Sepolia block 11693970
    detector output, file tree, eyebrow/project/tab labels.
  - The nav dropdowns (Method/Evidence/Routes) open on click, close on
    outside click and on Escape, and rotate their chevron; verified via
    `aria-expanded` and the rendered menu, not just visually.
  - The four "built on" cells (icon + label) lay out in the 4-column strip
    (and 2x2 at <=780px) with the same hairlines a logo row would have had.
  - The <=1040px architecture switch (hidden nav, burger, 42px buttons, 48px
    hero CTAs) still holds with the header actions reduced to just the
    burger.
  - Burger to close (X) toggle, Escape-to-close, and drawer-link-click also
    closing the drawer all verified.
  - The `.flow` and `.method` sections reveal correctly on scroll into view
    (confirmed via real `scroll`, not just a full-page screenshot, which
    doesn't fire the intersection the way an actual scroll does) and read
    correctly stacked on mobile.
  - The entrance timeline runs exactly once end to end, then fully clears
    (`js-anim` removed, no lingering `Animation` objects, no inline styles
    left behind).
  - The "View on GitHub" ghost CTA's `href` verified to point at
    `https://github.com/xfajarr/Gokuin`.
