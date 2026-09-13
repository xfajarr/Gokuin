# @gokuin/landing

A pixel-faithful editorial landing page, reproduced from
[`spec/landing-design-spec.md`](../../spec/landing-design-spec.md) as a
standalone TanStack Start app.

## Why this is a separate app, not a route in `apps/web`

The spec's viewport scale sets:

```css
html { font-size: clamp(0.72px, 0.069444vw, 1.30px); }
```

Every layout number on this page (`Xrem`) is meant to be read against that
tiny root font-size (1rem ≈ 1px at a 1440px viewport). `apps/web` sizes its
whole UI in `rem` against a normal root font-size, so dropping this rule into
that document would shrink every existing Gokuin page to near-invisible. The
two design systems also don't share a palette or a font (cream `#efede8` +
Figtree here, warm charcoal + IBM Plex there). They can't coexist in one
`<html>`, so this is its own app with its own root document.

## Run it

```bash
bun install          # from the repo root, or here — it's a workspace package
bun run dev           # apps/landing, port 3010 (apps/web uses 3000)
bun run build          # client + SSR build
bun run typecheck
bun run preview        # serve the production build, port 3010
```

## Structure

- `src/routes/__root.tsx` — the document head: lang, viewport
  (`viewport-fit=cover`), theme-color, title, description, the Google Fonts
  links (Figtree + JetBrains Mono, `display=block`), and the pre-paint
  `js-anim` script.
- `src/routes/index.tsx` — the entire page (one route) plus the entrance
  animation, run once via the Web Animations API in a `useEffect`.
- `src/styles.css` — the whole stylesheet, one file, imported once by the
  root route. Kept as a single file on purpose: this is a reproduction of one
  design and should stay checkable line-by-line against the spec, not spread
  across component-scoped CSS.

## The pre-paint script

The spec requires the `js-anim` class to land on `<html>` before first paint
so the CSS entrance pre-states (headline lines pushed down, nav/actions/sub/
editor invisible, etc.) are already in place when the page first becomes
visible — otherwise there'd be a flash of the final state before the
animation started.

This is a raw, synchronous `<script>` written directly in `__root.tsx`'s
`<head>`, not a React effect:

```js
(function(){try{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('js-anim');}}catch(e){}})();
```

Verified with `curl http://localhost:3010/` — it's present verbatim in the
server-rendered HTML `<head>`, before `<body>`. Being a classic (non-async,
non-deferred) inline script inside `<head>`, the browser executes it while
still parsing `<head>` and before it ever reaches `<body>`'s content, so it
is genuinely pre-paint. (One caveat worth naming: React 19's automatic
hoisting of `<title>`/`<meta>`/`<link>` tags can reorder this script to after
those tags in the emitted HTML — but nothing before it is paintable, so the
guarantee holds regardless of that reordering.)

## Entrance animation

Implemented with `element.animate()` (Web Animations API) in a `useEffect`
on the index route, timed to the millisecond list in the spec (brand at
80ms, nav items staggered from 160ms, headline unmask at 420/540ms, editor
rise at 1000ms, etc.), reading `--lift`/`--rise`/`--ed-detail` from computed
style so it adapts to the active breakpoint. It waits for `document.fonts.
ready` (1200ms timeout fallback) then one `requestAnimationFrame` before
starting, per spec.

The guard against running the timeline twice lives on the *timeline itself*
(a `hasStarted` ref checked inside `run()`), not on the effect. That matters
because React's dev-mode mount → cleanup → mount double-invoke would
otherwise let the *first* invocation's cleanup cancel the only scheduled run
while the *second* invocation never gets to schedule one — the on-effect
guard was tried first and reproduced exactly that bug (page stuck fully
invisible). Guarding inside `run()` instead means whichever invocation's
promise chain survives (isn't cancelled) is the one that actually builds the
animations, so the sequence always plays exactly once.

When every animation's `.finished` promise settles, each touched element is
snapped to its resting inline style (opacity 1, no transform), then every
`Animation` is `.cancel()`ed, `js-anim` is removed from `<html>`, and the
inline styles are removed again — so nothing keeps running and no CSS
pre-state can re-hide anything afterward.

## Implementation notes / where judgment calls were made

The spec is precise about tokens and numbers but leaves a handful of things
unspecified; these were filled in reasonably rather than invented from
nothing:

- **Crop-mark corners**: implemented with the preferred technique — one
  bordered ghost-button box (`::before`, `--rule` colored) masked by two
  orthogonal `linear-gradient` masks with `mask-composite: intersect` /
  `-webkit-mask-composite: source-in`, so all eight corner arms come from
  the same geometry and are guaranteed identical. Verified visually at 4x
  zoom — all four corners render matching L-shaped brackets.
- **Animation durations not given explicitly** (actions, CTAs, chrome-dot
  group items, tree rows, line numbers, code lines) use consistent
  400–520ms durations in the spec's "soft" easing; only the values the spec
  states outright (560, 620, 660, 950, 340ms) are exact.
- **File tree ordering**: `.github`, `.vercel`, `.node_modules` (collapsed),
  `.src` (expanded) → `.snippets` (expanded) → `button.jsx`, `card.jsx`,
  `card.jsx` (files, duplicate name — deliberate per spec), then `.public`.
  This is the only ordering consistent with the row counts and duplicate the
  spec calls out.
- Icon shapes (folder, file, tree chevrons, nav chevron, brand mark) are
  built as inline SVG to the stated geometry (viewBoxes, stroke widths,
  colors) since the spec describes them by shape/color rather than by exact
  path data.

Everything else — palette, the `rem` scale formula, section heights, the
editor's `--e` container-query unit system, the exact code listing (hex
digits wrapped in `.hx`, line numbers skipping 4), the four CloudFront logo
URLs, and the breakpoint list — is reproduced as specified, not
reinterpreted.

## Verification performed

- `bun run build` — client + SSR, clean.
- `bun run typecheck` — clean.
- `bun run dev` and checked in a real browser (via CDP) at 1440, 800, and
  ~350–380px:
  - Frame, both hatch bands, and the two-line headline render correctly.
  - The editor mock is anchored to the bottom of the stage and clipped by
    the hero at wide viewports (chrome/head scroll out of view above the
    fold, as the aspect-ratio math implies).
  - All four CloudFront logos load and lay out in the 4-column strip (and
    2×2 at ≤780px).
  - The ≤1040px architecture switch (hidden nav, burger, 42px buttons, 48px
    hero CTAs) and the ≤360px header-Sign-In-hidden / drawer-cta-shown
    behavior both verified live.
  - Burger ⇄ close (X) toggle and Escape-to-close both verified.
  - The entrance timeline runs exactly once end-to-end, then fully clears
    (`js-anim` removed, no lingering `Animation` objects, no inline styles
    left behind).
- `bun run verify` from the repo root stays green (this app isn't wired into
  `verify:build`, so it doesn't add to that pipeline, but nothing it does
  broke the existing one).
