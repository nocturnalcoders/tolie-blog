import { useState } from 'react';
import { api } from '../api.js';

// A secret link that shows this note to anyone who has it, even before it is published.
export default function PreviewLink({ postId, initialUrl }) {
  const [url, setUrl] = useState(initialUrl || null);
  const [note, setNote] = useState('');

  const make = async () => {
    try {
      const r = await api(`/api/admin/posts/${postId}/preview-link`, { method: 'POST' });
      setUrl(r.url);
      try {
        await navigator.clipboard.writeText(r.url);
        setNote('Link copied.');
      } catch {
        setNote('');
      }
    } catch (err) {
      setNote(err.message);
    }
  };

  const off = async () => {
    try {
      await api(`/api/admin/posts/${postId}/preview-link`, { method: 'DELETE' });
      setUrl(null);
      setNote('The link no longer works.');
    } catch (err) {
      setNote(err.message);
    }
  };

  return (
    <section className="card panel preview-link" aria-labelledby="preview-link-title">
      <span className="tab">Share a preview</span>
      <h2 id="preview-link-title" className="sr">Share a preview</h2>
      <p className="muted">Send a friend a link to read this before it goes out. They don’t need to sign in, and search engines won’t list it.</p>
      {url ? (
        <>
          <label htmlFor="preview-url">Preview link</label>
          <div className="inline-edit">
            <input id="preview-url" type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={make}>Copy</button>
            <button type="button" className="ghost" onClick={off}>Turn off</button>
          </div>
        </>
      ) : (
        <p className="row"><button type="button" onClick={make}>Make a preview link</button></p>
      )}
      {note && <p className="muted" role="status">{note}</p>}
    </section>
  );
}
