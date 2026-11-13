import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Post from './pages/Post.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Editor from './pages/Editor.jsx';
import Moderation from './pages/Moderation.jsx';
import NotFound from './pages/NotFound.jsx';
import Stats from './pages/Stats.jsx';
import Tags from './pages/Tags.jsx';
import { usePageViews } from './hooks.js';

function RequireAdmin({ children }) {
  const { ready, admin } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <Layout>
        <p className="note">Loading…</p>
      </Layout>
    );
  }
  if (!admin) {
    return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}

export default function App() {
  usePageViews();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/tag/:tag" element={<Home />} />
      <Route path="/tags" element={<Tags />} />
      <Route path="/post/:slug" element={<Post />} />
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
      <Route path="/admin/comments" element={<RequireAdmin><Moderation /></RequireAdmin>} />
      <Route path="/admin/stats" element={<RequireAdmin><Stats /></RequireAdmin>} />
      <Route path="/admin/new" element={<RequireAdmin><Editor /></RequireAdmin>} />
      <Route path="/admin/edit/:id" element={<RequireAdmin><Editor /></RequireAdmin>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
