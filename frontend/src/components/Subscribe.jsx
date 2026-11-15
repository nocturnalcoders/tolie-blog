import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';

// "Get new notes by email". Hidden until the server can send mail.
export default function Subscribe() {
  const { mail } = useAuth();
  const topics = useApi(mail ? '/api/topics' : null);
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState([]);
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  if (!mail) return null;

  const list = topics.data ? topics.data.topics : [];
  const toggle = (slug) => setChosen((c) => (c.includes(slug) ? c.filter((s) => s !== slug) : [...c, slug]));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      await api('/api/subscribe', { method: 'POST', body: { email, topics: chosen, website } });
      setFlash({ ok: true, text: 'Almost there: check your inbox and click the link to confirm.' });
      setEmail('');
    } catch (err) {
      setFlash({ ok: false, text: err.message });
    }
    setBusy(false);
  };

  return (
    <section className="card panel subscribe" aria-labelledby="subscribe-title">
      <span className="tab">Letters</span>
      <h2 id="subscribe-title">Get new notes by email</h2>
      <p className="muted">One email when a note goes out. No spam, and every email has a one-click unsubscribe.</p>
      <form onSubmit={onSubmit}>
        <div className="hp" aria-hidden="true">
          <label htmlFor="sub-website">Website</label>
          <input id="sub-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        {list.length > 0 && (
          <fieldset className="sub-topics">
            <legend>Only some topics? <small>(leave all unticked for everything)</small></legend>
            {list.map((t) => (
              <label key={t.slug} className="check">
                <input type="checkbox" checked={chosen.includes(t.slug)} onChange={() => toggle(t.slug)} /> {t.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="inline-edit">
          <label className="sr" htmlFor="sub-email">Your email</label>
          <input id="sub-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Subscribe'}</button>
        </div>
        {flash && <p className={`flash ${flash.ok ? 'ok' : 'err'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</p>}
      </form>
    </section>
  );
}
