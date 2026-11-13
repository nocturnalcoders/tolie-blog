import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { formatDate } from '../utils.js';

export default function Comments({ slug }) {
  const { admin } = useAuth();
  const path = `/api/posts/${encodeURIComponent(slug)}/comments`;
  const [reload, setReload] = useState(0);
  const { data, error } = useApi(path, reload);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot, hidden from people
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const comments = data ? data.comments : [];

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const r = await api(path, { method: 'POST', body: { name, body, website } });
      setBody('');
      if (r.pending) {
        setFlash({ ok: true, text: 'Thanks! Your comment will show up here once I’ve read it.' });
      } else {
        setReload((n) => n + 1);
      }
    } catch (err) {
      setFlash({ ok: false, text: err.message });
    }
    setBusy(false);
  };

  return (
    <section className="card comments" aria-labelledby="comments-title">
      <span className="tab">Comments</span>
      <h2 id="comments-title">{comments.length === 0 ? 'No comments yet' : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}</h2>
      {error && <p className="flash err">{error.message}</p>}
      {comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className={c.by_author ? 'by-author' : undefined}>
              <p className="meta">
                <b>{c.author}</b>
                {c.by_author && <span className="badge published">author</span>} · {formatDate(c.date)}
              </p>
              <p className="comment-body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="panel comment-form" onSubmit={onSubmit}>
        {!admin && (
          <>
            <label htmlFor="c-name">Name</label>
            <input id="c-name" type="text" maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </>
        )}
        <div className="hp" aria-hidden="true">
          <label htmlFor="c-website">Website</label>
          <input id="c-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <label htmlFor="c-body">{admin ? 'Reply as the author' : 'Comment'} <small>(plain text)</small></label>
        <textarea id="c-body" rows={4} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} required />
        {flash && <p className={`flash ${flash.ok ? 'ok' : 'err'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</p>}
        <p className="row">
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Post comment'}</button>
          {!admin && <span className="muted">Comments are read before they appear.</span>}
        </p>
      </form>
    </section>
  );
}
