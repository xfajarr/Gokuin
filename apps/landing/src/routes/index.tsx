import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

const EASE_EXPO = 'cubic-bezier(.16,1,.3,1)'
const EASE_SOFT = 'cubic-bezier(.22,.61,.24,1)'

const NAV_ITEMS: Array<{ label: string; chevron: boolean }> = [
  { label: 'Products', chevron: true },
  { label: 'Solutions', chevron: true },
  { label: 'Resources', chevron: true },
  { label: 'Enterprise', chevron: false },
  { label: 'Clients', chevron: false },
  { label: 'Pricing', chevron: false },
]

const TREE_ROWS: Array<{
  level: 'l1' | 'l2' | 'file'
  label: string
  chevron?: 'right' | 'down'
}> = [
  { level: 'l1', label: '.github', chevron: 'right' },
  { level: 'l1', label: '.vercel', chevron: 'right' },
  { level: 'l1', label: '.node_modules', chevron: 'right' },
  { level: 'l1', label: '.src', chevron: 'down' },
  { level: 'l2', label: '.snippets', chevron: 'down' },
  { level: 'file', label: 'button.jsx' },
  { level: 'file', label: 'card.jsx' },
  { level: 'file', label: 'card.jsx' },
  { level: 'l1', label: '.public', chevron: 'down' },
]

// Line numbers skip 4 on purpose — matches the reference mock exactly.
const LINE_NUMBERS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

const LOGOS: Array<{ key: string; name: string; src: string }> = [
  {
    key: 'europa',
    name: 'Europa',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_121624_294abb76-9c42-4ec7-b0da-150a59ef6a08.png',
  },
  {
    key: 'eclipseful',
    name: 'Eclipseful',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_122106_32ed25ea-5ac4-4f87-9337-c99a4635cc13.png',
  },
  {
    key: 'ikigai',
    name: 'Ikigai Labs',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_122106_2df1b7c0-4987-4ba7-8fae-37b6e357232f.png',
  },
  {
    key: 'eightball',
    name: 'Eightball',
    src: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_121624_affc2cfe-bb6a-430c-93b3-691ccbfbe746.png',
  },
]

