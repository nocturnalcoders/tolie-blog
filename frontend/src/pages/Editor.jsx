import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import { api } from '../api.js';
import { useApi, useDocumentTitle } from '../hooks.js';

const EMPTY = { title: '', slug: '', tags: '', excerpt: '', body: '', topic_id: null };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Unsaved work is kept on this device, so a crash, a closed tab or an expired
// sign-in never loses it. It is cleared once the server has the post.
const draftKey = (id) => `tolie-draft:${id || 'new'}`;

function readDraft(id) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
  } catch {
    return null;
  }
}

function writeDraft(id, form) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ form, at: Date.now() }));
  } catch {
    /* storage full or blocked */
  }
}

function dropDraft(id) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* blocked */
  }
}

const sameForm = (a, b) => ['title', 'slug', 'tags', 'excerpt', 'body', 'topic_id'].every((k) => (a[k] ?? '') === (b[k] ?? ''));

// <input type="datetime-local"> works in local time, without a zone.
function localInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function fileSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
  const [scheduled, setScheduled] = useState(null); // Date when the post is waiting to go out
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState('');
  const [restore, setRestore] = useState(null); // an unsaved draft found on this device
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const caretRef = useRef(null); // where the cursor was last, since opening the file picker can lose it
  const [dropping, setDropping] = useState(false);
  const topics = useApi('/api/admin/topics');
  useDocumentTitle(`${isNew ? 'New note' : 'Edit note'} · tolie.space notes`);

  // Load the post when editing.
  useEffect(() => {
    setRestore(null);
    setScheduled(null);
    setScheduling(false);
    if (isNew) {
      const saved = readDraft(null);
      setForm(EMPTY);
      setStatus('draft');
      setLoaded(true);
      if (saved && !sameForm(saved.form, EMPTY)) setRestore(saved);
      return undefined;
    }
    let alive = true;
    setLoaded(false);
    api(`/api/admin/posts/${id}`)
      .then(({ post }) => {
        if (!alive) return;
        const fresh = { title: post.title, slug: post.slug, tags: post.tags.join(', '), excerpt: post.excerpt, body: post.body, topic_id: post.topic_id ?? null };
        setForm(fresh);
        setStatus(post.status);
        setScheduled(post.scheduled ? new Date(post.publish_at) : null);
        setDirty(false);
        setLoaded(true);
        const saved = readDraft(id);
        if (saved && !sameForm(saved.form, fresh)) setRestore(saved);
        else if (saved) dropDraft(id);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  // Keep a copy of unsaved changes on this device (not while a found draft waits for an answer).
  useEffect(() => {
    if (!loaded || !dirty || restore) return undefined;
    const timer = setTimeout(() => writeDraft(id, form), 800);
    return () => clearTimeout(timer);
  }, [form, dirty, loaded, restore, id]);

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
        if (action === 'schedule') {
          const at = new Date(when);
          if (!when || Number.isNaN(at.getTime())) {
            setError('Pick a date and time first.');
            setSaving(false);
            return;
          }
          payload.publish_at = at.toISOString();
        }
        const res = isNew
          ? await api('/api/admin/posts', { method: 'POST', body: payload })
          : await api(`/api/admin/posts/${id}`, { method: 'PUT', body: payload });
        setDirty(false);
        dropDraft(isNew ? null : id);
        if (isNew) dropDraft(res.post.id);
        setScheduled(res.post.scheduled ? new Date(res.post.publish_at) : null);
        setScheduling(false);
        const verb = { publish: 'Published.', schedule: `Scheduled for ${new Date(res.post.publish_at).toLocaleString()}.` }[action] || 'Saved.';
        if (isNew) {
          navigate(`/admin/edit/${res.post.id}`, { replace: true, state: { flash: verb } });
        } else {
          setForm((f) => ({ ...f, slug: res.post.slug, excerpt: res.post.excerpt }));
          setStatus(res.post.status);
          setMessage(verb);
        }
      } catch (err) {
        setError(err.status === 401
          ? 'You were signed out. Your text is kept on this device: sign in again in another tab, then save here.'
          : err.message);
      }
      setSaving(false);
    },
    [form, id, isNew, navigate, saving, when]
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
        return { saved: [res.original_size, res.size] };
      } catch (err) {
        swap(job.placeholder, '');
        return { error: `${job.file.name}: ${err.message}` };
      }
    }));
    const failed = results.filter((r) => r.error).map((r) => r.error);
    const [before, after] = results.reduce(([a, b], r) => (r.saved ? [a + r.saved[0], b + r.saved[1]] : [a, b]), [0, 0]);
    const shrunk = after && after < before ? ` (${fileSize(before)} → ${fileSize(after)})` : '';
    setMessage(failed.length ? '' : `${files.length > 1 ? `${files.length} images` : 'Image'} added${shrunk}.`);
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
          {restore && (
            <div className="flash err restore" role="alert">
              <p>You have unsaved changes from {new Date(restore.at).toLocaleString()} on this device.</p>
              <p className="row">
                <button
                  type="button"
                  onClick={() => {
                    setForm(restore.form);
                    setDirty(true);
                    setRestore(null);
                  }}
                >
                  Restore them
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    dropDraft(id);
                    setRestore(null);
                  }}
                >
                  Discard
                </button>
              </p>
            </div>
          )}
          {error && <p className="flash err" role="alert">{error}</p>}
          {message && !error && <p className="flash ok" role="status">{message}</p>}

          <label htmlFor="title">Title</label>
          <input id="title" type="text" maxLength={150} value={form.title} onChange={change('title')} />

          <label htmlFor="topic">Topic <small>(<Link to="/admin/topics">manage topics</Link>)</small></label>
          <select
            id="topic"
            value={form.topic_id ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setForm((f) => ({ ...f, topic_id: value ? Number(value) : null }));
              setDirty(true);
            }}
          >
            <option value="">No topic</option>
            {(topics.data ? topics.data.topics : []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

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

          {scheduled && (
            <p className="flash ok scheduled-note">Scheduled to go out on <b>{scheduled.toLocaleString()}</b>. Until then only you can see it.</p>
          )}
          <div className="row">
            {scheduled ? (
              <>
                <button type="button" disabled={saving} onClick={() => save('save')}>Save changes</button>
                <button type="button" className="ghost" disabled={saving} onClick={() => save('publish')}>Publish now</button>
                <button type="button" className="ghost" disabled={saving} onClick={() => save('draft')}>Unschedule</button>
              </>
            ) : status === 'published' ? (
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
            {status !== 'published' || scheduled ? (
              <button
                type="button"
                className="link"
                aria-expanded={scheduling}
                onClick={() => {
                  setScheduling((v) => !v);
                  if (!when) setWhen(localInput(scheduled || new Date(Date.now() + 24 * 3600 * 1000)));
                }}
              >
                {scheduled ? 'Change time' : 'Schedule…'}
              </button>
            ) : null}
          </div>
          {scheduling && (
            <div className="inline-edit schedule-row">
              <label htmlFor="publish-at">Publish on</label>
              <input id="publish-at" type="datetime-local" value={when} min={localInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
              <button type="button" disabled={saving} onClick={() => save('schedule')}>Schedule</button>
            </div>
          )}
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
