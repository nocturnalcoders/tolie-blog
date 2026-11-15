import { useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import PostCard from '../components/PostCard.jsx';
import NotFound from './NotFound.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

export default function Series() {
  const { slug } = useParams();
  const { data, error } = useApi(`/api/series/${encodeURIComponent(slug)}`);
  useDocumentTitle(data ? `${data.series.name} · tolie.space notes` : undefined);
  if (error && error.status === 404) return <NotFound message={error.message} />;

  return (
    <Layout>
      {data && (
        <>
          <section className="hero">
            <div>
              <h1>{data.series.name}</h1>
              <p>A series in {data.posts.length} part{data.posts.length === 1 ? '' : 's'}, best read in order.</p>
            </div>
          </section>
          <ol className="series-list">
            {data.posts.map((p, i) => (
              <li key={p.slug}>
                <span className="part-no" aria-hidden="true">{i + 1}</span>
                <PostCard post={p} />
              </li>
            ))}
          </ol>
        </>
      )}
      {error && error.status !== 404 && <div className="card empty"><span className="tab">Oops</span><p>{error.message}</p></div>}
    </Layout>
  );
}
