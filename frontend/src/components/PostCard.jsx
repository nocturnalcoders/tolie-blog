import { Link } from 'react-router-dom';
import { formatDate } from '../utils.js';

export default function PostCard({ post }) {
  return (
    <article className="card post-card">
      <span className="tab">{post.topic ? post.topic.name : post.tags[0] || 'Note'}</span>
      <h2><Link to={`/post/${post.slug}`}>{post.title}</Link></h2>
      <p className="meta">{formatDate(post.date)} · {post.read_min} min read</p>
      <p className="excerpt">{post.excerpt}</p>
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
