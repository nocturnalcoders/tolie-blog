import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import PostCard from '../components/PostCard.jsx';
import Pager from '../components/Pager.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

export default function Home() {
  const { tag } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (tag) qs.set('tag', tag);
  if (page > 1) qs.set('page', String(page));
  const list = useApi(`/api/posts?${qs.toString()}`);
  const tags = useApi('/api/tags');

  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  useDocumentTitle(
    `${tag ? `#${tag} · ` : q ? `Search: ${q} · ` : ''}Notes from the little town · tolie.space`
  );

  const onSearch = (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (draft.trim()) next.set('q', draft.trim());
    setParams(next);
  };

  const posts = list.data ? list.data.posts : [];

  return (
    <Layout>
      <section className="hero">
        <img className="avatar" src="/avatar.jpg" width="96" height="96" alt="Ghibli-style portrait of Christianto Lie" />
        <div>
          <h1>{tag ? `Notes tagged #${tag}` : 'Notes from the little town'}</h1>
          <p>Software, football, anime, books, and whatever I’m learning this week.</p>
        </div>
      </section>

      <form className="search" onSubmit={onSearch} role="search">
        <label className="sr" htmlFor="q">Search notes</label>
        <input id="q" name="q" type="search" value={draft} maxLength={80} placeholder="Search notes" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      {tags.data && tags.data.tags.length > 0 && (
        <ul className="taglist" aria-label="Tags">
          {tags.data.tags.map(({ tag: t, count }) => (
            <li key={t}>
              <Link className={`chip${t === tag ? ' on' : ''}`} to={`/tag/${t}`}>#{t} <b>{count}</b></Link>
            </li>
          ))}
        </ul>
      )}

      {q && list.data && (
        <p className="note">
          {list.data.total} result{list.data.total === 1 ? '' : 's'} for “{q}”. <Link to={tag ? `/tag/${tag}` : '/'}>Clear search</Link>
        </p>
      )}

      {list.loading && !list.data && <p className="note">Loading notes…</p>}
      {list.error && (
        <div className="card empty"><span className="tab">Oops</span><p>{list.error.message}</p></div>
      )}

      {posts.map((p) => <PostCard key={p.slug} post={p} />)}

      {list.data && posts.length === 0 && (
        <div className="card empty">
          <span className="tab">Quiet</span>
          <p>{q ? 'Nothing matched that search. Try a different word.' : 'No notes yet. The first one is on its way.'}</p>
        </div>
      )}

      {list.data && <Pager page={list.data.page} pages={list.data.pages} q={q} />}
    </Layout>
  );
}
