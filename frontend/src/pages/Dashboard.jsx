import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';
import { formatDate } from '../utils.js';

export default function Dashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  const { data, error, loading } = useApi('/api/admin/posts', reload);
  const comments = useApi('/api/admin/comments');
  const pending = comments.data ? comments.data.pending : 0;
  const topics = useApi('/api/admin/topics', reload);
  const topicNames = Object.fromEntries((topics.data ? topics.data.topics : []).map((t) => [t.id, t.name]));
  const [picked, setPicked] = useState(() => new Set());
  const [bulkTopic, setBulkTopic] = useState('');
  useDocumentTitle('Admin · tolie.space notes');

  const remove = async (post) => {
    if (!window.confirm(`Delete “${post.title}”? This can’t be undone.`)) return;
    try {
      await api(`/api/admin/posts/${post.id}`, { method: 'DELETE' });
      setMessage('Post deleted.');
      setReload((n) => n + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const signOut = async () => {
    await logout();
    navigate('/');
  };

  const posts = data ? data.posts : [];
  const allPicked = posts.length > 0 && posts.every((p) => picked.has(p.id));
  const toggle = (pid) => setPicked((old) => {
    const next = new Set(old);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    return next;
  });

  const applyTopic = async (e) => {
    e.preventDefault();
    try {
      const topicId = bulkTopic === 'none' ? null : Number(bulkTopic);
      const r = await api('/api/admin/posts/topic', { method: 'POST', body: { ids: [...picked], topic_id: topicId } });
      setMessage(`${r.updated} note${r.updated === 1 ? '' : 's'} moved to ${topicId === null ? 'no topic' : topicNames[topicId]}.`);
      setPicked(new Set());
      setReload((n) => n + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>Your notes</h1>
        <div className="row">
          <Link className="btn" to="/admin/new">New note</Link>
          <Link className="btn ghost" to="/admin/stats">Traffic</Link>
          <Link className="btn ghost" to="/admin/topics">Topics</Link>
          <Link className="btn ghost" to="/admin/security">Security</Link>
          <Link className="btn ghost" to="/admin/comments">Comments{pending > 0 ? ` (${pending} waiting)` : ''}</Link>
          <button className="ghost" type="button" onClick={signOut}>Sign out</button>
        </div>
      </section>
      {message && <p className="flash ok" role="status">{message}</p>}
      {error && <p className="flash err" role="alert">{error.message}</p>}
      <div className="card table-card">
        <span className="tab">All posts</span>
        {picked.size > 0 && (
          <form className="inline-edit bulk-bar" onSubmit={applyTopic}>
            <span>{picked.size} selected</span>
            <label className="sr" htmlFor="bulk-topic">Topic for the selected notes</label>
            <select id="bulk-topic" value={bulkTopic} onChange={(e) => setBulkTopic(e.target.value)} required>
              <option value="" disabled>Pick a topic…</option>
              {(topics.data ? topics.data.topics : []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="none">No topic</option>
            </select>
            <button type="submit">Set topic</button>
            <button type="button" className="link" onClick={() => setPicked(new Set())}>Clear</button>
          </form>
        )}
        <div className="table-scroll">
          <table className="posts">
            <thead>
              <tr>
                <th className="pick">
                  <input type="checkbox" aria-label="Select all notes" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(posts.map((p) => p.id)))} />
                </th>
                <th>Title</th><th>Topic</th><th>Status</th><th>Updated</th><th><span className="sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className={picked.has(p.id) ? 'picked' : undefined}>
                  <td className="pick"><input type="checkbox" aria-label={`Select ${p.title}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td><Link to={`/admin/edit/${p.id}`}>{p.title}</Link><br /><small>/post/{p.slug}</small></td>
                  <td>{p.topic_id ? topicNames[p.topic_id] || '' : <small>none</small>}</td>
                  <td>
                    {p.scheduled
                      ? <span className="badge scheduled" title={new Date(p.publish_at).toLocaleString()}>scheduled · {formatDate(p.publish_at)}</span>
                      : <span className={`badge ${p.status}`}>{p.status}</span>}
                  </td>
                  <td>{formatDate(p.updated_at)}</td>
                  <td className="acts">
                    <Link to={`/post/${p.slug}`}>View</Link>
                    <Link to={`/admin/edit/${p.id}`}>Edit</Link>
                    <button className="link danger" type="button" onClick={() => remove(p)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && posts.length === 0 && <tr><td colSpan={6}>No notes yet. Write the first one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
