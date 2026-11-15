import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useDocumentTitle } from '../hooks.js';

export default function Confirm() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ done: false, error: '' });
  useDocumentTitle('Confirm · tolie.space notes');

  useEffect(() => {
    api('/api/subscribe/confirm', { method: 'POST', body: { token } })
      .then(() => setState({ done: true, error: '' }))
      .catch((err) => setState({ done: false, error: err.message }));
  }, [token]);

  return (
    <Layout>
      <div className="card empty">
        <span className="tab">Letters</span>
        {state.done && <><h1>You’re in</h1><p>You’ll get an email when a new note goes out.</p></>}
        {state.error && <><h1>Hmm</h1><p>{state.error}</p></>}
        {!state.done && !state.error && <p>Confirming…</p>}
        <p><Link className="btn" to="/">Back to the notes</Link></p>
      </div>
    </Layout>
  );
}
