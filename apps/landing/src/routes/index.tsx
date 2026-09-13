import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

const EASE_EXPO = 'cubic-bezier(.16,1,.3,1)'
const EASE_SOFT = 'cubic-bezier(.22,.61,.24,1)'

const NAV_ITEMS: Array<{ label: string; chevron: boolean }> = [
  { label: 'Method', chevron: true },
  { label: 'Evidence', chevron: true },
  { label: 'Routes', chevron: true },
  { label: 'Credibility', chevron: false },
  { label: 'Docs', chevron: false },
]

const TREE_ROWS: Array<{
  level: 'l1' | 'l2' | 'file'
  label: string
  chevron?: 'right' | 'down'
  active?: boolean
}> = [
  { level: 'l1', label: 'apps', chevron: 'right' },
  { level: 'l1', label: 'node_modules', chevron: 'right' },
  { level: 'l1', label: 'docs', chevron: 'right' },
  { level: 'l1', label: 'substreams', chevron: 'down' },
  { level: 'l2', label: 'sandwich-detect', chevron: 'down' },
  { level: 'file', label: 'sandwich-detect.spkg' },
  { level: 'file', label: 'block-11693970.json', active: true },
  { level: 'l1', label: 'contracts', chevron: 'down' },
  { level: 'file', label: 'ProbeLedger.sol' },
]

// Line numbers skip 4 on purpose, matches the reference mock's own quirk.
const LINE_NUMBERS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

// What Gokuin is actually built on, not customer logos, so these are set as
// plain wordmarks rather than borrowed images.
const BUILT_ON: Array<{ key: string; label: string }> = [
  { key: 'thegraph', label: 'The Graph' },
  { key: 'ens', label: 'ENS' },
  { key: 'chainlink', label: 'Chainlink CRE' },
  { key: 'foundry', label: 'Foundry' },
]

// This is the detector's own output, not invented copy: block 11693970 on
// Sepolia, a sandwich staged against our own probe. `.kw` marks JSON keys,
// `.st` marks string values, `.hx` marks the hex digits inside a 0x string
// (the quotes and the `0x` itself stay `.st`, same split the spec used for
// hex colours).
const hexString = (hex: string) => (
  <span className="st">
    {'"0x'}
    <span className="hx">{hex}</span>
    {'"'}
  </span>
)

const CODE_LINES: Array<React.ReactNode> = [
  '// map_sandwiches output, Sepolia block 11693970',
  null,
  '{',
  <>
    {'  '}
    <span className="kw">"@module"</span>
    {': '}
    <span className="st">"map_sandwiches"</span>
    {','}
  </>,
  <>
    {'  '}
    <span className="kw">"@block"</span>
    {': 11693970,'}
  </>,
  null,
  '  "items": [',
  '    {',
  <>
    {'      '}
    <span className="kw">"victimTxHash"</span>
    {': '}
    {hexString('f6833083c21d1a6335e6e63b95364e72afa4f8e9bfb1cb34c3c0d71d895c1d4f')}
    {','}
  </>,
  <>
    {'      '}
    <span className="kw">"pool"</span>
    {': '}
    {hexString('3289680dD4d6C10bb19b899729cda5eEF58AEfF1')}
    {','}
  </>,
  <>
    {'      '}
    <span className="kw">"attacker"</span>
    {': '}
    {hexString('73261B963E7aaF044283fD6BbC826315e9451631')}
    {','}
  </>,
  <>
    {'      '}
    <span className="kw">"frontrunIndex"</span>
    {': 1,'}
  </>,
  <>
    {'      '}
    <span className="kw">"victimIndex"</span>
    {': 2,'}
  </>,
  <>
    {'      '}
    <span className="kw">"backrunIndex"</span>
    {': 7'}
  </>,
  '    }',
  '  ]',
  '}',
  null,
  '// frontrun +0.000600 WETH for -16.72 USDC',
  '// victim   +0.000200 WETH for -5.57 USDC (worse price)',
  '// backrun  -0.000593 WETH for +16.55 USDC',
]

