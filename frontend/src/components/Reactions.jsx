import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';

const KINDS = [
  { kind: 'heart', emoji: '❤️', label: 'Love it' },
  { kind: 'clap', emoji: '👏', label: 'Applause' },
  { kind: 'laugh', emoji: '😂', label: 'Funny' },
  { kind: 'wow', emoji: '🤯', label: 'Mind blown' },
];

export default function Reactions({ slug }) {
  const path = `/api/posts/${encodeURIComponent(slug)}/reactions`;
  const { data } = useApi(path);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = latest || data;
  if (!state) return null;

  const toggle = async (kind) => {
    setBusy(true);
    setError('');
    try {
      setLatest(await api(path, { method: 'POST', body: { kind } }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <section className="reactions" aria-label="Reactions">
      {KINDS.map(({ kind, emoji, label }) => (
        <button
          key={kind}
          type="button"
          className={`react${state.mine.includes(kind) ? ' on' : ''}`}
          aria-pressed={state.mine.includes(kind)}
          aria-label={`${label}, ${state.counts[kind]}`}
          disabled={busy}
          onClick={() => toggle(kind)}
        >
          <span aria-hidden="true">{emoji}</span> {state.counts[kind]}
        </button>
      ))}
      {error && <p className="note" role="alert">{error}</p>}
    </section>
  );
}
