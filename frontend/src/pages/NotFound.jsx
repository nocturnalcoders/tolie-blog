import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useDocumentTitle } from '../hooks.js';

export default function NotFound({ message }) {
  useDocumentTitle('Lost in the woods · tolie.space notes');
  return (
    <Layout>
      <div className="card empty lost">
        <span className="tab">404</span>
        <h1>You wandered off the path</h1>
        <p>{message || 'That page doesn’t exist, or the note hasn’t been published yet.'}</p>
        <p><Link className="btn" to="/">Back to the notes</Link></p>
      </div>
    </Layout>
  );
}
