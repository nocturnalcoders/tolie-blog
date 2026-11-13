"""Backend tests. Needs a PostgreSQL database:

    DATABASE_URL=postgresql://blog:secret@localhost:5432/blog python tests/test_api.py

Everything runs inside a throw-away schema that is dropped at the end.
"""
import http.server, io, os, secrets, sys, tempfile, threading, xml.dom.minidom
from pathlib import Path

if not os.environ.get("DATABASE_URL"):
    sys.exit("Set DATABASE_URL to a PostgreSQL database first (see the docstring).")
tmp = tempfile.mkdtemp(); dist = tempfile.mkdtemp()
Path(dist, 'index.html').write_text('<!doctype html><html><head><title>Notes</title><meta name="description" content="x"><!--ssr-meta--></head><body><div id="root"></div></body></html>')
Path(dist, 'assets').mkdir(); Path(dist, 'assets', 'a.js').write_text('//js')

# a tiny web server that plays the part of the "web" container (serves index.html)
class _H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=dist, **k)
    def log_message(self, *a): pass
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), _H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from werkzeug.security import generate_password_hash
SCHEMA = 't_' + secrets.token_hex(6)
os.environ.update(BLOG_DB_SCHEMA=SCHEMA, BLOG_UPLOAD_DIR=tmp, BLOG_FRONTEND_DIST=dist,
                  BLOG_SHELL_URL=f'http://127.0.0.1:{httpd.server_address[1]}/index.html',
                  BLOG_SECRET_KEY='x'*64, BLOG_ADMIN_USER='chris',
                  BLOG_ADMIN_HASH=generate_password_hash('correct horse battery'), BLOG_COOKIE_SECURE='0',
                  BLOG_SITE_URL='https://blog.example.test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as A
c = A.app.test_client()
def ok(name, cond):
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond: sys.exit(1)
def csrf(cl): return cl.get('/api/session').json['csrf']
def J(cl, method, url, body=None, tok=None):
    h = {'X-CSRF-Token': tok} if tok else {}
    return getattr(cl, method)(url, json=body, headers=h)

# public API
r = c.get('/api/posts'); ok('list 200 + seed', r.status_code == 200 and r.json['total'] == 1 and r.json['posts'][0]['slug'] == 'hello-from-the-little-town')
ok('summary has no body/status for public', 'body' not in r.json['posts'][0] and 'status' not in r.json['posts'][0])
r = c.get('/api/posts/hello-from-the-little-town'); ok('post html + code + nav', r.status_code == 200 and 'codehilite' in r.json['post']['html'] and r.json['prev'] is None and r.json['next'] is None)
ok('tags', c.get('/api/tags').json['tags'][0]['count'] == 1)
ok('tag filter', c.get('/api/posts?tag=meta').json['total'] == 1 and c.get('/api/posts?tag=nope').json['total'] == 0)
ok('search + literal wildcard', c.get('/api/posts?q=little').json['total'] == 1 and c.get('/api/posts?q=%25').json['total'] == 0)
ok('search is case-insensitive', c.get('/api/posts?q=LITTLE').json['total'] == 1)
ok('init_db is safe to run again (several workers)', A.init_db() is None and c.get('/api/posts').json['total'] == 1)
ok('missing post 404 json', c.get('/api/posts/nope').status_code == 404 and c.get('/api/posts/nope').json['error'])
feed = c.get('/feed.xml'); xml.dom.minidom.parseString(feed.data); ok('feed xml', b'blog.example.test/post/hello' in feed.data)
xml.dom.minidom.parseString(c.get('/sitemap.xml').data); ok('sitemap xml', True)
ok('robots/healthz', b'Disallow: /admin' in c.get('/robots.txt').data and c.get('/healthz').data == b'ok')

# SPA shell + SEO
r = c.get('/post/hello-from-the-little-town').get_data(as_text=True)
ok('post shell has injected meta', 'og:title' in r and 'Hello from the little town' in r and 'rel="canonical" href="https://blog.example.test/post/hello-from-the-little-town"' in r and '<!--ssr-meta-->' not in r)
ok('unknown post shell is 404 but still the app', c.get('/post/zzz').status_code == 404 and 'id="root"' in c.get('/post/zzz').get_data(as_text=True))
ok('fallback serves index + assets', 'id="root"' in c.get('/').get_data(as_text=True) and c.get('/assets/a.js').status_code == 200 and 'id="root"' in c.get('/admin/edit/3').get_data(as_text=True))
ok('fallback blocks traversal & api', c.get('/..%2f..%2fetc/passwd').status_code in (200, 404) and 'root:' not in c.get('/..%2f..%2fetc/passwd').get_data(as_text=True) and c.get('/api/zzz').status_code == 404)

# auth
ok('admin api needs login', c.get('/api/admin/posts').status_code == 401 and J(c, 'post', '/api/admin/posts', {'title': 'x'}).status_code == 401)
ok('session anon', c.get('/api/session').json['admin'] is False)
tok = csrf(c)
ok('login without csrf rejected', c.post('/api/login', json={'username': 'chris', 'password': 'correct horse battery'}).status_code == 400)
ok('wrong password', J(c, 'post', '/api/login', {'username': 'chris', 'password': 'nope'}, tok).status_code == 401)
r = J(c, 'post', '/api/login', {'username': 'chris', 'password': 'correct horse battery'}, tok); ok('login ok', r.status_code == 200 and r.json['admin'] is True)
tok = r.json['csrf']
ok('session admin', c.get('/api/session').json['admin'] is True)
ok('old csrf token no longer valid after login', J(c, 'post', '/api/admin/preview', {'md': 'x'}, 'stale').status_code == 400)

# CRUD
body = "## Heading\n\nHello <script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(2)>\n\n```python\nprint('hi')\n```\n"
r = J(c, 'post', '/api/admin/posts', {'title': 'My First Draft!', 'tags': 'Python, Football, python', 'body': body, 'action': 'draft'}, tok)
ok('create draft 201', r.status_code == 201 and r.json['post']['status'] == 'draft' and r.json['post']['tags'] == ['python', 'football'])
pid = r.json['post']['id']; slug = r.json['post']['slug']
anon = A.app.test_client()
ok('draft hidden from public list + page', anon.get('/api/posts/' + slug).status_code == 404 and slug not in anon.get('/api/posts').get_data(as_text=True))
ok('admin can read draft', c.get('/api/posts/' + slug).status_code == 200)
html = c.get('/api/posts/' + slug).json['post']['html']
ok('XSS stripped', '<script' not in html and 'onerror' not in html and 'javascript:' not in html and 'codehilite' in html)
ok('admin get returns markdown body', c.get(f'/api/admin/posts/{pid}').json['post']['body'] == body)
r = J(c, 'put', f'/api/admin/posts/{pid}', {'title': 'My First Draft!', 'tags': 'python', 'excerpt': 'Custom summary', 'body': body, 'action': 'publish'}, tok)
ok('publish via PUT', r.status_code == 200 and r.json['post']['status'] == 'published')
ok('published is public', anon.get('/api/posts/' + slug).status_code == 200 and 'Custom summary' in anon.get('/api/posts').get_data(as_text=True))
r = J(c, 'post', '/api/admin/posts', {'title': 'My First Draft!', 'body': 'x', 'action': 'publish'}, tok)
ok('slug collision suffix', r.json['post']['slug'] == 'my-first-draft-2'); pid2 = r.json['post']['id']
ok('prev/next linking uses (date, id) ordering', c.get('/api/posts/my-first-draft-2').json['prev']['slug'] == slug and c.get('/api/posts/' + slug).json['next']['slug'] == 'my-first-draft-2' and c.get('/api/posts/hello-from-the-little-town').json['next']['slug'] == slug)
ok('empty title 400', J(c, 'post', '/api/admin/posts', {'title': '  '}, tok).status_code == 400)
ok('csrf required on save', J(c, 'put', f'/api/admin/posts/{pid}', {'title': 'x'}).status_code == 400)
ok('missing post 404', J(c, 'put', '/api/admin/posts/9999', {'title': 'x'}, tok).status_code == 404)
ok('admin list has status', all('status' in p for p in c.get('/api/admin/posts').json['posts']))
ok('unpublish keeps published_at for re-publish', J(c, 'put', f'/api/admin/posts/{pid}', {'title': 'My First Draft!', 'body': body, 'action': 'draft'}, tok).json['post']['status'] == 'draft')

# preview + upload
pj = J(c, 'post', '/api/admin/preview', {'md': '# Hi <b onclick=x>there</b>'}, tok); ok('preview sanitised', pj.status_code == 200 and 'onclick' not in pj.json['html'] and '<h1' in pj.json['html'])
png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 40
up = c.post('/api/admin/upload', data={'file': (io.BytesIO(png), 'pic.png')}, headers={'X-CSRF-Token': tok}, content_type='multipart/form-data'); ok('upload png', up.status_code == 200 and up.json['url'].startswith('/uploads/'))
ok('upload served immutable', 'immutable' in c.get(up.json['url']).headers['Cache-Control'])
ok('svg rejected', c.post('/api/admin/upload', data={'file': (io.BytesIO(b'<svg onload=alert(1)>'), 'x.svg')}, headers={'X-CSRF-Token': tok}, content_type='multipart/form-data').status_code == 400)
ok('oversize rejected', c.post('/api/admin/upload', data={'file': (io.BytesIO(png + b'0' * (5 * 1024 * 1024)), 'b.png')}, headers={'X-CSRF-Token': tok}, content_type='multipart/form-data').status_code in (400, 413))
ok('upload traversal blocked', c.get('/uploads/..%2fblog.db').status_code == 404 and c.get('/uploads/evil.png').status_code == 404)

# comments + moderation
H = 'hello-from-the-little-town'
v = A.app.test_client(); vt = csrf(v)
ok('comment needs csrf', v.post(f'/api/posts/{H}/comments', json={'name': 'Ana', 'body': 'Hi'}).status_code == 400)
ok('comment validates', J(v, 'post', f'/api/posts/{H}/comments', {'name': ' ', 'body': 'Hi there'}, vt).status_code == 400 and J(v, 'post', f'/api/posts/{H}/comments', {'name': 'Ana', 'body': 'x'}, vt).status_code == 400)
ok('comment on draft 404', J(v, 'post', f'/api/posts/{slug}/comments', {'name': 'Ana', 'body': 'Hi there'}, vt).status_code == 404)
r = J(v, 'post', f'/api/posts/{H}/comments', {'name': 'Ana', 'body': '<script>alert(1)</script> nice post'}, vt)
ok('comment held for review', r.status_code == 201 and r.json['pending'] is True and v.get(f'/api/posts/{H}/comments').json['comments'] == [])
ok('honeypot pretends success but saves nothing', J(v, 'post', f'/api/posts/{H}/comments', {'name': 'Bot', 'body': 'buy now', 'website': 'spam.example'}, vt).json['pending'] is True)
ok('moderation needs admin', v.get('/api/admin/comments').status_code == 401 and J(v, 'put', '/api/admin/comments/1', None, vt).status_code == 401)
q = c.get('/api/admin/comments').json
ok('admin sees pending', q['pending'] == 1 and len(q['comments']) == 1 and q['comments'][0]['post_slug'] == H)
cid = q['comments'][0]['id']
ok('approve', J(c, 'put', f'/api/admin/comments/{cid}', None, tok).status_code == 200 and c.get('/api/admin/comments').json['pending'] == 0)
pub = v.get(f'/api/posts/{H}/comments').json['comments']
ok('approved is public, body kept as plain text, no ip', len(pub) == 1 and pub[0]['body'].startswith('<script>') and 'ip' not in pub[0] and 'status' not in pub[0])
r = J(c, 'post', f'/api/posts/{H}/comments', {'name': 'Someone', 'body': 'Thanks Ana!'}, tok)
ok('author reply is approved and marked', r.json['pending'] is False and r.json['comment']['by_author'] is True and r.json['comment']['author'] == 'Christianto Lie')
ok('3 comments per 10 minutes', all(J(v, 'post', f'/api/posts/{H}/comments', {'name': 'Ana', 'body': b}, vt).status_code == 201 for b in ('second', 'third')))
ok('comment rate limit', J(v, 'post', f'/api/posts/{H}/comments', {'name': 'Ana', 'body': 'fourth'}, vt).status_code == 429)
pend = [x['id'] for x in c.get('/api/admin/comments').json['comments']]
ok('delete comment', len(pend) == 2 and all(J(c, 'delete', f'/api/admin/comments/{i}', None, tok).status_code == 200 for i in pend) and c.get('/api/admin/comments').json['pending'] == 0)
ok('approve missing 404', J(c, 'put', '/api/admin/comments/99999', None, tok).status_code == 404)

# reactions
ok('reactions start at zero', v.get(f'/api/posts/{H}/reactions').json == {'counts': {'heart': 0, 'clap': 0, 'laugh': 0, 'wow': 0}, 'mine': []})
ok('reaction needs csrf + known kind', v.post(f'/api/posts/{H}/reactions', json={'kind': 'heart'}).status_code == 400 and J(v, 'post', f'/api/posts/{H}/reactions', {'kind': 'poop'}, vt).status_code == 400)
r = J(v, 'post', f'/api/posts/{H}/reactions', {'kind': 'heart'}, vt)
ok('react', r.status_code == 200 and r.json['counts']['heart'] == 1 and r.json['mine'] == ['heart'])
ok('other visitor sees count, not as theirs', anon.get(f'/api/posts/{H}/reactions').json['counts']['heart'] == 1 and anon.get(f'/api/posts/{H}/reactions').json['mine'] == [])
r = J(v, 'post', f'/api/posts/{H}/reactions', {'kind': 'heart'}, vt)
ok('react again toggles off', r.json['counts']['heart'] == 0 and r.json['mine'] == [])
for _ in range(3):
    w = A.app.test_client(); J(w, 'post', f'/api/posts/{H}/reactions', {'kind': 'wow'}, csrf(w))
w = A.app.test_client()
ok('same address capped (cleared cookies)', J(w, 'post', f'/api/posts/{H}/reactions', {'kind': 'wow'}, csrf(w)).status_code == 429)
ok('reactions on draft 404', v.get(f'/api/posts/{slug}/reactions').status_code == 404)

# traffic
UA = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1'}
def track(cl, path, ref='', ua=UA): return cl.post('/api/track', json={'path': path, 'referrer': ref}, headers=ua)
ok('track view', track(v, f'/post/{H}', 'https://www.google.com/search?q=x').status_code == 204)
track(v, f'/post/{H}')                                   # reload within 30s: not counted again
track(v, '/', 'https://blog.example.test/post/x')       # own site is not a referrer
track(anon, '/', '', {'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/130'})
track(anon, '/', '', {'User-Agent': 'Googlebot/2.1'})    # bots ignored
track(anon, '/admin', '', {'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/130'})  # admin pages ignored
track(anon, f'/post/{slug}', '', {'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/130'})  # drafts ignored
track(c, '/', '', {'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/130'})  # your own visits ignored
ok('stats need admin', v.get('/api/admin/stats').status_code == 401)
st = c.get('/api/admin/stats?days=7').json
ok('stats totals', st['views'] == 3 and st['visitors'] == 2 and len(st['daily']) == 7 and st['daily'][-1]['views'] == 3)
ok('stats top pages', st['pages'][0] == {'path': '/', 'title': None, 'views': 2, 'visitors': 2} and st['pages'][1]['title'] == 'Hello from the little town')
ok('stats referrers + devices', st['referrers'] == [{'host': 'google.com', 'views': 1}] and {d['device']: d['views'] for d in st['devices']} == {'mobile': 2, 'desktop': 1})
ok('stats counts comments + reactions', st['comments'] >= 1 and st['reactions'] >= 3)
ok('stats bad range falls back to 30', c.get('/api/admin/stats?days=5').json['days'] == 30)

# delete / logout / lockout
ok('delete', J(c, 'delete', f'/api/admin/posts/{pid2}', None, tok).status_code == 200 and c.get(f'/api/posts/my-first-draft-2').status_code == 404)
r = J(c, 'post', '/api/logout', None, tok); ok('logout', r.json['admin'] is False and c.get('/api/admin/posts').status_code == 401)
b = A.app.test_client()
for i in range(5):
    t = csrf(b); J(b, 'post', '/api/login', {'username': 'chris', 'password': f'bad{i}'}, t)
r = J(b, 'post', '/api/login', {'username': 'chris', 'password': 'correct horse battery'}, csrf(b))
ok('lockout after 5 failures', r.status_code == 429)
import psycopg
with psycopg.connect(os.environ['DATABASE_URL']) as conn:
    conn.execute(f'DROP SCHEMA "{SCHEMA}" CASCADE')
print('\nALL API CHECKS PASSED')