// The exact code listing from the spec, each entry rendered as one `.cl`
// line. `null` is a blank line. Hex digits inside quoted colour strings are
// wrapped in `.hx`; the rest of the string (quotes + `#`) stays `.st`.
const CODE_LINES: Array<React.ReactNode> = [
  '// CSS Syntax Highlighter UI (Design Mock)',
  null,
  <>
    <span className="kw">import</span>
    {' React from '}
    <span className="st">"react"</span>
    {';'}
  </>,
  null,
  'export default function SyntaxUI() {',
  '  const colors = {',
  <>
    {'    arrow: '}
    <span className="st">
      {'"#'}
      <span className="hx">d9b3ff</span>
      {'"'}
    </span>
    {','}
  </>,
  <>
    {'    values: '}
    <span className="st">
      {'"#'}
      <span className="hx">8cd9ff</span>
      {'"'}
    </span>
    {','}
  </>,
  <>
    {'    integer: '}
    <span className="st">
      {'"#'}
      <span className="hx">ffb399</span>
      {'"'}
    </span>
    {','}
  </>,
  <>
    {'    text: '}
    <span className="st">
      {'"#'}
      <span className="hx">ff9966</span>
      {'"'}
    </span>
    {','}
  </>,
  <>
    {'    digit: '}
    <span className="st">
      {'"#'}
      <span className="hx">99cc99</span>
      {'"'}
    </span>
    {','}
  </>,
  <>
    {'    title: '}
    <span className="st">
      {'"#'}
      <span className="hx">80b380</span>
      {'"'}
    </span>
    {','}
  </>,
  '  };',
  null,
  '  return (',
  <>
    {'    <div style={{ fontFamily: '}
    <span className="st">"monospace"</span>
    {', padding: 20 }}>'}
  </>,
  '      <h3>CSS Highlighter</h3>',
  null,
  <>
    {'      {Object.entries(colors).map(([key, color]) '}
    <span className="lig">{'=>'}</span>
    {' ('}
  </>,
  <>
    {'        <div key={key} style={{ display: '}
    <span className="st">"flex"</span>
    {', alignItems: '}
    <span className="st">"center"</span>
    {', marginBottom: 8 }}>'}
  </>,
  '          <span style={{ width: 100 }}>{key}</span>',
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

      // 80 — brand
      play(brandRef.current, [
        { opacity: 0, transform: 'scale(.92)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { delay: 80, duration: 560, easing: EASE_SOFT })

      // 160 — nav items, +40ms each
      navRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 160 + i * 40, duration: 500 })
        play(el, kf, opts)
      })

      // 300 — actions (Sign In, Register, burger), +60ms each
      actionRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 300 + i * 60, duration: 500 })
        play(el, kf, opts)
      })

      // 420 / 540 — headline lines unmask, 950ms, 120ms apart
      headlineRefs.current.forEach((el, i) => {
        play(el, [{ transform: 'translateY(130%)' }, { transform: 'translateY(0)' }], {
          delay: 420 + i * 120,
          duration: 950,
          easing: EASE_EXPO,
        })
      })

      // 780 — subtitle
      {
        const [kf, opts] = lifted({ delay: 780, duration: 620 })
        play(subRef.current, kf, opts)
      }

      // 920 — CTAs, +70ms each
      ctaRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 920 + i * 70, duration: 520 })
        play(el, kf, opts)
      })

      // 1000 — editor rises
      play(editorRef.current, [
        { opacity: 0, transform: `translateY(${rise})` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { delay: 1000, duration: 660, easing: EASE_EXPO })

      // 1180 — chrome dots, +45ms each, 340ms
      dotRefs.current.forEach((el, i) => {
        play(el, [
          { opacity: 0, transform: 'scale(.72)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { delay: 1180 + i * 45, duration: 340, easing: EASE_SOFT })
      })

      // 1260 — File Manager / project / tab, +55ms each
      ;[eyebrowRef.current, projectRef.current, tabRef.current].forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 1260 + i * 55, duration: 420 })
        play(el, kf, opts)
      })

      // 1360 — tree rows, +38ms x --ed-detail
      treeRowRefs.current.forEach((el, i) => {
        const [kf, opts] = lifted({ delay: 1360 + i * 38 * edDetail, duration: 420 })
        play(el, kf, opts)
      })

      // 1440 — line numbers fade
      play(linenumsRef.current, [{ opacity: 0 }, { opacity: 1 }], {
        delay: 1440,
        duration: 400,
        easing: EASE_SOFT,
      })

      // 1480 — code lines, +28ms x --ed-detail
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
                For Developers Who Swear
              </span>
            </span>
            <span className="ln dim">
              <span
                className="ln-i"
                ref={(el) => {
                  headlineRefs.current[1] = el
                }}
              >
                It Wasn't Their Fault
              </span>
            </span>
          </h1>

          <p className="sub" ref={subRef}>
            Your AI-powered code space that catches the obvious, the subtle, and the "how did that even happen?"
          </p>

          <div className="cta-row">
            <a
              href="#"
              className="btn btn-solid btn-hero"
              ref={(el) => {
                ctaRefs.current[0] = el
              }}
            >
              Get Started
            </a>
            <a
              href="#"
              className="btn btn-ghost btn-hero"
              ref={(el) => {
                ctaRefs.current[1] = el
              }}
            >
              Book a Call
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
                  File Manager
                </span>
                <span className="ed-project" ref={projectRef}>
                  NEW-REACT-WEB-APP
                </span>
              </div>
              <div className="ed-head-right">
                <span className="ed-tab" ref={tabRef}>
                  card.jsx
                </span>
              </div>
            </div>

            <div className="ed-body">
              <div className="ed-tree">
                {TREE_ROWS.map((row, i) => (
                  <div
                    key={`${row.label}-${i}`}
                    className={`tree-row tree-row--${row.level}`}
                    ref={(el) => {
                      treeRowRefs.current[i] = el
                    }}
                  >
                    {row.chevron ? <TreeChevron direction={row.chevron} /> : null}
                    {row.level === 'file' ? <FileIcon /> : <FolderIcon />}
                    <span>{row.label}</span>
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
        {LOGOS.map((logo) => (
          <div className="strip-cell" data-logo={logo.key} key={logo.key}>
            <img src={logo.src} alt={logo.name} loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  )
}
