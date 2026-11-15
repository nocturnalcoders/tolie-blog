import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Prose from '../components/Prose.jsx';
import Subscribe from '../components/Subscribe.jsx';
import { useAuth } from '../auth.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

export default function About() {
  const { admin } = useAuth();
  const { data, error } = useApi('/api/about');
  useDocumentTitle('About · tolie.space notes');

  return (
    <Layout>
      <section className="hero">
        <img className="avatar" src="/avatar.jpg" width="96" height="96" alt="Ghibli-style portrait of Christianto Lie" />
        <div>
          <h1>About</h1>
          <p>Who writes these notes, and why.</p>
        </div>
      </section>
      {error && <div className="card empty"><span className="tab">Oops</span><p>{error.message}</p></div>}
      {data && (
        <article className="card article">
          <span className="tab">Hello</span>
          <Prose html={data.html} />
          {admin && <p className="row"><Link className="btn ghost" to="/admin/about">Edit this page</Link></p>}
        </article>
      )}
      <Subscribe />
    </Layout>
  );
}
