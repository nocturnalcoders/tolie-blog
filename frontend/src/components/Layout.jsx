import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useTheme } from '../hooks.js';

const MAIN_URL = 'https://tolie.space';
const GITHUB_URL = 'https://github.com/nocturnalcoders';
const LINKEDIN_URL = 'https://www.linkedin.com/in/christianto-lie';

export default function Layout({ children, wide = false }) {
  const [theme, toggle] = useTheme();
  const { admin } = useAuth();

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-head">
        <Link className="brand" to="/">tolie.space<small>/ notes</small></Link>
        <nav className="lanterns" aria-label="Main">
          <Link className="lantern" to="/"><i className="body"><em>~</em></i><span>Notes</span></Link>
          <a className="lantern l-teal" href={MAIN_URL}><i className="body"><em>&gt;_</em></i><span>The game</span></a>
          <a className="lantern l-coral" href={GITHUB_URL} target="_blank" rel="noopener noreferrer"><i className="body"><em>&lt;/&gt;</em></i><span>GitHub</span></a>
        </nav>
        <button
          className="theme-btn"
          type="button"
          onClick={toggle}
          aria-pressed={theme === 'day'}
          aria-label="Switch between night and daylight"
        >
          <span className="dot" aria-hidden="true" />
          <span className="lbl">{theme === 'day' ? 'Daylight' : 'Night'}</span>
        </button>
      </header>
      <main id="main" className={`wrap${wide ? ' wide' : ''}`}>{children}</main>
      <footer className="site-foot">
        <p>Made after dark. © 2026 Christianto Lie.</p>
        <p className="links">
          <a href={MAIN_URL}>The game</a>
          <a href={GITHUB_URL} rel="noopener noreferrer">GitHub</a>
          <a href={LINKEDIN_URL} rel="noopener noreferrer">LinkedIn</a>
          <a href="/feed.xml">RSS</a>
          {admin && <Link to="/admin">Admin</Link>}
        </p>
      </footer>
    </>
  );
}
