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

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>Your notes</h1>
        <div className="row">
          <Link className="btn" to="/admin/new">New note</Link>
          <Link className="btn ghost" to="/admin/comments">Comments{pending > 0 ? ` (${pending} waiting)` : ''}</Link>
          <button className="ghost" type="button" onClick={signOut}>Sign out</button>
        </div>
      </section>
      {message && <p className="flash ok" role="status">{message}</p>}
      {error && <p className="flash err" role="alert">{error.message}</p>}
      <div className="card table-card">
        <span className="tab">All posts</span>
        <table className="posts">
          <thead>
            <tr><th>Title</th><th>Status</th><th>Updated</th><th><span className="sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/admin/edit/${p.id}`}>{p.title}</Link><br /><small>/post/{p.slug}</small></td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{formatDate(p.updated_at)}</td>
                <td className="acts">
                  <Link to={`/post/${p.slug}`}>View</Link>
                  <Link to={`/admin/edit/${p.id}`}>Edit</Link>
                  <button className="link danger" type="button" onClick={() => remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
            {!loading && posts.length === 0 && <tr><td colSpan={4}>No notes yet. Write the first one.</td></tr>}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
