import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { formatDate } from '../utils.js';

function Comment({ c, onReply }) {
  return (
    <>
      <p className="meta">
        <b>{c.author}</b>
        {c.by_author && <span className="badge published">author</span>} · {formatDate(c.date)}
      </p>
      <p className="comment-body">{c.body}</p>
      <button type="button" className="link reply-btn" onClick={() => onReply(c)}>Reply</button>
    </>
  );
}

export default function Comments({ slug }) {
  const { admin, mail } = useAuth();
  const path = `/api/posts/${encodeURIComponent(slug)}/comments`;
  const [reload, setReload] = useState(0);
  const { data, error } = useApi(path, reload);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [notify, setNotify] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot, hidden from people
  const [replyTo, setReplyTo] = useState(null); // the comment being answered
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const bodyRef = useRef(null);
  const comments = data ? data.comments : [];
  // Replies sit under the comment they answer (one level deep).
  const top = comments.filter((c) => !c.parent_id);
  const repliesTo = (id) => comments.filter((c) => c.parent_id === id);

  const startReply = (c) => {
    setReplyTo(c);
    setFlash(null);
    bodyRef.current?.focus();
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const payload = { name, body, website };
      if (replyTo) payload.parent_id = replyTo.id;
      if (email.trim()) {
        payload.email = email.trim();
        payload.notify = notify;
      }
      const r = await api(path, { method: 'POST', body: payload });
      setBody('');
      setReplyTo(null);
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
    <section id="comments" className="card comments" aria-labelledby="comments-title">
      <span className="tab">Comments</span>
      <h2 id="comments-title">{comments.length === 0 ? 'No comments yet' : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}</h2>
      {error && <p className="flash err">{error.message}</p>}
      {top.length > 0 && (
        <ol className="comment-list">
          {top.map((c) => (
            <li key={c.id} className={c.by_author ? 'by-author' : undefined}>
              <Comment c={c} onReply={startReply} />
              {repliesTo(c.id).length > 0 && (
                <ol className="comment-replies" aria-label={`Replies to ${c.author}`}>
                  {repliesTo(c.id).map((r) => (
                    <li key={r.id} className={r.by_author ? 'by-author' : undefined}>
                      <Comment c={r} onReply={startReply} />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
      <form className="panel comment-form" onSubmit={onSubmit}>
        {replyTo && (
          <p className="replying">
            Replying to <b>{replyTo.author}</b>
            <button type="button" className="link" onClick={() => setReplyTo(null)}>Cancel</button>
          </p>
        )}
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
        <textarea id="c-body" ref={bodyRef} rows={4} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} required />
        {!admin && mail && (
          <>
            <label htmlFor="c-email">Email <small>(optional, never shown)</small></label>
            <input id="c-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="check notify">
              <input type="checkbox" checked={notify} disabled={!email.trim()} onChange={(e) => setNotify(e.target.checked)} /> Email me when someone replies
            </label>
          </>
        )}
        {flash && <p className={`flash ${flash.ok ? 'ok' : 'err'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</p>}
        <p className="row">
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : replyTo ? 'Post reply' : 'Post comment'}</button>
          {!admin && <span className="muted">Comments are read before they appear.</span>}
        </p>
      </form>
    </section>
  );
}