function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="18.5" stroke="#1a1a17" strokeWidth="1.9" />
      <ellipse
        cx="20"
        cy="20"
        rx="9.4"
        ry="18.1"
        stroke="#1a1a17"
        strokeWidth="1.9"
        transform="rotate(-40 20 20)"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="9.4"
        ry="18.1"
        stroke="#1a1a17"
        strokeWidth="1.9"
        transform="rotate(40 20 20)"
      />
    </svg>
  )
}

function NavChevron() {
  return (
    <svg viewBox="0 0 10 6" width="9" height="6" fill="none" aria-hidden="true">
      <path d="M1 1.2 5 4.9 9 1.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TreeChevron({ direction }: { direction: 'right' | 'down' }) {
  const d = direction === 'right' ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'
  return (
    <svg viewBox="0 0 24 24" className="tree-chev" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="tree-folder" fill="none" aria-hidden="true">
      <path
        d="M3 5.5A1.5 1.5 0 0 1 4.5 4h4.4l1.8 2H19.5A1.5 1.5 0 0 1 21 7.5v11A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-13Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="tree-file" fill="none" aria-hidden="true">
      <path
        d="M6.5 3h7l4.5 4.5V20a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
      <path d="M13.5 3v4.5H18" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" />
    </svg>
  )
}

function Home() {
  // Guards the timeline itself (not the effect) so that React's dev-mode
  // mount -> cleanup -> mount double-invoke can never build it twice: each
  // effect invocation owns its own `cancelled` flag, and whichever one
  // actually reaches `run()` uncancelled is the one that flips this.
  const hasStarted = useRef(false)

  const brandRef = useRef<HTMLAnchorElement | null>(null)
  const navRefs = useRef<Array<HTMLElement | null>>([])
  const actionRefs = useRef<Array<HTMLElement | null>>([])
  const headlineRefs = useRef<Array<HTMLElement | null>>([])
  const subRef = useRef<HTMLParagraphElement | null>(null)
  const ctaRefs = useRef<Array<HTMLElement | null>>([])
  const editorRef = useRef<HTMLDivElement | null>(null)
  const dotRefs = useRef<Array<HTMLElement | null>>([])
  const eyebrowRef = useRef<HTMLElement | null>(null)
  const projectRef = useRef<HTMLElement | null>(null)
  const tabRef = useRef<HTMLElement | null>(null)
  const treeRowRefs = useRef<Array<HTMLElement | null>>([])
  const linenumsRef = useRef<HTMLDivElement | null>(null)
  const codeLineRefs = useRef<Array<HTMLElement | null>>([])

  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  useEffect(() => {
    const root = document.documentElement
    if (!root.classList.contains('js-anim')) return

    let cancelled = false

    const run = () => {
      if (cancelled || hasStarted.current) return
      hasStarted.current = true

      const cs = getComputedStyle(root)
      const lift = cs.getPropertyValue('--lift').trim() || '10px'
      const rise = cs.getPropertyValue('--rise').trim() || '22px'
      const edDetailRaw = parseFloat(cs.getPropertyValue('--ed-detail'))
      const edDetail = Number.isFinite(edDetailRaw) ? edDetailRaw : 1

      const anims: Animation[] = []
      const touched = new Set<HTMLElement>()

      const play = (
        el: HTMLElement | null | undefined,
        keyframes: Keyframe[],
        opts: { delay: number; duration: number; easing: string },
      ) => {
        if (!el) return
        const a = el.animate(keyframes, { ...opts, fill: 'forwards' })
        anims.push(a)
        touched.add(el)
      }

      const lifted = (elOpts: {
        delay: number
        duration: number
      }): [Keyframe[], { delay: number; duration: number; easing: string }] => [
        [{ opacity: 0, transform: `translateY(${lift})` }, { opacity: 1, transform: 'translateY(0)' }],
        { ...elOpts, easing: EASE_SOFT },
      ]

      // 80, brand
      play(brandRef.current, [
        { opacity: 0, transform: 'scale(.92)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { delay: 80, duration: 560, easing: EASE_SOFT })

      // 160, nav items, +40ms each
      navRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 160 + i * 40, duration: 500 })
        play(el, kf, opts)
      })

      // 300, actions (Sign In, Register, burger), +60ms each
      actionRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 300 + i * 60, duration: 500 })
        play(el, kf, opts)
      })

      // 420 / 540, headline lines unmask, 950ms, 120ms apart
      headlineRefs.current.forEach((el, i) => {
        play(el, [{ transform: 'translateY(130%)' }, { transform: 'translateY(0)' }], {
          delay: 420 + i * 120,
          duration: 950,
          easing: EASE_EXPO,
        })
      })

      // 780, subtitle
      {
        const [kf, opts] = lifted({ delay: 780, duration: 620 })
        play(subRef.current, kf, opts)
      }

      // 920. CTAs, +70ms each
      ctaRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 920 + i * 70, duration: 520 })
        play(el, kf, opts)
      })

      // 1000, editor rises
      play(editorRef.current, [
        { opacity: 0, transform: `translateY(${rise})` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: 1000, duration: 660, easing: EASE_EXPO })

      // 1180, chrome dots, +45ms each, 340ms
      dotRefs.current.forEach((el, i) => {
        play(el, [
          { opacity: 0, transform: 'scale(.72)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { delay: 1180 + i * 45, duration: 340, easing: EASE_SOFT })
      })

      // 1260. File Manager / project / tab, +55ms each
      ;[eyebrowRef.current, projectRef.current, tabRef.current].forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 1260 + i * 55, duration: 420 })
        play(el, kf, opts)
      })

      // 1360, tree rows, +38ms x --ed-detail
      treeRowRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 1360 + i * 38 * edDetail, duration: 420 })
        play(el, kf, opts)
      })

      // 1440, line numbers fade
      play(linenumsRef.current, [{ opacity: 0 }, { opacity: 1 }], {
        delay: 1440,
        duration: 400,
        easing: EASE_SOFT,
      })

      // 1480, code lines, +28ms x --ed-detail
      codeLineRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 1480 + i * 28 * edDetail, duration: 360 })
        play(el, kf, opts)
      })

      Promise.all(anims.map((a) => a.finished.catch(() => a)))
        .then(() => {
          if (cancelled) return
          // Flash to the resting state directly (not via the WAAPI effect),
          // then cancel every animation and drop `js-anim` so nothing is
          // left running and no CSS pre-state can re-hide anything.
          touched.forEach((el) => {
            el.style.opacity = '1'
            el.style.transform = 'none'
          })
          anims.forEach((a) => a.cancel())
          root.classList.remove('js-anim')
          touched.forEach((el) => {
            el.style.removeProperty('opacity')
            el.style.removeProperty('transform')
          })
        })
        .catch(() => {})
    }

    Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]).then(() => {
      requestAnimationFrame(run)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="frame">
      <header className="header">
        <a href="#" className="brand" aria-label="Home" ref={brandRef}>
          <BrandMark />
        </a>

        <nav className="nav">
          {NAV_ITEMS.map((item, i) => (
            <a
              key={item.label}
              href="#"
              className="navlink"
              ref={(el) => {
                navRefs.current[i] = el
              }}
            >
              {item.label}
              {item.chevron ? <NavChevron /> : null}
            </a>
          ))}
        </nav>

        <div className="actions">
          <a
            href="#"
            className="btn btn-ghost header-signin"
            ref={(el) => {
              actionRefs.current[0] = el
            }}
          >
            Sign In
          </a>
          <a
            href="#"
            className="btn btn-solid"
            ref={(el) => {
              actionRefs.current[1] = el
            }}
          >
            Register
          </a>
          <button
            type="button"
            className="burger"
            aria-label="Menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            ref={(el) => {
              actionRefs.current[2] = el
            }}
          >
            <span className="burger-bar" />
          </button>
        </div>

        <div className={`drawer${drawerOpen ? ' is-open' : ''}`}>
          {NAV_ITEMS.map((item) => (
            <a key={item.label} href="#">
              {item.label}
            </a>
          ))}
          <a href="#" className="btn btn-ghost drawer-cta">
            Sign In
          </a>
        </div>
      </header>

      <div className="hatch" />

      <section className="hero">
        <div className="lead" />

        <div className="copy">
          <h1>
            <span className="ln">
              <span
                className="ln-i"
                ref={(el) => {
                  headlineRefs.current[0] = el
                }}
              >
                Every Route Promises Privacy
              </span>
            </span>
            <span className="ln dim">
              <span
                className="ln-i"
                ref={(el) => {
                  headlineRefs.current[1] = el
                }}
              >
                Nobody Has Ever Checked
              </span>
            </span>
          </h1>

          <p className="sub" ref={subRef}>
            Flashbots Protect and MEV Blocker both advertise that they stop around 80% of sandwich attacks. Both of
            those numbers were measured by the company that published them.
          </p>

          <div className="cta-row">
            <a
              href="#"
              className="btn btn-solid btn-hero"
              ref={(el) => {
                ctaRefs.current[0] = el
              }}
            >
              Read the Evidence
            </a>
            <a
              href="https://github.com/xfajarr/Gokuin"
              className="btn btn-ghost btn-hero"
              ref={(el) => {
                ctaRefs.current[1] = el
              }}
            >
              View on GitHub
            </a>
          </div>
        </div>

        <div className="gutter" />

        <div className="stage">
          <div className="editor" ref={editorRef}>
            <div className="ed-chrome">
              <span
                className="ed-dot ed-dot--red"
                ref={(el) => {
                  dotRefs.current[0] = el
                }}
              />
              <span
                className="ed-dot ed-dot--yellow"
                ref={(el) => {
                  dotRefs.current[1] = el
                }}
              />
              <span
                className="ed-dot ed-dot--green"
                ref={(el) => {
                  dotRefs.current[2] = el
                }}
              />
            </div>

            <div className="ed-head">
              <div className="ed-head-left">
                <span className="ed-eyebrow" ref={eyebrowRef}>
                  Substreams Output
                </span>
                <span className="ed-project" ref={projectRef}>
                  SANDWICH-DETECT@V0.1.0
                </span>
              </div>
              <div className="ed-head-right">
                <span className="ed-tab" ref={tabRef}>
                  block-11693970.json
                </span>
              </div>
            </div>

            <div className="ed-body">
              <div className="ed-tree">
                {TREE_ROWS.map((row, i) => (
                  <div
                    key={`${row.label}-${i}`}
                    className={`tree-row tree-row--${row.level}${row.active ? ' tree-row--active' : ''}`}
                    ref={(el) => {
                      treeRowRefs.current[i] = el
                    }}
                  >
                    {row.chevron ? <TreeChevron direction={row.chevron} /> : null}
                    {row.level === 'file' ? <FileIcon /> : <FolderIcon />}
                    <span className="tree-label">{row.label}</span>
                  </div>
                ))}
              </div>

              <div className="ed-linenums" ref={linenumsRef}>
                {LINE_NUMBERS.map((n, i) => (
                  <span className="linenum" key={`${n}-${i}`}>
                    {n}
                  </span>
                ))}
              </div>

              <div className="ed-code-wrap">
                <pre className="ed-code">
                  {CODE_LINES.map((line, i) => (
                    <div
                      className="cl"
                      key={i}
                      ref={(el) => {
                        codeLineRefs.current[i] = el
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="hatch" />

      <div className="strip">
        {BUILT_ON.map((tech) => (
          <div className="strip-cell" data-tech={tech.key} key={tech.key}>
            <span className="strip-word">{tech.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
