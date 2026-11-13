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
    return { ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) };
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

  it('post page shows comments, holds a new one for review, and toggles a reaction', async () => {
    const be = fakeBackend({
      'GET /api/posts/hello': () => [200, { post: { ...POSTS[0], status: 'published', html: '<p>Body</p>' }, prev: null, next: null }],
      'GET /api/posts/hello/comments': () => [200, { comments: [
        { id: 1, author: 'Ana', body: 'Nice <b>post</b>', by_author: false, date: '2026-11-13T10:00:00Z' },
        { id: 2, author: 'Christianto Lie', body: 'Thanks!', by_author: true, date: '2026-11-13T11:00:00Z' },
      ] }],
      'POST /api/posts/hello/comments': () => [201, { pending: true }],
      'GET /api/posts/hello/reactions': () => [200, { counts: { heart: 2, clap: 0, laugh: 0, wow: 1 }, mine: [] }],
      'POST /api/posts/hello/reactions': () => [200, { counts: { heart: 3, clap: 0, laugh: 0, wow: 1 }, mine: ['heart'] }],
    });
    renderAt('/post/hello');
    expect(await screen.findByRole('heading', { name: '2 comments' })).toBeInTheDocument();
    expect(screen.getByText('Nice <b>post</b>')).toBeInTheDocument(); // shown as text, never as HTML
    expect(screen.getByText('author')).toBeInTheDocument();

    const heart = await screen.findByRole('button', { name: 'Love it, 2' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(heart);
    expect(await screen.findByRole('button', { name: 'Love it, 3' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.type(screen.getByLabelText('Name'), 'Budi');
    await userEvent.type(screen.getByLabelText(/^Comment/), 'Great read');
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('once I’ve read it');
    const sent = be.calls.find((c) => c.method === 'POST' && c.url === '/api/posts/hello/comments');
    expect(sent.headers['X-CSRF-Token']).toBe('tok-123');
    expect(JSON.parse(sent.body)).toEqual({ name: 'Budi', body: 'Great read', website: '' });
  });

  it('post page has a table of contents, read next, and share buttons', async () => {
    const be = fakeBackend({
      'GET /api/posts/hello': () => [200, {
        post: { ...POSTS[0], status: 'published', html: '<h2 id="a">A</h2><h3 id="b">B</h3><h2 id="c">C</h2>',
          toc: [{ id: 'a', title: 'A', level: 2 }, { id: 'b', title: 'B', level: 3 }, { id: 'c', title: 'C & D', level: 2 }] },
        prev: null, next: null,
        related: [{ ...POSTS[1] }],
      }],
      'GET /og/hello/story.png': () => [200, {}],
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    URL.createObjectURL = vi.fn(() => 'blob:story');
    URL.revokeObjectURL = vi.fn();
    renderAt('/post/hello');

    const toc = await screen.findByRole('navigation', { name: 'On this page' });
    expect(within(toc).getByRole('link', { name: 'C & D' })).toHaveAttribute('href', '#c');
    const next = screen.getByRole('region', { name: 'Read next' });
    expect(within(next).getByRole('link', { name: 'Futsal and code reviews' })).toHaveAttribute('href', '/post/futsal');

    const share = screen.getByRole('region', { name: 'Share this note' });
    expect(within(share).getByRole('link', { name: 'LinkedIn' }).getAttribute('href'))
      .toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/post/hello`)}`);
    await userEvent.click(within(share).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/post/hello`);
    expect(await within(share).findByRole('status')).toHaveTextContent('Link copied.');

    // no file sharing in this browser: the story picture is downloaded instead
    await userEvent.click(within(share).getByRole('button', { name: 'Instagram / TikTok story' }));
    expect(await within(share).findByRole('status')).toHaveTextContent('Story picture saved');
    expect(be.calls.some((c) => c.url === '/og/hello/story.png')).toBe(true);
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

  it('moderation page approves a waiting comment', async () => {
    let comments = [{ id: 5, author: 'Ana', body: 'Hello!', by_author: false, date: '2026-11-13T10:00:00Z', status: 'pending', post_slug: 'hello', post_title: 'Hello from the little town' }];
    const be = fakeBackend({
      'GET /api/admin/comments': () => [200, { comments, pending: comments.length }],
      'PUT /api/admin/comments/5': () => { comments = []; return [200, { ok: true }]; },
    }, { admin: true });
    renderAt('/admin/comments');
    expect(await screen.findByRole('button', { name: 'Waiting (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hello from the little town' })).toHaveAttribute('href', '/post/hello');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Nothing waiting. All caught up.')).toBeInTheDocument();
    expect(be.calls.find((c) => c.method === 'PUT').headers['X-CSRF-Token']).toBe('tok-123');
  });

  it('traffic page shows totals, the daily chart and top pages', async () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${i + 7}`, views: i, visitors: i ? 1 : 0 }));
    const be = fakeBackend({
      'GET /api/admin/stats': (url) => [200, {
        days: url.includes('days=7') ? 7 : 30, daily, views: 21, visitors: 6, comments: 2, reactions: 5,
        pages: [{ path: '/post/hello', title: 'Hello from the little town', views: 12, visitors: 4 }, { path: '/', title: null, views: 9, visitors: 5 }],
        referrers: [{ host: 'google.com', views: 3 }],
        devices: [{ device: 'mobile', views: 13 }, { device: 'desktop', views: 8 }],
        countries: [{ country: 'ID', views: 15 }, { country: '', views: 2 }], geoip: true,
      }],
    }, { admin: true });
    renderAt('/admin/stats');
    expect(await screen.findByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hello from the little town' })).toHaveAttribute('href', '/post/hello');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByText('google.com')).toBeInTheDocument();
    expect(screen.getByText('Phone / tablet')).toBeInTheDocument();
    expect(screen.getByText(/Indonesia/)).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    // the readout follows the focused day
    screen.getByLabelText('9 Nov 2026: 2 views, 1 visitors').focus();
    expect(await screen.findByText(/on 9 Nov 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(await screen.findByText('Last 7 days')).toBeInTheDocument();
    expect(be.calls.some((c) => c.url === '/api/admin/stats?days=7')).toBe(true);
  });

  it('page views are reported for public pages but not admin pages', async () => {
    const be = fakeBackend(publicRoutes);
    renderAt('/');
    await screen.findByRole('link', { name: 'Hello from the little town' });
    const track = be.calls.filter((c) => c.url === '/api/track');
    expect(track).toHaveLength(1);
    expect(JSON.parse(track[0].body)).toMatchObject({ path: '/' });

    const be2 = fakeBackend({}, { admin: true });
    renderAt('/admin/comments');
    await screen.findByRole('heading', { name: 'Comments' });
    expect(be2.calls.some((c) => c.url === '/api/track')).toBe(false);
  });

  it('editor puts an uploaded image where the cursor is, on its own line', async () => {
    let n = 0;
    fakeBackend({
      'POST /api/admin/preview': () => [200, { html: '' }],
      'POST /api/admin/upload': () => { n += 1; return [200, { url: `/uploads/${'a'.repeat(15)}${n}.png` }]; },
    }, { admin: true });
    renderAt('/admin/new');
    const body = await screen.findByLabelText('Write in Markdown');
    await userEvent.type(body, 'First paragraph. Second sentence.');
    // cursor right after "First paragraph."
    body.focus();
    body.setSelectionRange(16, 16);
    await userEvent.upload(screen.getByLabelText('Choose an image'), [
      new File(['x'], 'my-cat.png', { type: 'image/png' }),
      new File(['y'], 'beach_day.jpg', { type: 'image/jpeg' }),
    ]);
    await waitFor(() => expect(body.value).not.toContain('Uploading'));
    expect(body.value).toBe(
      `First paragraph.\n\n![my cat](/uploads/${'a'.repeat(15)}1.png)\n\n![beach day](/uploads/${'a'.repeat(15)}2.png)\n\nSecond sentence.`
    );
    expect(await screen.findByRole('status')).toHaveTextContent('2 images added.');
  });

  it('editor rejects files that are not images', async () => {
    const be = fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    renderAt('/admin/new');
    await screen.findByLabelText('Write in Markdown');
    await userEvent.upload(screen.getByLabelText('Choose an image'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPG, GIF, and WebP');
    expect(be.calls.some((c) => c.url === '/api/admin/upload')).toBe(false);
  });

  it('editor refuses to save without a title', async () => {
    const be = fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    renderAt('/admin/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the post a title first.');
    expect(be.calls.some((c) => c.url === '/api/admin/posts')).toBe(false);
  });
});
