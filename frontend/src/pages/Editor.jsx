import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import { api } from '../api.js';
import { useDocumentTitle } from '../hooks.js';

const EMPTY = { title: '', slug: '', tags: '', excerpt: '', body: '' };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Put `text` between `s` and `t` as its own block, with a blank line on each side,
// so an image never ends up glued to the middle of a sentence.
function insertBlock(body, s, t, text) {
  const before = body.slice(0, s);
  const after = body.slice(t).replace(/^[ \t]+/, '');
  const gap = (side) => (side.endsWith('\n\n') || side === '' ? '' : side.endsWith('\n') ? '\n' : '\n\n');
  const pre = gap(before);
  const post = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const head = before + pre + text + post;
  return { body: head + after, caret: head.length };
}

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
  const caretRef = useRef(null); // where the cursor was last, since opening the file picker can lose it
  const [dropping, setDropping] = useState(false);
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

  const rememberCaret = (e) => {
    caretRef.current = [e.target.selectionStart, e.target.selectionEnd];
  };

  // Upload images and drop them in where the cursor is. A placeholder holds the spot
  // while uploading, so you can keep typing and the image still lands in the right place.
  const uploadImages = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const bad = files.find((f) => !IMAGE_TYPES.includes(f.type));
    if (bad) {
      setError('Only PNG, JPG, GIF, and WebP images are allowed.');
      return;
    }
    const jobs = files.map((file) => {
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '');
      const tag = Math.random().toString(36).slice(2, 8);
      return { file, alt, placeholder: `![Uploading ${alt}…](#uploading-${tag})` };
    });
    const ta = bodyRef.current;
    const live = ta && document.activeElement === ta ? [ta.selectionStart, ta.selectionEnd] : null;
    const [s, t] = live || caretRef.current || [form.body.length, form.body.length];
    const next = insertBlock(form.body, s, t, jobs.map((j) => j.placeholder).join('\n\n'));
    setForm((f) => ({ ...f, body: next.body }));
    setDirty(true);
    caretRef.current = [next.caret, next.caret];
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = next.caret;
    });

    // Swap a placeholder for its final text without throwing the cursor to the end.
    const swap = (placeholder, text) => {
      const el = bodyRef.current;
      const focused = el && document.activeElement === el;
      const sel = focused ? [el.selectionStart, el.selectionEnd] : null;
      let at = -1;
      setForm((f) => {
        at = f.body.indexOf(placeholder);
        return at < 0 ? f : { ...f, body: f.body.slice(0, at) + text + f.body.slice(at + placeholder.length) };
      });
      requestAnimationFrame(() => {
        if (!sel || at < 0) return;
        const shift = (pos) => (pos > at ? pos + text.length - placeholder.length : pos);
        el.setSelectionRange(shift(sel[0]), shift(sel[1]));
      });
    };

    setMessage(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading…');
    setError('');
    const results = await Promise.all(jobs.map(async (job) => {
      try {
        const data = new FormData();
        data.append('file', job.file);
        const res = await api('/api/admin/upload', { method: 'POST', form: data });
        swap(job.placeholder, `![${job.alt}](${res.url})`);
        return null;
      } catch (err) {
        swap(job.placeholder, '');
        return `${job.file.name}: ${err.message}`;
      }
    }));
    const failed = results.filter(Boolean);
    setMessage(failed.length ? '' : files.length > 1 ? `${files.length} images added.` : 'Image added.');
    if (failed.length) setError(failed.join(' '));
  };

  const onPickImage = async (e) => {
    const input = e.target;
    const files = Array.from(input.files || []);
    input.value = '';
    await uploadImages(files);
  };

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  const onBodyDragOver = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(true);
  };

  const onBodyDrop = (e) => {
    setDropping(false);
    if (!hasFiles(e) || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    uploadImages(e.dataTransfer.files);
  };

  const onBodyPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => IMAGE_TYPES.includes(f.type));
    if (files.length === 0) return;
    e.preventDefault();
    uploadImages(files);
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
              <button className="link" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current && fileRef.current.click()}>Add image</button>
              <input ref={fileRef} className="sr" type="file" multiple aria-label="Choose an image" accept={IMAGE_TYPES.join(',')} onChange={onPickImage} />
              <span className="muted">{words} {words === 1 ? 'word' : 'words'}</span>
            </span>
          </div>
          <textarea
            id="body"
            ref={bodyRef}
            rows={18}
            spellCheck
            className={dropping ? 'dropping' : undefined}
            aria-describedby="body-hint"
            value={form.body}
            onChange={change('body')}
            onKeyDown={onBodyKeyDown}
            onSelect={rememberCaret}
            onBlur={rememberCaret}
            onDragOver={onBodyDragOver}
            onDragLeave={() => setDropping(false)}
            onDrop={onBodyDrop}
            onPaste={onBodyPaste}
          />
          <p id="body-hint" className="muted hint">Images go where the cursor is. You can also drag them in or paste them.</p>

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
