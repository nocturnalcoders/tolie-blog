import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';
import { formatDate } from '../utils.js';

const RANGES = [7, 30, 90];
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

function countryLabel(code) {
  if (!code) return 'Unknown';
  const flag = String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  let name = code;
  try {
    name = (regionNames && regionNames.of(code)) || code;
  } catch {
    /* unknown code */
  }
  return `${flag} ${name}`;
}

// Round the top of the axis up to 1, 2 or 5 × 10^n so the ticks are clean numbers.
function niceMax(value) {
  if (value <= 4) return 4;
  const step = value / 4;
  const pow = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 5, 10].find((m) => m * pow >= step) * pow;
  return nice * 4;
}

// A column with a 4px rounded top and a square foot on the baseline.
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Draw the chart at its real pixel width, so axis text stays the same size on every screen.
function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function DailyChart({ daily }) {
  const [active, setActive] = useState(null);
  const [ref, W] = useWidth(720);
  const H = 220, left = 36, right = 8, top = 12, bottom = 26;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = niceMax(Math.max(...daily.map((d) => d.views)));
  const slot = plotW / daily.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const shown = active === null ? daily.length - 1 : active;
  const day = daily[shown];
  const labelIdx = [0, Math.floor((daily.length - 1) / 2), daily.length - 1];

  return (
    <>
      <p className="readout" aria-live="polite">
        <b>{day.views.toLocaleString()}</b> views · {day.visitors.toLocaleString()} visitors
        <span> on {formatDate(day.day)}</span>
      </p>
      <div ref={ref}>
        <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Views per day for the last ${daily.length} days`} onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => {
            const y = top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line className="grid" x1={left} x2={W - right} y1={y} y2={y} />
                <text className="axis" x={left - 8} y={y + 4} textAnchor="end">{compact.format(t)}</text>
              </g>
            );
          })}
          {daily.map((d, i) => {
            const h = (d.views / max) * plotH;
            const x = left + i * slot + (slot - barW) / 2;
            return (
              <g
                key={d.day}
                className={`col${i === active ? ' on' : ''}`}
                tabIndex={0}
                aria-label={`${formatDate(d.day)}: ${d.views} views, ${d.visitors} visitors`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect className="hit" x={left + i * slot} y={top} width={slot} height={plotH} />
                {h > 0 && <path d={columnPath(x, top + plotH - h, barW, h)} />}
              </g>
            );
          })}
          {labelIdx.map((i, n) => (
            <text key={n} className="axis" x={left + i * slot + slot / 2} y={H - 6} textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}>
              {formatDate(daily[i].day).replace(/ \d{4}$/, '')}
            </text>
          ))}
        </svg>
      </div>
      <details className="table-view">
        <summary>Show as a table</summary>
        <div className="table-scroll">
          <table className="posts">
            <thead><tr><th>Day</th><th>Views</th><th>Visitors</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day}><td>{formatDate(d.day)}</td><td>{d.views}</td><td>{d.visitors}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function RankTable({ title, rows, label, empty }) {
  const top = rows.length ? rows[0].views : 0;
  return (
    <div className="card table-card">
      <span className="tab">{title}</span>
      <div className="table-scroll">
        <table className="posts rank">
          <thead><tr><th>{label}</th><th className="num">Views</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.cell}
                  <span className="meter" aria-hidden="true"><i style={{ width: `${(r.views / top) * 100}%` }} /></span>
                </td>
                <td className="num">{r.views.toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={2}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Stats() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useApi(`/api/admin/stats?days=${days}`);
  useDocumentTitle('Traffic · tolie.space notes');

  return (
    <Layout wide>
      <section className="admin-top">
        <h1>Traffic</h1>
        <div className="row">
          {RANGES.map((n) => (
            <button key={n} className={n === days ? undefined : 'ghost'} type="button" aria-pressed={n === days} onClick={() => setDays(n)}>
              {n} days
            </button>
          ))}
          <Link className="btn ghost" to="/admin">Back to notes</Link>
        </div>
      </section>
      {error && <p className="flash err" role="alert">{error.message}</p>}
      {loading && !data && <p className="note">Loading…</p>}
      {data && (
        <>
          <div className="card">
            <span className="tab">Last {data.days} days</span>
            <dl className="tiles">
              <div><dt>Views</dt><dd>{compact.format(data.views)}</dd></div>
              <div><dt>Visitors <small>(per day, added up)</small></dt><dd>{compact.format(data.visitors)}</dd></div>
              <div><dt>Comments</dt><dd>{compact.format(data.comments)}</dd></div>
              <div><dt>Reactions</dt><dd>{compact.format(data.reactions)}</dd></div>
            </dl>
          </div>
          <div className="card">
            <span className="tab">Views per day</span>
            <DailyChart daily={data.daily} />
          </div>
          <RankTable
            title="Top pages"
            label="Page"
            empty="No visits yet."
            rows={data.pages.map((p) => ({ key: p.path, views: p.views, cell: <Link to={p.path}>{p.title || (p.path === '/' ? 'Home' : p.path)}</Link> }))}
          />
          <div className="stats-pair">
            <RankTable
              title="Where people come from"
              label="Site"
              empty="No outside links yet."
              rows={data.referrers.map((r) => ({ key: r.host, views: r.views, cell: r.host }))}
            />
            <RankTable
              title="Countries"
              label="Country"
              empty="No visits yet."
              rows={(data.countries || []).map((c) => ({ key: c.country || '-', views: c.views, cell: countryLabel(c.country) }))}
            />
          </div>
          <RankTable
            title="Devices"
            label="Device"
            empty="No visits yet."
            rows={data.devices.map((d) => ({ key: d.device, views: d.views, cell: d.device === 'mobile' ? 'Phone / tablet' : 'Desktop' }))}
          />
          <p className="note">
            Your own visits while signed in, admin pages, and bots aren’t counted. No cookies are set and no IP addresses are stored.
            {' '}Countries: <a href="https://db-ip.com" rel="noopener noreferrer">IP Geolocation by DB-IP</a>
            {data.geoip === false && ' (the country database isn’t installed yet, it downloads on the next deploy)'}.
          </p>
        </>
      )}
    </Layout>
  );
}
