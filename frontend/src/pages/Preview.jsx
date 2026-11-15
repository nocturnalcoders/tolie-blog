import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { PostArticle, PostHeader } from '../components/PostBody.jsx';
import NotFound from './NotFound.jsx';
import { useApi, useDocumentTitle } from '../hooks.js';

// A draft opened through its secret link. Not indexed, no comments or reactions.
export default function Preview() {
  const { token } = useParams();
  const { data, error } = useApi(`/api/preview/${encodeURIComponent(token)}`);
  const post = data && data.post;
  useDocumentTitle(post ? `Preview: ${post.title} · tolie.space notes` : undefined);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  if (error && error.status === 404) return <NotFound message={error.message} />;
  return (
    <Layout>
      {post && (
        <>
          <p className="flash ok preview-banner" role="status">
            {post.live
              ? <>This note is already out. <Link to={`/post/${post.slug}`}>Read it here</Link>.</>
              : 'A preview of a note that isn’t published yet. Please don’t share this link.'}
          </p>
          <PostHeader post={post} />
          <PostArticle post={post} />
        </>
      )}
    </Layout>
  );
}
