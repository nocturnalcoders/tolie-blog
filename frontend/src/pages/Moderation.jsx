import { useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useApi, useDocumentTitle } from '../hooks.js';
import { formatDate } from '../utils.js';

export default function Moderation() {
  const [status, setStatus] = useState('pending');
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  const { data, error, loading } = useApi(`/api/admin/comments?status=${status}`, reload);
  useDocumentTitle('Comments · tolie.space notes');

  const act = async (comment, method, done) => {
    if (method === 'DELETE' && !window.confirm(`Delete the comment from ${comment.author}?`)) return;
    try {
      await api(`/api/admin/comments/${comment.id}`, { method });
      setMessage(done);
      setReload((n) => n + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const comments = data ? data.comments : [];

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>Comments</h1>
        <div className="row">
          <button className={status === 'pending' ? undefined : 'ghost'} type="button" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}>
            Waiting{data ? ` (${data.pending})` : ''}
          </button>
          <button className={status === 'approved' ? undefined : 'ghost'} type="button" aria-pressed={status === 'approved'} onClick={() => setStatus('approved')}>
            Approved
          </button>
          <Link className="btn ghost" to="/admin">Back to notes</Link>
        </div>
      </section>
      {message && <p className="flash ok" role="status">{message}</p>}
      {error && <p className="flash err" role="alert">{error.message}</p>}
      <div className="card table-card">
        <span className="tab">{status === 'pending' ? 'Waiting for you' : 'Approved'}</span>
        <div className="table-scroll">
          <table className="posts">
            <thead>
              <tr><th>Comment</th><th>On</th><th>Date</th><th><span className="sr">Actions</span></th></tr>
            </thead>
            <tbody>
              {comments.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.author}</b><p className="comment-body">{c.body}</p></td>
                  <td><Link to={`/post/${c.post_slug}`}>{c.post_title}</Link></td>
                  <td>{formatDate(c.date)}</td>
                  <td className="acts">
                    {c.status === 'pending' && <button className="link" type="button" onClick={() => act(c, 'PUT', 'Comment approved.')}>Approve</button>}
                    <button className="link danger" type="button" onClick={() => act(c, 'DELETE', 'Comment deleted.')}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && comments.length === 0 && (
                <tr><td colSpan={4}>{status === 'pending' ? 'Nothing waiting. All caught up.' : 'No approved comments yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
