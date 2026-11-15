import { act, render, screen, waitFor, within } from '@testing-library/react';
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

  it('home shows only the most used tags, with a link to all of them', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ tag: `t${i}`, count: 20 - i }));
    const be = fakeBackend({ ...publicRoutes, 'GET /api/tags': () => [200, { tags: many, total: 340 }] });
    renderAt('/tag/rare-one');
    const list = await screen.findByRole('list', { name: 'Tags' });
    expect(within(list).getAllByRole('link')).toHaveLength(14); // 12 + the open tag + "All tags"
    expect(within(list).getByRole('link', { name: '#rare-one' })).toHaveClass('on');
    expect(within(list).getByRole('link', { name: 'All 340 tags →' })).toHaveAttribute('href', '/tags');
    expect(be.calls.some((c) => c.url === '/api/tags?limit=12')).toBe(true);
  });

  it('tags page shows one segment at a time, with search across all tags', async () => {
    const many = Array.from({ length: 75 }, (_, i) => ({ tag: `p${i}`, count: 1 }));
    fakeBackend({ 'GET /api/tags': () => [200, { tags: [
      { tag: 'python', count: 9 }, { tag: 'anime', count: 8 }, { tag: 'futsal', count: 7 }, { tag: 'pydantic', count: 6 }, { tag: '3d', count: 5 }, ...many,
    ], total: 80 }] });
    renderAt('/tags');
    expect(await screen.findByText('80 tags across the notes.')).toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Tags by letter' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Popular', '#', 'A', 'F', 'P']);
    // Popular: the 30 most used, in that order
    expect(within(bar).getByRole('button', { name: 'Popular tags' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('link', { name: /^#/ }).slice(0, 2).map((l) => l.textContent)).toEqual(['#python 9', '#anime 8']);
    expect(screen.getAllByRole('link', { name: /^#/ })).toHaveLength(30);

    // one letter: A to Z inside, 60 at a time
    await userEvent.click(within(bar).getByRole('button', { name: 'Tags starting with P' }));
    expect(screen.queryByRole('link', { name: /anime/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^#p/ })).toHaveLength(60);
    expect(screen.getAllByRole('link', { name: /^#p/ }).slice(0, 3).map((l) => l.textContent)).toEqual(['#p0 1', '#p1 1', '#p2 1']);
    await userEvent.click(screen.getByRole('button', { name: 'Show more (17 left)' }));
    expect(screen.getAllByRole('link', { name: /^#p/ })).toHaveLength(77);

    // search looks at every tag, whatever segment is open
    await userEvent.type(screen.getByRole('searchbox'), '#ani');
    expect(screen.getAllByRole('link', { name: /^#/ }).map((l) => l.textContent)).toEqual(['#anime 8']);
  });

  it('tags page opens the letter from the link', async () => {
    fakeBackend({ 'GET /api/tags': () => [200, { tags: [{ tag: 'futsal', count: 2 }, { tag: 'anime', count: 3 }], total: 2 }] });
    renderAt('/tags?letter=F');
    expect(await screen.findByRole('button', { name: 'Tags starting with F' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('link', { name: /^#/ }).map((l) => l.textContent)).toEqual(['#futsal 2']);
  });

  it('home has a topic bar; a topic page lists only that topic', async () => {
    const topics = [
      { slug: 'software', name: 'Software', count: 4 }, { slug: 'security', name: 'Security', count: 2 }, { slug: 'hardware', name: 'Hardware', count: 0 },
    ];
    const be = fakeBackend({ ...publicRoutes, 'GET /api/topics': () => [200, { topics }] });
    renderAt('/');
    const bar = await screen.findByRole('navigation', { name: 'Topics' });
    expect(within(bar).getAllByRole('link').map((l) => l.textContent)).toEqual(['All', 'Software', 'Security']); // empty ones hidden
    expect(within(bar).getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(bar).getByRole('link', { name: 'Security' }));
    expect(await screen.findByRole('heading', { name: 'Notes on Security' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Topics' })).getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(be.calls.some((c) => c.url === '/api/posts?topic=security')).toBe(true));
  });

  it('post cards and the post page show the topic', async () => {
    fakeBackend({
      'GET /api/posts/hello': () => [200, {
        post: { ...POSTS[0], status: 'published', html: '<p>x</p>', topic: { slug: 'security', name: 'Security' } }, prev: null, next: null,
      }],
    });
    renderAt('/post/hello');
    expect(await screen.findByRole('link', { name: 'Security' })).toHaveAttribute('href', '/topic/security');
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
    const downloads = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function save() { downloads.push(this.download); });
    await userEvent.click(within(share).getByRole('button', { name: 'Instagram / TikTok story' }));
    expect(await within(share).findByRole('status')).toHaveTextContent('Story picture saved');
    expect(downloads).toEqual(['hello-story.png']);
    click.mockRestore();
    expect(be.calls.some((c) => c.url === '/og/hello/story.png')).toBe(true);
  });

  it('code blocks get a Copy button', async () => {
    fakeBackend({
      'GET /api/posts/hello': () => [200, {
        post: { ...POSTS[0], status: 'published', html: '<div class="codehilite"><pre><span></span><code>print("hi")\n</code></pre></div>' },
        prev: null, next: null,
      }],
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/post/hello');
    const btn = await screen.findByRole('button', { name: 'Copy' });
    await userEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith('print("hi")');
    expect(btn).toHaveTextContent('Copied');
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
    act(() => screen.getByLabelText('9 Nov 2026: 2 views, 1 visitors').focus());
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
      'POST /api/admin/upload': () => { n += 1; return [200, { url: `/uploads/${'a'.repeat(15)}${n}.png`, original_size: 4 * 1024 * 1024, size: 200 * 1024 }]; },
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
    expect(await screen.findByRole('status')).toHaveTextContent('2 images added (8.0 MB → 400 KB).');
  });

  it('editor rejects files that are not images', async () => {
    const be = fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    renderAt('/admin/new');
    await screen.findByLabelText('Write in Markdown');
    await userEvent.upload(screen.getByLabelText('Choose an image'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPG, GIF, and WebP');
    expect(be.calls.some((c) => c.url === '/api/admin/upload')).toBe(false);
  });

  it('editor saves the chosen topic', async () => {
    const be = fakeBackend({
      'POST /api/admin/preview': () => [200, { html: '' }],
      'GET /api/admin/topics': () => [200, { topics: [{ id: 3, slug: 'security', name: 'Security', count: 0 }, { id: 4, slug: 'hardware', name: 'Hardware', count: 0 }] }],
      'POST /api/admin/posts': () => [201, { post: { id: 9, slug: 'chips', title: 'Chips', excerpt: '', tags: [], status: 'draft', body: '', topic_id: 4 } }],
      'GET /api/admin/posts/9': () => [200, { post: { id: 9, slug: 'chips', title: 'Chips', excerpt: '', tags: [], status: 'draft', body: '', topic_id: 4 } }],
    }, { admin: true });
    renderAt('/admin/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Chips');
    await screen.findByRole('option', { name: 'Hardware' });
    await userEvent.selectOptions(screen.getByLabelText(/^Topic/), 'Hardware');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(be.calls.some((c) => c.url === '/api/admin/posts')).toBe(true));
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/admin/posts').body)).toMatchObject({ title: 'Chips', topic_id: 4 });
    // reopened for editing, the topic is still picked
    await waitFor(() => expect(screen.getByLabelText(/^Topic/)).toHaveValue('4'));
  });

  it('topics page adds, renames, reorders and deletes topics', async () => {
    let topics = [{ id: 1, slug: 'software', name: 'Software', count: 3 }, { id: 2, slug: 'security', name: 'Security', count: 1 }];
    const be = fakeBackend({
      'GET /api/admin/topics': () => [200, { topics }],
      'POST /api/admin/topics': (_u, o) => { topics = [...topics, { id: 3, slug: 'microchips', name: JSON.parse(o.body).name, count: 0 }]; return [201, { topics }]; },
      'PUT /api/admin/topics/2': (_u, o) => { topics = topics.map((t) => (t.id === 2 ? { ...t, name: JSON.parse(o.body).name } : t)); return [200, { topics }]; },
      'POST /api/admin/topics/order': (_u, o) => { const ids = JSON.parse(o.body).ids; topics = ids.map((id) => topics.find((t) => t.id === id)); return [200, { topics }]; },
      'DELETE /api/admin/topics/1': () => { topics = topics.filter((t) => t.id !== 1); return [200, { topics }]; },
    }, { admin: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/admin/topics');
    const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).queryAllByRole('link')[0]?.textContent);

    await userEvent.type(await screen.findByLabelText('New topic'), 'Microchips');
    await userEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Added “Microchips”.');

    await userEvent.click(within(screen.getAllByRole('row')[2]).getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New name for Security');
    await userEvent.clear(input);
    await userEvent.type(input, 'Cyber security{enter}');
    expect(await screen.findByRole('link', { name: 'Cyber security' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Move Microchips up' }));
    await waitFor(() => expect(names()).toEqual(['Software', 'Microchips', 'Cyber security']));
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/admin/topics/order').body)).toEqual({ ids: [1, 3, 2] });

    await userEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete the topic “Software”? Its 3 posts will have no topic, but stay published.');
    await waitFor(() => expect(names()).toEqual(['Microchips', 'Cyber security']));
  });

  it('editor refuses to save without a title', async () => {
    const be = fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    renderAt('/admin/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the post a title first.');
    expect(be.calls.some((c) => c.url === '/api/admin/posts')).toBe(false);
  });

  it('login asks for the authenticator code when two-factor is on', async () => {
    const be = fakeBackend({
      'POST /api/login': (_u, opts) => {
        const body = JSON.parse(opts.body);
        if (!body.code) return [401, { error: 'Enter the 6-digit code from your authenticator app.', need_code: true }];
        return body.code === '123456' ? [200, { admin: true, csrf: 'tok-9' }] : [401, { error: 'That code didn’t work.', need_code: true }];
      },
      'GET /api/admin/posts': () => [200, { posts: [] }],
    });
    renderAt('/admin/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'chris');
    await userEvent.type(screen.getByLabelText('Password'), 'right-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText(/Code from your authenticator app/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // not an error, just the next step
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code didn’t work.');
    await userEvent.clear(code);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your notes' })).toBeInTheDocument();
    expect(JSON.parse(be.calls.filter((c) => c.url === '/api/login').pop().body)).toEqual({ username: 'chris', password: 'right-password-1', code: '123456' });
  });

  it('security page sets up two-factor login and shows recovery codes', async () => {
    let on = false;
    fakeBackend({
      'GET /api/admin/2fa': () => [200, { enabled: on, recovery_left: on ? 8 : 0 }],
      'POST /api/admin/2fa/setup': () => [200, { secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', uri: 'otpauth://totp/x', qr: 'data:image/svg+xml,qr' }],
      'POST /api/admin/2fa/enable': (_u, o) => {
        if (JSON.parse(o.body).code !== '654321') return [400, { error: 'That code didn’t work.' }];
        on = true;
        return [200, { enabled: true, recovery_codes: ['aaaaa-11111', 'bbbbb-22222'] }];
      },
    }, { admin: true });
    renderAt('/admin/security');
    await userEvent.click(await screen.findByRole('button', { name: 'Set up two-factor login' }));
    expect(await screen.findByAltText('QR code for your authenticator app')).toHaveAttribute('src', 'data:image/svg+xml,qr');
    expect(screen.getByText('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Enter the 6-digit code/), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('aaaaa-11111')).toBeInTheDocument();
    expect(await screen.findByText(/8 recovery codes left/)).toBeInTheDocument();
  });

  it('editor keeps unsaved text on this device and offers it back', async () => {
    fakeBackend({ 'POST /api/admin/preview': () => [200, { html: '' }] }, { admin: true });
    const first = renderAt('/admin/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Half-written');
    await userEvent.type(screen.getByLabelText('Write in Markdown'), 'Do not lose me');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tolie-draft:new')).form.body).toBe('Do not lose me'), { timeout: 2000 });
    first.unmount();

    renderAt('/admin/new');
    const banner = await screen.findByText(/You have unsaved changes from/);
    expect(screen.getByLabelText('Write in Markdown')).toHaveValue('');
    await userEvent.click(within(banner.closest('.restore')).getByRole('button', { name: 'Restore them' }));
    expect(screen.getByLabelText('Write in Markdown')).toHaveValue('Do not lose me');
    expect(screen.getByLabelText('Title')).toHaveValue('Half-written');
  });

  it('editor schedules a post for later', async () => {
    const be = fakeBackend({
      'POST /api/admin/preview': () => [200, { html: '' }],
      'POST /api/admin/posts': (_u, o) => [201, { post: { id: 5, slug: 'later', title: 'Later', excerpt: '', tags: [], status: 'published', scheduled: true, publish_at: JSON.parse(o.body).publish_at, body: '' } }],
      'GET /api/admin/posts/5': () => [200, { post: { id: 5, slug: 'later', title: 'Later', excerpt: '', tags: [], status: 'published', scheduled: true, publish_at: '2030-01-02T01:00:00Z', body: '' } }],
    }, { admin: true });
    renderAt('/admin/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Later');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule…' }));
    const when = screen.getByLabelText('Publish on');
    await userEvent.clear(when);
    await userEvent.type(when, '2030-01-02T08:00');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(be.calls.some((c) => c.url === '/api/admin/posts')).toBe(true));
    const sent = JSON.parse(be.calls.find((c) => c.url === '/api/admin/posts').body);
    expect(sent.action).toBe('schedule');
    expect(new Date(sent.publish_at).getTime()).toBe(new Date('2030-01-02T08:00').getTime());
    expect(await screen.findByText(/Scheduled to go out on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unschedule' })).toBeInTheDocument();
  });

  it('dashboard sets the topic of several notes at once and marks scheduled ones', async () => {
    let posts = [
      { ...POSTS[0], status: 'published', updated_at: '2026-11-12T10:00:00Z', topic_id: null },
      { ...POSTS[1], status: 'published', scheduled: true, publish_at: '2030-01-02T01:00:00Z', updated_at: '2026-11-13T10:00:00Z', topic_id: null },
    ];
    const be = fakeBackend({
      'GET /api/admin/posts': () => [200, { posts }],
      'GET /api/admin/topics': () => [200, { topics: [{ id: 7, slug: 'security', name: 'Security', count: 0 }] }],
      'POST /api/admin/posts/topic': (_u, o) => { const b = JSON.parse(o.body); posts = posts.map((p) => (b.ids.includes(p.id) ? { ...p, topic_id: b.topic_id } : p)); return [200, { updated: b.ids.length }]; },
    }, { admin: true });
    renderAt('/admin');
    expect(await screen.findByText(/scheduled · 2 Jan 2030/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all notes' }));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Security' });
    await userEvent.selectOptions(screen.getByLabelText('Topic for the selected notes'), 'Security');
    await userEvent.click(screen.getByRole('button', { name: 'Set topic' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 notes moved to Security.');
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/admin/posts/topic').body)).toEqual({ ids: [1, 2], topic_id: 7 });
    await waitFor(() => expect(screen.getAllByRole('cell', { name: 'Security' })).toHaveLength(2));
  });
});

describe('about, archive, letters, pictures, replies', () => {
  const withMail = { 'GET /api/session': () => [200, { admin: false, csrf: 'tok-123', configured: true, mail: true }] };

  it('header lanterns lead to the archive and about pages', async () => {
    fakeBackend(publicRoutes);
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /Archive/ })).toHaveAttribute('href', '/archive');
    expect(within(nav).getByRole('link', { name: /About/ })).toHaveAttribute('href', '/about');
  });

  it('about page shows the text, and a subscribe box when mail is on', async () => {
    const be = fakeBackend({
      ...withMail,
      'GET /api/about': () => [200, { html: '<p>Hi, I build things.</p>' }],
      'GET /api/topics': () => [200, { topics: [{ slug: 'security', name: 'Security', count: 3 }] }],
      'POST /api/subscribe': () => [200, { ok: true }],
    });
    renderAt('/about');
    expect(await screen.findByText('Hi, I build things.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Security' }));
    await userEvent.type(screen.getByLabelText('Your email'), 'me@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByRole('status')).toHaveTextContent('check your inbox');
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/subscribe').body)).toEqual({ email: 'me@example.com', topics: ['security'], website: '' });
  });

  it('no subscribe box while mail is off', async () => {
    fakeBackend({ 'GET /api/about': () => [200, { html: '<p>Hi</p>' }] });
    renderAt('/about');
    await screen.findByText('Hi');
    expect(screen.queryByRole('heading', { name: 'Get new notes by email' })).not.toBeInTheDocument();
  });

  it('archive shows one year at a time, by month', async () => {
    fakeBackend({ 'GET /api/archive': () => [200, { posts: [
      { slug: 'b', title: 'Second', date: '2026-11-13T10:00:00Z', topic: { slug: 'security', name: 'Security' } },
      { slug: 'a', title: 'First', date: '2026-03-02T10:00:00Z', topic: null },
      { slug: 'old', title: 'Old one', date: '2025-12-31T10:00:00Z', topic: null },
    ] }] });
    renderAt('/archive');
    expect(await screen.findByText('3 notes so far.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['November', 'March']);
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute('href', '/topic/security');
    expect(screen.queryByText('Old one')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(screen.getByRole('link', { name: 'Old one' })).toHaveAttribute('href', '/post/old');
  });

  it('confirm link confirms; unsubscribe waits for a click', async () => {
    const be = fakeBackend({
      'POST /api/subscribe/confirm': () => [200, { ok: true, topics: [] }],
      'POST /api/unsubscribe': () => [200, { ok: true }],
    });
    const view = renderAt('/subscribe/confirm?token=abc');
    expect(await screen.findByRole('heading', { name: 'You’re in' })).toBeInTheDocument();
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/subscribe/confirm').body)).toEqual({ token: 'abc' });
    view.unmount();

    renderAt('/unsubscribe?token=xyz');
    expect(await screen.findByRole('heading', { name: 'Unsubscribe?' })).toBeInTheDocument();
    expect(be.calls.some((c) => c.url === '/api/unsubscribe')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeInTheDocument();
    expect(JSON.parse(be.calls.find((c) => c.url === '/api/unsubscribe').body)).toEqual({ token: 'xyz' });
  });

  it('pictures in a note open large and close with Escape', async () => {
    fakeBackend({
      'GET /api/posts/hello': () => [200, { post: { ...POSTS[0], status: 'published', html: '<p><img src="/uploads/cat.webp" alt="A sleepy cat"></p>' }, prev: null, next: null }],
    });
    renderAt('/post/hello');
    const pic = await screen.findByRole('button', { name: 'Open picture: A sleepy cat' });
    await userEvent.click(pic);
    const dialog = screen.getByRole('dialog', { name: 'A sleepy cat' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', expect.stringContaining('/uploads/cat.webp'));
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pic).toHaveFocus();
  });

  it('comments show replies under their comment, and a reply can ask for an email', async () => {
    const be = fakeBackend({
      ...withMail,
      'GET /api/posts/hello': () => [200, { post: { ...POSTS[0], status: 'published', html: '<p>x</p>' }, prev: null, next: null }],
      'GET /api/posts/hello/comments': () => [200, { comments: [
        { id: 1, author: 'Ana', body: 'Nice', by_author: false, parent_id: null, date: '2026-11-13T10:00:00Z' },
        { id: 2, author: 'Christianto Lie', body: 'Thanks Ana', by_author: true, parent_id: 1, date: '2026-11-13T11:00:00Z' },
      ] }],
      'POST /api/posts/hello/comments': () => [201, { pending: true }],
    });
    renderAt('/post/hello');
    const replies = await screen.findByRole('list', { name: 'Replies to Ana' });
    expect(within(replies).getByText('Thanks Ana')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]);
    expect(screen.getByText(/Replying to/)).toHaveTextContent('Replying to Ana');
    await userEvent.type(screen.getByLabelText('Name'), 'Budi');
    await userEvent.type(screen.getByLabelText(/^Comment/), 'Same here');
    const notify = screen.getByRole('checkbox', { name: 'Email me when someone replies' });
    expect(notify).toBeDisabled(); // needs an email first
    await userEvent.type(screen.getByLabelText(/^Email \(optional/), 'budi@example.com');
    await userEvent.click(notify);
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(await screen.findByText(/once I’ve read it/)).toBeInTheDocument();
    expect(JSON.parse(be.calls.find((c) => c.method === 'POST' && c.url === '/api/posts/hello/comments').body))
      .toEqual({ name: 'Budi', body: 'Same here', website: '', parent_id: 1, email: 'budi@example.com', notify: true });
  });
});
