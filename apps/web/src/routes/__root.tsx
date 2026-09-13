import { HeadContent, Link, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'

import appCss from '../styles.css?url'

const SECTION_LABEL: Record<string, string> = {
  route: 'route',
  probe: 'probe',
  cycle: 'cycle',
  method: 'method',
  console: 'console',
}

/** Turns the current pathname into a plain-English trail, e.g. "/probe/1042"
 * -> "scoreboard / probe / 1042": so a reader landing on a deep link (a
 * probe, a route, a cycle) can tell where they are without knowing the nav. */
function useBreadcrumb() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return 'scoreboard'
  const trail = segments.map((seg, i) => (i === 0 ? (SECTION_LABEL[seg] ?? seg) : seg))
  return ['scoreboard', ...trail].join(' / ')
}

const THEME_INIT = `
(function () {
  try {
    var t = localStorage.getItem('gokuin-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        name: 'description',
        content: 'Gokuin, measured records for Ethereum transaction routes, published as evidence.',
      },
      { title: 'Gokuin: 極印' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function ThemeToggle() {
  return (
    <button
      type="button"
      className="theme-toggle"
      suppressHydrationWarning
      onClick={() => {
        const root = document.documentElement
        const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
        const next = current === 'light' ? 'dark' : 'light'
        root.setAttribute('data-theme', next)
        try {
          localStorage.setItem('gokuin-theme', next)
        } catch {
          // storage disabled, theme just won't persist across visits
        }
      }}
    >
      theme
    </button>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const breadcrumb = useBreadcrumb()
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <div className="shell">
          <header className="topnav">
            <div className="topnav-inner">
              <Link to="/" className="brand">
                <img src="/image/gokuin-icon-nav.png" alt="" className="brand-icon" />
                gokuin
              </Link>
              <nav className="navlinks">
                <Link to="/">scoreboard</Link>
                <Link to="/method">method</Link>
                <Link to="/console">console</Link>
              </nav>
              <span className="here mono" suppressHydrationWarning>
                {breadcrumb}
              </span>
              <ThemeToggle />
            </div>
          </header>
          <div className="hatch" aria-hidden="true" />
          {children}
          <footer className="footer">
            Rows are the truth, the score is a convenience. Every number on this site links to the hashes that
            produced it.
          </footer>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
