import { Link } from 'react-router-dom';

export default function Pager({ page, pages, q }) {
  if (pages <= 1) return null;
  const href = (p) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `?${s}` : '?';
  };
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? <Link className="btn" to={href(page - 1)}>Newer</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className="btn" to={href(page + 1)}>Older</Link> : <span />}
    </nav>
  );
}
