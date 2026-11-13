import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

const POPULAR = 30; // tags on the "Popular" segment
const PAGE = 60; // tags shown before "Show more"

const letterOf = (tag) => (/[a-z]/.test(tag[0]) ? tag[0].toUpperCase() : '#');
const byName = (a, b) => a.tag.localeCompare(b.tag, 'en', { numeric: true });

export default function Tags() {
  const { data, error, loading } = useApi('/api/tags');
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useDocumentTitle('All tags · tolie.space notes');

  const all = data ? data.tags : []; // most used first
  const letters = [...new Set(all.map((t) => letterOf(t.tag)))].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)));
  const wanted = params.get('letter');
  const segment = wanted && letters.includes(wanted) ? wanted : 'popular';
  const needle = filter.trim().toLowerCase().replace(/^#/, '');

  let shown;
  if (needle) shown = all.filter((t) => t.tag.includes(needle)).sort(byName);
  else if (segment === 'popular') shown = all.slice(0, POPULAR);
  else shown = all.filter((t) => letterOf(t.tag) === segment).sort(byName);

  const pick = (key) => {
    setFilter('');
    setLimit(PAGE);
    setParams(key === 'popular' ? {} : { letter: key }, { replace: true });
  };

  return (
    <Layout>
      <section className="hero">
        <div>
          <h1>All tags</h1>
          <p>{data ? `${all.length} tag${all.length === 1 ? '' : 's'} across the notes.` : 'Every topic, A to Z.'}</p>
        </div>
      </section>

      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="sr" htmlFor="tag-filter">Find a tag</label>
        <input id="tag-filter" type="search" value={filter} maxLength={40} placeholder="Find a tag" onChange={(e) => { setFilter(e.target.value); setLimit(PAGE); }} />
      </form>

      {letters.length > 0 && (
        <nav className="segments" aria-label="Tags by letter">
          {['popular', ...letters].map((key) => (
            <button
              key={key}
              type="button"
              className={`seg${!needle && segment === key ? ' on' : ''}`}
              aria-pressed={!needle && segment === key}
              aria-label={key === 'popular' ? 'Popular tags' : key === '#' ? 'Tags starting with a number or symbol' : `Tags starting with ${key}`}
              onClick={() => pick(key)}
            >
              {key === 'popular' ? 'Popular' : key}
            </button>
          ))}
        </nav>
      )}

      {loading && !data && <p className="note">Loading tags…</p>}
      {error && <div className="card empty"><span className="tab">Oops</span><p>{error.message}</p></div>}

      {data && (
        <section className="card tag-panel" aria-live="polite">
          <span className="tab">{needle ? `Matching “${filter.trim()}”` : segment === 'popular' ? 'Most used' : segment}</span>
          {shown.length === 0 ? (
            <p className="muted">{needle ? 'No tag matches that.' : 'No tags yet.'}</p>
          ) : (
            <ul className="taglist">
              {shown.slice(0, limit).map((t) => (
                <li key={t.tag}><Link className="chip" to={`/tag/${t.tag}`}>#{t.tag} <b>{t.count}</b></Link></li>
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <p className="row">
              <button type="button" className="ghost" onClick={() => setLimit((n) => n + PAGE)}>
                Show more ({shown.length - limit} left)
              </button>
            </p>
          )}
        </section>
      )}
    </Layout>
  );
}
