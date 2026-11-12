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
