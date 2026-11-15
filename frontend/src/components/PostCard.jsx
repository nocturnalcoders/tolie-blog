import { Link } from 'react-router-dom';
import { formatDate } from '../utils.js';

export default function PostCard({ post }) {
  return (
    <article className="card post-card">
      <span className="tab">{post.topic ? post.topic.name : post.tags[0] || 'Note'}</span>
      <h2><Link to={`/post/${post.slug}`}>{post.title}</Link></h2>
      <p className="meta">
        {formatDate(post.date)} · {post.read_min} min read
        {post.lang === 'id' && <span className="lang-badge" title="Bahasa Indonesia">ID</span>}
      </p>
      {post.snippet && post.snippet.length > 0 ? (
        // A search result: the matching words are bold. Parts are plain text from the API.
        <p className="excerpt snippet">… {post.snippet.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))} …</p>
      ) : (
        <p className="excerpt">{post.excerpt}</p>
      )}
      {post.tags.length > 0 && (
        <ul className="tags">
          {post.tags.map((t) => (
            <li key={t}><Link to={`/tag/${t}`}>#{t}</Link></li>
          ))}
        </ul>
      )}
    </article>
  );
}
