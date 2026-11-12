import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

const POSTS = [
  { id: 1, slug: 'hello', title: 'Hello from the little town', excerpt: 'A first note.', tags: ['hello', 'meta'], date: '2026-11-12T10:00:00Z', read_min: 2 },
  { id: 2, slug: 'futsal', title: 'Futsal and code reviews', excerpt: 'Short passes.', tags: ['futsal'], date: '2026-11-13T10:00:00Z', read_min: 1 },
];

// A tiny fake backend: map "METHOD /path" to a handler(url, opts) -> [status, body].
function fakeBackend(routes, { admin = false } = {}) {
  const state = { admin, calls: [] };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(url).split('?')[0];
    state.calls.push({ method, url: String(url), headers: opts.headers || {}, body: opts.body });
    let handler = routes[`${method} ${path}`];
    if (!handler && method === 'GET' && path === '/api/session') {
      handler = () => [200, { admin: state.admin, csrf: 'tok-123', configured: true }];
    }
    if (!handler) return { ok: false, status: 404, json: async () => ({ error: 'Not found.' }) };
    const [status, body] = await handler(String(url), opts, state);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  return state;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

const publicRoutes = {
  'GET /api/posts': () => [200, { posts: POSTS, total: 2, page: 1, pages: 1, q: '', tag: '' }],
  'GET /api/tags': () => [200, { tags: [{ tag: 'futsal', count: 1 }, { tag: 'hello', count: 1 }] }],
};

describe('public pages', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('home lists posts and tags', async () => {
    fakeBackend(publicRoutes);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Notes from the little town' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Hello from the little town' })).toHaveAttribute('href', '/post/hello');
    expect(screen.getByText(/13 Nov 2026/)).toBeInTheDocument();
    const tagList = screen.getByRole('list', { name: 'Tags' });
    expect(within(tagList).getByRole('link', { name: /#futsal/ })).toHaveAttribute('href', '/tag/futsal');
  });

  it('search sends the query to the API', async () => {
    const be = fakeBackend(publicRoutes);
    renderAt('/');
    await screen.findByRole('link', { name: 'Hello from the little town' });
    await userEvent.type(screen.getByRole('searchbox'), 'little');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(be.calls.some((c) => c.url.includes('/api/posts?q=little'))).toBe(true));
  });

  it('tag page asks the API for that tag', async () => {
    const be = fakeBackend(publicRoutes);
    renderAt('/tag/futsal');
    expect(await screen.findByRole('heading', { name: 'Notes tagged #futsal' })).toBeInTheDocument();
    expect(be.calls.some((c) => c.url.includes('tag=futsal'))).toBe(true);
  });

  it('post page renders backend HTML and sets the title', async () => {
    fakeBackend({
      'GET /api/posts/hello': () => [200, {
        post: { ...POSTS[0], status: 'published', html: '<h2>What to expect</h2><p>Hello <b>world</b></p>' },
        prev: null,
        next: { slug: 'futsal', title: 'Futsal and code reviews' },
      }],
    });
    renderAt('/post/hello');
    expect(await screen.findByRole('heading', { name: 'What to expect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Hello from the little town' })).toBeInTheDocument();
    expect(document.title).toBe('Hello from the little town · tolie.space notes');
    expect(screen.getByRole('link', { name: /Futsal and code reviews →/ })).toHaveAttribute('href', '/post/futsal');
  });

  it('unknown post shows the not-found page', async () => {
    fakeBackend({ 'GET /api/posts/zzz': () => [404, { error: 'That note doesn’t exist, or it hasn’t been published yet.' }] });
    renderAt('/post/zzz');
    expect(await screen.findByText('You wandered off the path')).toBeInTheDocument();
  });

  it('theme button and the N key switch between night and daylight', async () => {
    fakeBackend(publicRoutes);
    renderAt('/');
    const btn = await screen.findByRole('button', { name: /night and daylight/i });
    expect(document.documentElement.getAttribute('data-theme')).toBe('night');
    await userEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('day');
    await userEvent.keyboard('n');
    expect(document.documentElement.getAttribute('data-theme')).toBe('night');
  });
});

describe('admin', () => {
  it('redirects to the login page when signed out', async () => {
    fakeBackend({});
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows an error for a wrong password, then signs in', async () => {
    let attempts = 0;
    const be = fakeBackend({
      'POST /api/login': (_u, opts) => {
        attempts += 1;
        const { password } = JSON.parse(opts.body);
        return password === 'right-password-1' ? [200, { admin: true, csrf: 'tok-456' }] : [401, { error: 'That username or password didn’t match.' }];
      },
      'GET /api/admin/posts': () => [200, { posts: [{ ...POSTS[0], status: 'published', updated_at: '2026-11-12T10:00:00Z' }] }],
    });
    renderAt('/admin/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'chris');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('didn’t match');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'right-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your notes' })).toBeInTheDocument();
    expect(attempts).toBe(2);
    // the login request carried the CSRF token from /api/session
    expect(be.calls.find((c) => c.url === '/api/login').headers['X-CSRF-Token']).toBe('tok-123');
  });

  it('dashboard deletes a post after confirming', async () => {
    let posts = [{ ...POSTS[0], status: 'published', updated_at: '2026-11-12T10:00:00Z' }];
    const be = fakeBackend({
      'GET /api/admin/posts': () => [200, { posts }],
      'DELETE /api/admin/posts/1': () => { posts = []; return [200, { ok: true }]; },
    }, { admin: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No notes yet. Write the first one.')).toBeInTheDocument();
    expect(be.calls.find((c) => c.method === 'DELETE').headers['X-CSRF-Token']).toBe('tok-123');
  });

  it('editor previews while typing and publishes with the CSRF header', async () => {
    const be = fakeBackend({
      'POST /api/admin/preview': (_u, opts) => [200, { html: `<p>rendered:${JSON.parse(opts.body).md}</p>` }],
      'POST /api/admin/posts': (_u, opts) => [201, { post: { id: 7, slug: 'my-note', title: 'My note', excerpt: '', tags: [], status: 'published', body: JSON.parse(opts.body).body } }],
      'GET /api/admin/posts/7': () => [200, { post: { id: 7, slug: 'my-note', title: 'My note', excerpt: '', tags: [], status: 'published', body: 'Body text' } }],
    }, { admin: true });
    renderAt('/admin/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'My note');
    await userEvent.type(screen.getByLabelText('Write in Markdown'), 'Body text');
    expect(await screen.findByText('rendered:Body text')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Published.');
    const save = be.calls.find((c) => c.method === 'POST' && c.url === '/api/admin/posts');
    expect(save.headers['X-CSRF-Token']).toBe('tok-123');
    expect(JSON.parse(save.body)).toMatchObject({ title: 'My note', body: 'Body text', action: 'publish' });
    // now editing the saved post: the primary button is "Save changes"
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('editor refuses to save without a title', async () => {
    const be = fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    renderAt('/admin/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the post a title first.');
    expect(be.calls.some((c) => c.url === '/api/admin/posts')).toBe(false);
  });
});
