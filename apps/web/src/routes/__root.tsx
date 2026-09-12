import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

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
        content: 'Gokuin — measured records for Ethereum transaction routes, published as evidence.',
      },
      { title: 'Gokuin — 極印' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap',
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
          // storage disabled — theme just won't persist across visits
        }
      }}
    >
      theme
    </button>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
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
                <span className="mark">極印</span> gokuin
              </Link>
              <nav className="navlinks">
                <Link to="/">scoreboard</Link>
                <Link to="/method">method</Link>
                <Link to="/console">console</Link>
              </nav>
              <ThemeToggle />
            </div>
          </header>
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
