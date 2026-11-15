import { Link } from 'react-router-dom';
import Prose from './Prose.jsx';
import { formatDate } from '../utils.js';

const OTHER_LANG = { id: 'Read it in English', en: 'Baca dalam Bahasa Indonesia' };

// The title block and the article itself, shared by the post page and draft previews.
export function PostHeader({ post }) {
  return (
    <header className="post-hero">
      <p className="meta">
        <Link to="/">Notes</Link>
        {post.topic && <> · <Link to={`/topic/${post.topic.slug}`}>{post.topic.name}</Link></>}
        {' '}· {formatDate(post.date)} · {post.read_min} min read
      </p>
      <h1 lang={post.lang}>{post.title}</h1>
      {post.translation && (
        <p className="translation">
          <Link to={`/post/${post.translation.slug}`} hrefLang={post.translation.lang} lang={post.translation.lang}>
            {OTHER_LANG[post.translation.lang === 'id' ? 'en' : 'id']} →
          </Link>
        </p>
      )}
      {post.tags.length > 0 && (
        <ul className="tags">
          {post.tags.map((t) => <li key={t}><Link to={`/tag/${t}`}>#{t}</Link></li>)}
        </ul>
      )}
    </header>
  );
}

function SeriesBox({ series }) {
  const at = series.parts.findIndex((p) => p.current);
  return (
    <nav className="series-box" aria-label={`Series: ${series.name}`}>
      <p>
        <b>Part {at + 1} of {series.parts.length}</b> in <Link to={`/series/${series.slug}`}>{series.name}</Link>
      </p>
      <ol>
        {series.parts.map((p) => (
          <li key={p.slug}>
            {p.current ? <span aria-current="page">{p.title}</span> : <Link to={`/post/${p.slug}`}>{p.title}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PostArticle({ post }) {
  return (
    <article className="card article" lang={post.lang}>
      <span className="tab">{post.topic ? post.topic.name : post.tags[0] || 'Note'}</span>
      {post.series && post.series.parts.length > 1 && <SeriesBox series={post.series} />}
      {post.toc && post.toc.length >= 3 && (
        <nav className="toc" aria-labelledby="toc-title">
          <p id="toc-title">On this page</p>
          <ol>
            {post.toc.map((t) => (
              <li key={t.id} className={`l${t.level}`}><a href={`#${t.id}`}>{t.title}</a></li>
            ))}
          </ol>
        </nav>
      )}
      <Prose html={post.html} />
      {post.series && post.series.parts.length > 1 && (() => {
        const at = post.series.parts.findIndex((p) => p.current);
        const next = post.series.parts[at + 1];
        return next ? <p className="series-next end"><Link to={`/post/${next.slug}`}>Next in the series: {next.title} →</Link></p> : null;
      })()}
    </article>
  );
}
