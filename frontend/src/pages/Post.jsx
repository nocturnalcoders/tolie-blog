import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { PostArticle, PostHeader } from '../components/PostBody.jsx';
import Reactions from '../components/Reactions.jsx';
import Comments from '../components/Comments.jsx';
import Share from '../components/Share.jsx';
import Subscribe from '../components/Subscribe.jsx';
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
          <PostHeader post={post} />
          <PostArticle post={post} />
          {post.status === 'published' && <Reactions key={`reactions-${post.slug}`} slug={post.slug} />}
          {post.status === 'published' && <Share key={`share-${post.slug}`} slug={post.slug} title={post.title} />}
          <aside className="card author">
            <img className="avatar" src="/avatar.jpg" width="72" height="72" alt="Ghibli-style portrait of Christianto Lie" />
            <p>
              <b>Christianto Lie</b><br />
              Senior software engineer, futsal player, night walker. Come say hi in <a href="https://tolie.space">the little town</a>.
            </p>
          </aside>
          {data.related && data.related.length > 0 && (
            <section className="related" aria-labelledby="related-title">
              <h2 id="related-title">Read next</h2>
              <div className="related-grid">
                {data.related.map((r) => (
                  <article key={r.slug} className="card mini">
                    <span className="tab">{r.topic ? r.topic.name : r.tags[0] || 'Note'}</span>
                    <h3><Link to={`/post/${r.slug}`}>{r.title}</Link></h3>
                    <p className="meta">{formatDate(r.date)} · {r.read_min} min read</p>
                  </article>
                ))}
              </div>
            </section>
          )}
          {post.status === 'published' && <Subscribe />}
          {post.status === 'published' && <Comments key={`comments-${post.slug}`} slug={post.slug} />}
          <nav className="pager two" aria-label="More notes">
            {data.prev ? <Link className="btn" to={`/post/${data.prev.slug}`}>← {data.prev.title.length > 34 ? `${data.prev.title.slice(0, 33)}…` : data.prev.title}</Link> : <span />}
            {data.next && <Link className="btn" to={`/post/${data.next.slug}`}>{data.next.title.length > 34 ? `${data.next.title.slice(0, 33)}…` : data.next.title} →</Link>}
          </nav>
        </>
      )}
    </Layout>
  );
}
