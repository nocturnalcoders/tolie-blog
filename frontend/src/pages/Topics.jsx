import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useApi, useDocumentTitle } from '../hooks.js';

export default function Topics() {
  const { data, error } = useApi('/api/admin/topics');
  const [topics, setTopics] = useState([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // {id, name}
  const [message, setMessage] = useState(null);
  useDocumentTitle('Topics · tolie.space notes');

  useEffect(() => {
    if (data) setTopics(data.topics);
  }, [data]);

  const run = async (call, done) => {
    setMessage(null);
    try {
      const r = await call();
      setTopics(r.topics);
      if (done) setMessage({ ok: true, text: done });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err.message });
      return false;
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (await run(() => api('/api/admin/topics', { method: 'POST', body: { name } }), `Added “${name.trim()}”.`)) setName('');
  };

  const rename = async (e) => {
    e.preventDefault();
    const ok = await run(() => api(`/api/admin/topics/${editing.id}`, { method: 'PUT', body: { name: editing.name } }), 'Renamed.');
    if (ok) setEditing(null);
  };

  const move = (index, by) => {
    const next = [...topics];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setTopics(next);
    run(() => api('/api/admin/topics/order', { method: 'POST', body: { ids: next.map((t) => t.id) } }));
  };

  const remove = (t) => {
    const posts = t.count ? ` Its ${t.count} post${t.count === 1 ? '' : 's'} will have no topic, but stay published.` : '';
    if (!window.confirm(`Delete the topic “${t.name}”?${posts}`)) return;
    run(() => api(`/api/admin/topics/${t.id}`, { method: 'DELETE' }), `Deleted “${t.name}”.`);
  };

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>Topics</h1>
        <div className="row"><Link className="btn ghost" to="/admin">Back to notes</Link></div>
      </section>
      <p className="note">Topics are the few big sections readers pick from on the home page. Each note has one. Tags stay for the details.</p>
      {message && <p className={`flash ${message.ok ? 'ok' : 'err'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      {error && <p className="flash err" role="alert">{error.message}</p>}

      <div className="card table-card">
        <span className="tab">In this order on the home page</span>
        <div className="table-scroll">
          <table className="posts">
            <thead>
              <tr><th>Topic</th><th className="num">Notes</th><th><span className="sr">Actions</span></th></tr>
            </thead>
            <tbody>
              {topics.map((t, i) => (
                <tr key={t.id}>
                  <td>
                    {editing && editing.id === t.id ? (
                      <form className="inline-edit" onSubmit={rename}>
                        <label className="sr" htmlFor={`topic-${t.id}`}>New name for {t.name}</label>
                        <input id={`topic-${t.id}`} type="text" maxLength={40} value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                        <button type="submit">Save</button>
                        <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <Link to={`/topic/${t.slug}`}>{t.name}</Link><br /><small>/topic/{t.slug}</small>
                      </>
                    )}
                  </td>
                  <td className="num">{t.count}</td>
                  <td className="acts">
                    <button className="link" type="button" disabled={i === 0} aria-label={`Move ${t.name} up`} onClick={() => move(i, -1)}>↑</button>
                    <button className="link" type="button" disabled={i === topics.length - 1} aria-label={`Move ${t.name} down`} onClick={() => move(i, 1)}>↓</button>
                    <button className="link" type="button" onClick={() => setEditing({ id: t.id, name: t.name })}>Rename</button>
                    <button className="link danger" type="button" onClick={() => remove(t)}>Delete</button>
                  </td>
                </tr>
              ))}
              {data && topics.length === 0 && <tr><td colSpan={3}>No topics yet. Add the first one below.</td></tr>}
            </tbody>
          </table>
        </div>
        <form className="panel inline-edit add-topic" onSubmit={add}>
          <label htmlFor="new-topic">New topic</label>
          <input id="new-topic" type="text" maxLength={40} placeholder="e.g. Microchips" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">Add topic</button>
        </form>
      </div>
    </Layout>
  );
}
