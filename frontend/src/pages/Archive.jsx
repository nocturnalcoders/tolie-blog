import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Subscribe from '../components/Subscribe.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Archive() {
  const { data, error, loading } = useApi('/api/archive');
  const [params, setParams] = useSearchParams();
  useDocumentTitle('Archive · tolie.space notes');

  const posts = data ? data.posts : [];
  const years = [...new Set(posts.map((p) => p.date.slice(0, 4)))]; // newest first, like the posts
  const year = years.includes(params.get('year')) ? params.get('year') : years[0];
  // One year at a time, split by month.
  const months = [];
  posts.filter((p) => p.date.startsWith(year)).forEach((p) => {
    const m = Number(p.date.slice(5, 7)) - 1;
    if (!months.length || months[months.length - 1].m !== m) months.push({ m, posts: [] });
    months[months.length - 1].posts.push(p);
  });

  return (
    <Layout>
      <section className="hero">
        <div>
          <h1>Archive</h1>
          <p>{data ? `${posts.length} note${posts.length === 1 ? '' : 's'} so far.` : 'Every note, by date.'}</p>
        </div>
      </section>

      {years.length > 1 && (
        <nav className="segments" aria-label="Years">
          {years.map((y) => (
            <button key={y} type="button" className={`seg${y === year ? ' on' : ''}`} aria-pressed={y === year} onClick={() => setParams({ year: y }, { replace: true })}>
              {y}
            </button>
          ))}
        </nav>
      )}

      {loading && !data && <p className="note">Loading…</p>}
      {error && <div className="card empty"><span className="tab">Oops</span><p>{error.message}</p></div>}
      {data && posts.length === 0 && <div className="card empty"><span className="tab">Quiet</span><p>No notes yet.</p></div>}

      {year && (
        <section className="card archive" aria-labelledby="archive-year">
          <span className="tab" id="archive-year">{year}</span>
          {months.map(({ m, posts: list }) => (
            <div key={m} className="archive-month">
              <h2>{MONTHS[m]}</h2>
              <ol>
                {list.map((p) => (
                  <li key={p.slug}>
                    <span className="day">{Number(p.date.slice(8, 10))}</span>
                    <Link to={`/post/${p.slug}`}>{p.title}</Link>
                    {p.topic && <Link className="topic-chip" to={`/topic/${p.topic.slug}`}>{p.topic.name}</Link>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}
      <Subscribe />
    </Layout>
  );
}
