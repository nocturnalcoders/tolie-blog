import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useDocumentTitle } from '../hooks.js';

// Mail scanners open links on their own, so stopping takes a click here rather than happening on load.
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const replies = params.get('replies');
  const token = replies || params.get('token') || '';
  const [state, setState] = useState('ask');
  useDocumentTitle('Unsubscribe · tolie.space notes');

  const stop = async () => {
    setState('busy');
    try {
      await api(replies ? '/api/comments/stop' : '/api/unsubscribe', { method: 'POST', body: { token } });
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <Layout>
      <div className="card empty">
        <span className="tab">Letters</span>
        {state === 'done' ? (
          <><h1>Done</h1><p>{replies ? 'No more emails about replies to that comment.' : 'You won’t get any more emails from this blog.'}</p></>
        ) : (
          <>
            <h1>{replies ? 'Stop reply emails?' : 'Unsubscribe?'}</h1>
            <p>{replies ? 'You won’t hear about new replies to your comment.' : 'You won’t get emails about new notes any more.'}</p>
            {state === 'error' && <p className="flash err" role="alert">That didn’t work. Try again in a moment.</p>}
            <p><button type="button" disabled={state === 'busy'} onClick={stop}>{replies ? 'Stop reply emails' : 'Unsubscribe'}</button></p>
          </>
        )}
        <p><Link to="/">Back to the notes</Link></p>
      </div>
    </Layout>
  );
}
