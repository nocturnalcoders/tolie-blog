import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useDocumentTitle } from '../hooks.js';
import { safeNext } from '../utils.js';

export default function Login() {
  const { ready, admin, configured, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Sign in · tolie.space notes');

  useEffect(() => {
    if (admin) navigate(next, { replace: true });
  }, [admin, next, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password, needCode ? code : undefined);
    } catch (err) {
      if (err.data && err.data.need_code) {
        // The password was right; now the authenticator code. Don't show an error the first time.
        if (needCode) setError(err.message);
        setNeedCode(true);
      } else {
        setError(err.message);
      }
    }
    setBusy(false);
  };

  return (
    <Layout>
      <form className="card panel" onSubmit={onSubmit}>
        <span className="tab">Admin</span>
        <h1>Sign in</h1>
        {ready && !configured && (
          <p className="flash err">No admin account yet. Run <code>python manage.py init</code> on the server first.</p>
        )}
        {error && <p className="flash err" role="alert">{error}</p>}
        <label htmlFor="username">Username</label>
        <input id="username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {needCode && (
          <>
            <label htmlFor="code">Code from your authenticator app <small>(or a recovery code)</small></label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
          </>
        )}
        <p className="row"><button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></p>
      </form>
    </Layout>
  );
}
