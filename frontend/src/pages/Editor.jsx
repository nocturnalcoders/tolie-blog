import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import { api } from '../api.js';
import { useDocumentTitle } from '../hooks.js';

const EMPTY = { title: '', slug: '', tags: '', excerpt: '', body: '' };

export default function Editor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState('draft');
  const [loaded, setLoaded] = useState(isNew);
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  useDocumentTitle(`${isNew ? 'New note' : 'Edit note'} · tolie.space notes`);

  // Load the post when editing.
  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
      setStatus('draft');
      setLoaded(true);
      return undefined;
    }
    let alive = true;
    setLoaded(false);
    api(`/api/admin/posts/${id}`)
      .then(({ post }) => {
        if (!alive) return;
        setForm({ title: post.title, slug: post.slug, tags: post.tags.join(', '), excerpt: post.excerpt, body: post.body });
        setStatus(post.status);
        setDirty(false);
        setLoaded(true);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  // "Saved." / "Published." after being redirected from /admin/new.
  useEffect(() => {
    if (location.state && location.state.flash) setMessage(location.state.flash);
  }, [location.state]);

  // Live preview, rendered by the backend so it matches the real page exactly.
  useEffect(() => {
    if (!loaded) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      api('/api/admin/preview', { method: 'POST', body: { md: form.body } })
        .then((r) => alive && setPreview(r.html))
        .catch(() => {});
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [form.body, loaded]);

  const save = useCallback(
    async (action) => {
      if (saving) return;
      if (!form.title.trim()) {
        setError('Give the post a title first.');
        return;
      }
      setSaving(true);
      setError('');
      setMessage('');
      try {
        const payload = { ...form, action };
        const res = isNew
          ? await api('/api/admin/posts', { method: 'POST', body: payload })
          : await api(`/api/admin/posts/${id}`, { method: 'PUT', body: payload });
        setDirty(false);
        const verb = action === 'publish' ? 'Published.' : 'Saved.';
        if (isNew) {
          navigate(`/admin/edit/${res.post.id}`, { replace: true, state: { flash: verb } });
        } else {
          setForm((f) => ({ ...f, slug: res.post.slug, excerpt: res.post.excerpt }));
          setStatus(res.post.status);
          setMessage(verb);
        }
      } catch (err) {
        setError(err.message);
      }
      setSaving(false);
    },
    [form, id, isNew, navigate, saving]
  );

  const primary = status === 'published' ? 'save' : 'draft';
  const saveRef = useRef(save);
  saveRef.current = save;
  const primaryRef = useRef(primary);
  primaryRef.current = primary;

  // Ctrl/Cmd + S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveRef.current(primaryRef.current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const change = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const onBodyKeyDown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ta = e.target;
      const s = ta.selectionStart;
      const t = ta.selectionEnd;
      setForm((f) => ({ ...f, body: `${f.body.slice(0, s)}  ${f.body.slice(t)}` }));
      setDirty(true);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  };

  const onPickImage = async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    setMessage('Uploading…');
    setError('');
    try {
      const data = new FormData();
      data.append('file', file);
      const res = await api('/api/admin/upload', { method: 'POST', form: data });
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const snippet = `![${alt}](${res.url})`;
      const ta = bodyRef.current;
      const s = ta ? ta.selectionStart : form.body.length;
      const t = ta ? ta.selectionEnd : s;
      setForm((f) => ({ ...f, body: f.body.slice(0, s) + snippet + f.body.slice(t) }));
      setDirty(true);
      setMessage('Image added.');
    } catch (err) {
      setMessage('');
      setError(err.message);
    }
    input.value = '';
  };

  const remove = async () => {
    if (!window.confirm('Delete this note? This can’t be undone.')) return;
    try {
      await api(`/api/admin/posts/${id}`, { method: 'DELETE' });
      setDirty(false);
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    }
  };

  const words = (form.body.match(/\S+/g) || []).length;

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>{isNew ? 'New note' : 'Edit note'}</h1>
        <div className="row"><Link className="btn ghost" to="/admin">All notes</Link></div>
      </section>

      <div className="editor-grid">
        <form className="card panel" onSubmit={(e) => e.preventDefault()}>
          <span className="tab">{status}</span>
          {error && <p className="flash err" role="alert">{error}</p>}
          {message && !error && <p className="flash ok" role="status">{message}</p>}

          <label htmlFor="title">Title</label>
          <input id="title" type="text" maxLength={150} value={form.title} onChange={change('title')} />

          <div className="two-col">
            <div>
              <label htmlFor="slug">URL name <small>(optional)</small></label>
              <input id="slug" type="text" maxLength={80} value={form.slug} onChange={change('slug')} placeholder="made-from-the-title" />
            </div>
            <div>
              <label htmlFor="tags">Tags <small>(comma separated)</small></label>
              <input id="tags" type="text" value={form.tags} onChange={change('tags')} placeholder="python, football" />
            </div>
          </div>

          <label htmlFor="excerpt">Summary <small>(shown in the list; auto-filled if empty)</small></label>
          <textarea id="excerpt" rows={2} maxLength={300} value={form.excerpt} onChange={change('excerpt')} />

          <div className="label-row">
            <label htmlFor="body">Write in Markdown</label>
            <span className="tools">
              <button className="link" type="button" onClick={() => fileRef.current && fileRef.current.click()}>Add image</button>
              <input ref={fileRef} className="sr" type="file" aria-label="Choose an image" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onPickImage} />
              <span className="muted">{words} {words === 1 ? 'word' : 'words'}</span>
            </span>
          </div>
          <textarea id="body" ref={bodyRef} rows={18} spellCheck value={form.body} onChange={change('body')} onKeyDown={onBodyKeyDown} />

          <div className="row">
            {status === 'published' ? (
              <>
                <button type="button" disabled={saving} onClick={() => save('save')}>Save changes</button>
                <button type="button" className="ghost" disabled={saving} onClick={() => save('draft')}>Unpublish</button>
              </>
            ) : (
              <>
                <button type="button" className="ghost" disabled={saving} onClick={() => save('draft')}>Save draft</button>
                <button type="button" disabled={saving} onClick={() => save('publish')}>Publish</button>
              </>
            )}
          </div>
        </form>

        <section className="card panel preview">
          <span className="tab">Preview</span>
          <Prose html={preview} />
        </section>
      </div>

      {!isNew && (
        <div className="delete-row">
          <button className="link danger" type="button" onClick={remove}>Delete this note</button>
          {form.slug && <Link to={`/post/${form.slug}`}>View it on the site</Link>}
        </div>
      )}
    </Layout>
  );
}
