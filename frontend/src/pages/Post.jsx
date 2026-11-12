import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import NotFound from './NotFound.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';
import { formatDate } from '../utils.js';

export default function Post() {
  const { slug } = useParams();
  const { data, error, loading } = useApi(`/api/posts/${encodeURIComponent(slug)}`);
  const post = data && data.post;
  useDocumentTitle(post ? `${post.title} · tolie.space notes` : undefined);

  if (error && error.status === 404) return <NotFound message={error.message} />;

  return (
    <Layout>
      {loading && !post && <p className="note">Loading…</p>}
      {error && error.status !== 404 && (
        <div className="card empty"><span className="tab">Oops</span><p>{error.message}</p></div>
      )}
      {post && (
        <>
          {post.status !== 'published' && (
            <p className="flash err" role="status">Draft preview. Only you can see this page.</p>
          )}
          <header className="post-hero">
            <p className="meta"><Link to="/">Notes</Link> · {formatDate(post.date)} · {post.read_min} min read</p>
            <h1>{post.title}</h1>
            {post.tags.length > 0 && (
              <ul className="tags">
                {post.tags.map((t) => <li key={t}><Link to={`/tag/${t}`}>#{t}</Link></li>)}
              </ul>
            )}
          </header>
          <article className="card article">
            <span className="tab">{post.tags[0] || 'Note'}</span>
            <Prose html={post.html} />
          </article>
          <aside className="card author">
            <img className="avatar" src="/avatar.jpg" width="72" height="72" alt="Ghibli-style portrait of Christianto Lie" />
            <p>
              <b>Christianto Lie</b><br />
              Senior software engineer, futsal player, night walker. Come say hi in <a href="https://tolie.space">the little town</a>.
            </p>
          </aside>
          <nav className="pager two" aria-label="More notes">
            {data.prev ? <Link className="btn" to={`/post/${data.prev.slug}`}>← {data.prev.title.length > 34 ? `${data.prev.title.slice(0, 33)}…` : data.prev.title}</Link> : <span />}
            {data.next && <Link className="btn" to={`/post/${data.next.slug}`}>{data.next.title.length > 34 ? `${data.next.title.slice(0, 33)}…` : data.next.title} →</Link>}
          </nav>
        </>
      )}
    </Layout>
  );
}
