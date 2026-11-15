import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import { api } from '../api.js';
import { useDocumentTitle } from '../hooks.js';

export default function AboutEdit() {
  const [body, setBody] = useState(null);
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState(null);
  useDocumentTitle('Edit About · tolie.space notes');

  useEffect(() => {
    api('/api/admin/about').then((r) => setBody(r.body)).catch((err) => setMessage({ ok: false, text: err.message }));
  }, []);

  useEffect(() => {
    if (body === null) return undefined;
    const timer = setTimeout(() => {
      api('/api/admin/preview', { method: 'POST', body: { md: body } }).then((r) => setPreview(r.html)).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [body]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/about', { method: 'PUT', body: { body } });
      setMessage({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  };

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>About page</h1>
        <div className="row"><Link className="btn ghost" to="/about">View it</Link><Link className="btn ghost" to="/admin">Back to notes</Link></div>
      </section>
      <div className="editor-grid">
        <form className="card panel" onSubmit={save}>
          <span className="tab">Markdown</span>
          {message && <p className={`flash ${message.ok ? 'ok' : 'err'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
          <label htmlFor="about-body">Write in Markdown</label>
          <textarea id="about-body" rows={18} value={body ?? ''} disabled={body === null} onChange={(e) => setBody(e.target.value)} />
          <p className="row"><button type="submit" disabled={body === null}>Save</button></p>
        </form>
        <section className="card panel preview">
          <span className="tab">Preview</span>
          <Prose html={preview} />
        </section>
      </div>
    </Layout>
  );
}
