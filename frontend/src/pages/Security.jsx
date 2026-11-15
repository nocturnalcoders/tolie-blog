import { useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';
import { useApi, useDocumentTitle } from '../hooks.js';

export default function Security() {
  const [reload, setReload] = useState(0);
  const { data, error } = useApi('/api/admin/2fa', reload);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [message, setMessage] = useState(null);
  useDocumentTitle('Security · tolie.space notes');

  const start = async () => {
    setMessage(null);
    try {
      setSetup(await api('/api/admin/2fa/setup', { method: 'POST' }));
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/2fa/enable', { method: 'POST', body: { code } });
      setCodes(r.recovery_codes);
      setSetup(null);
      setCode('');
      setMessage({ ok: true, text: 'Two-factor login is on.' });
      setReload((n) => n + 1);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  };

  const disable = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/2fa/disable', { method: 'POST', body: { code } });
      setCode('');
      setCodes(null);
      setMessage({ ok: true, text: 'Two-factor login is off.' });
      setReload((n) => n + 1);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  };

  return (
    <Layout>
      <section className="admin-top">
        <h1>Security</h1>
        <div className="row"><Link className="btn ghost" to="/admin">Back to notes</Link></div>
      </section>
      {message && <p className={`flash ${message.ok ? 'ok' : 'err'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      {error && <p className="flash err" role="alert">{error.message}</p>}

      {codes && (
        <div className="card panel">
          <span className="tab">Recovery codes</span>
          <p>Save these somewhere safe (a password manager is best). Each one signs you in once if your phone is lost. You won’t see them again.</p>
          <ul className="codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        </div>
      )}

      {data && (
        <div className="card panel">
          <span className="tab">Two-factor login</span>
          {data.enabled ? (
            <>
              <p><b>On.</b> Signing in needs your password and a code from your authenticator app. {data.recovery_left} recovery code{data.recovery_left === 1 ? '' : 's'} left.</p>
              <form onSubmit={disable}>
                <label htmlFor="off-code">To turn it off, enter a current code</label>
                <div className="inline-edit">
                  <input id="off-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
                  <button type="submit" className="ghost">Turn off</button>
                </div>
              </form>
            </>
          ) : setup ? (
            <form onSubmit={enable}>
              <p>1. Scan this with Google Authenticator, 1Password, Authy or a similar app.</p>
              <img className="qr" src={setup.qr} width="220" height="220" alt="QR code for your authenticator app" />
              <p className="muted">Can’t scan? Type this key instead: <code className="secret">{setup.secret}</code></p>
              <label htmlFor="on-code">2. Enter the 6-digit code the app shows</label>
              <div className="inline-edit">
                <input id="on-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
                <button type="submit">Turn on</button>
              </div>
            </form>
          ) : (
            <>
              <p><b>Off.</b> Right now your password alone opens the admin. With two-factor login, a stolen password isn’t enough.</p>
              <p className="row"><button type="button" onClick={start}>Set up two-factor login</button></p>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
