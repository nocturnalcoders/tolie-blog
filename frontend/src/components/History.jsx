import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';

// Earlier versions of a post: what changed since then, and a way to bring one back into the editor.
export default function History({ postId, reloadKey, onRestore }) {
  const { data } = useApi(`/api/admin/posts/${postId}/revisions`, reloadKey);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const revisions = data ? data.revisions : [];

  const show = async (rid) => {
    setError('');
    if (open && open.id === rid) {
      setOpen(null);
      return;
    }
    try {
      setOpen(await api(`/api/admin/revisions/${rid}`));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card panel history" aria-labelledby="history-title">
      <span className="tab">Earlier versions</span>
      <h2 id="history-title" className="sr">Earlier versions</h2>
      {revisions.length === 0 && <p className="muted">Nothing yet. Each time you save a change, the version before it is kept here (the last 50).</p>}
      {error && <p className="flash err" role="alert">{error}</p>}
      <ol className="rev-list">
        {revisions.map((r) => (
          <li key={r.id}>
            <button type="button" className="link" aria-expanded={open?.id === r.id} onClick={() => show(r.id)}>
              {new Date(r.date).toLocaleString()}
            </button>
            <span className="muted"> · {r.title} · {r.words} words</span>
            {open?.id === r.id && (
              <div className="rev-detail">
                <p className="muted">What changed from this version to the one saved now (− removed, + added):</p>
                {open.diff.length === 0 ? (
                  <p className="muted">The text is the same; only the title, summary or tags differ.</p>
                ) : (
                  <pre className="diff">
                    {open.diff.map((d, i) => (
                      <span key={i} className={`d-${{ '+': 'add', '-': 'del', '@': 'hunk', ' ': 'same' }[d.op]}`}>
                        {d.op === '@' ? d.text : `${d.op === ' ' ? ' ' : d.op} ${d.text}`}{'\n'}
                      </span>
                    ))}
                  </pre>
                )}
                <p className="row">
                  <button type="button" className="ghost" onClick={() => onRestore(open)}>Put this version in the editor</button>
                  <span className="muted">Nothing changes on the site until you save.</span>
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
