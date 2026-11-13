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
os.environ.update(BLOG_DB_SCHEMA=SCHEMA, BLOG_UPLOAD_DIR=tmp, BLOG_OG_DIR=os.path.join(tmp, 'og'), BLOG_FRONTEND_DIST=dist,
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
ok('tags', c.get('/api/tags').json['tags'][0]['count'] == 1 and c.get('/api/tags').json['total'] == 2)
ok('tags limit keeps the total', len(c.get('/api/tags?limit=1').json['tags']) == 1 and c.get('/api/tags?limit=1').json['total'] == 2)
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
from PIL import Image
def img_bytes(fmt, size=(40, 30), **kw):
    b = io.BytesIO(); Image.new('RGB', size, (200, 80, 40)).save(b, fmt, **kw); return b.getvalue()
def upload(data, name='pic'):
    return c.post('/api/admin/upload', data={'file': (io.BytesIO(data), name)}, headers={'X-CSRF-Token': tok}, content_type='multipart/form-data')
png = img_bytes('PNG')
up = upload(png, 'pic.png'); ok('upload png', up.status_code == 200 and up.json['url'].startswith('/uploads/') and up.json['url'].endswith('.webp'))
ok('upload served immutable', 'immutable' in c.get(up.json['url']).headers['Cache-Control'])
ok('png kept pixel-exact (lossless)', Image.open(io.BytesIO(c.get(up.json['url']).data)).convert('RGB').getpixel((5, 5)) == (200, 80, 40))
# a big phone photo, taken sideways, with a GPS position in it
exif = Image.Exif(); exif[0x0112] = 6; exif[0x8825] = {1: 'S', 2: (6.0, 10.0, 0.0)}
photo = img_bytes('JPEG', (4000, 3000), quality=95, exif=exif)
up = upload(photo, 'IMG_0001.jpg'); got = Image.open(io.BytesIO(c.get(up.json['url']).data))
ok('photo shrunk to 1600 wide, turned upright', up.status_code == 200 and got.format == 'WEBP' and got.size == (1600, 2133))
ok('photo has no GPS / EXIF left', not got.getexif() and b'Exif' not in c.get(up.json['url']).data)
ok('upload reports the saving', up.json['size'] < up.json['original_size'])
frames = [Image.new('RGB', (20, 20), c) for c in ((255, 0, 0), (0, 0, 255))]; gb = io.BytesIO(); frames[0].save(gb, 'GIF', save_all=True, append_images=frames[1:], duration=100, loop=0)
up = upload(gb.getvalue(), 'dance.gif'); ok('animated gif kept as is', up.json['url'].endswith('.gif') and c.get(up.json['url']).data == gb.getvalue())
ok('broken image rejected', upload(b'\x89PNG\r\n\x1a\n' + b'\x00' * 40, 'bad.png').status_code == 400)
ok('svg rejected', c.post('/api/admin/upload', data={'file': (io.BytesIO(b'<svg onload=alert(1)>'), 'x.svg')}, headers={'X-CSRF-Token': tok}, content_type='multipart/form-data').status_code == 400)
ok('oversize rejected', upload(png + b'0' * (15 * 1024 * 1024), 'b.png').status_code in (400, 413))
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

ok('country from Cloudflare header', track(anon, '/tag/meta', '', {'User-Agent': 'Mozilla/5.0 (X11) Firefox/130', 'CF-IPCountry': 'ID'}).status_code == 204
   and {'country': 'ID', 'views': 1} in c.get('/api/admin/stats?days=7').json['countries'])

# notifications
sent = []
real_notify = A.notify
A.notify = lambda subject, text: sent.append((subject, text))
w2 = A.app.test_client()
J(w2, 'post', f'/api/posts/{H}/comments', {'name': 'Rina', 'body': 'Lovely lanterns'}, csrf(w2))
J(c, 'post', f'/api/posts/{H}/comments', {'name': 'x', 'body': 'Author reply'}, tok)
ok('notify on new comment, not on own reply', len(sent) == 1 and 'Rina' in sent[0][0] and 'Hello from the little town' in sent[0][0]
   and 'Lovely lanterns' in sent[0][1] and '/admin/comments' in sent[0][1])
A.notify = real_notify
posted = []
class _Res:
    def read(self): return b'{}'
real_urlopen = A.urllib.request.urlopen
A.urllib.request.urlopen = lambda url, data=None, timeout=None: posted.append((url, data)) or _Res()
A.TELEGRAM_TOKEN, A.TELEGRAM_CHAT_ID = '123:abc', '42'
A.deliver('New comment', 'hello there')
ok('telegram message', posted and posted[0][0] == 'https://api.telegram.org/bot123:abc/sendMessage' and b'chat_id=42' in posted[0][1] and b'hello+there' in posted[0][1])
A.urllib.request.urlopen = real_urlopen
A.TELEGRAM_TOKEN = A.TELEGRAM_CHAT_ID = ''

# table of contents + read next
pj = anon.get(f'/api/posts/{H}').json
ok('toc from headings', [x['title'] for x in pj['post']['toc']] == ['What to expect', 'Code looks like this'] and all(f'id="{x["id"]}"' in pj['post']['html'] for x in pj['post']['toc']))
ok('read next lists other published posts', [r['slug'] for r in pj['related']] == ['my-first-draft-2'] and 'body' not in pj['related'][0])
ok('preview still returns html', 'id=' in J(c, 'post', '/api/admin/preview', {'md': '## A & B'}, tok).json['html'])
ok('images load lazily', '<img loading="lazy"' in A.render_post('![a](/uploads/x.webp)')[0])
ok('toc unescapes titles', A.render_post('## Tom & Jerry <3')[1][0]['title'] == 'Tom & Jerry <3')

# share pictures
r = anon.get(f'/og/{H}/card.png')
ok('share card png 1200x630', r.status_code == 200 and r.mimetype == 'image/png' and Image.open(io.BytesIO(r.data)).size == (1200, 630))
ok('story png 1080x1920', Image.open(io.BytesIO(anon.get(f'/og/{H}/story.png').data)).size == (1080, 1920))
ok('share picture is cached', anon.get(f'/og/{H}/card.png').data == r.data)
ok('no share picture for drafts or unknown kinds', anon.get(f'/og/{slug}/card.png').status_code == 404 and anon.get(f'/og/{H}/huge.png').status_code == 404)
shell = anon.get(f'/post/{H}').get_data(as_text=True)
ok('post shell has og:image + large twitter card', f'og:image" content="https://blog.example.test/og/{H}/card.png"' in shell and 'summary_large_image' in shell and 'og:url' in shell)

# topics
tp = anon.get('/api/topics').json['topics']
ok('starter topics in order', [x['name'] for x in tp] == ['Software', 'Security', 'Hardware', 'Football', 'Anime & Books', 'Life'] and tp[4]['slug'] == 'anime-books' and all(x['count'] == 0 for x in tp))
ok('topics admin needs login', anon.get('/api/admin/topics').status_code == 401 and J(v, 'post', '/api/admin/topics', {'name': 'x'}, vt).status_code == 401)
r = J(c, 'post', '/api/admin/topics', {'name': '  Micro   chips '}, tok)
ok('create topic', r.status_code == 201 and r.json['topics'][-1]['name'] == 'Micro chips' and r.json['topics'][-1]['slug'] == 'micro-chips')
ok('duplicate / empty topic refused', J(c, 'post', '/api/admin/topics', {'name': 'micro chips'}, tok).status_code == 400 and J(c, 'post', '/api/admin/topics', {'name': ' '}, tok).status_code == 400)
ids = {x['slug']: x['id'] for x in c.get('/api/admin/topics').json['topics']}
r = J(c, 'put', f"/api/admin/topics/{ids['micro-chips']}", {'name': 'Hardware & Chips'}, tok)
ok('rename keeps the address', [x for x in r.json['topics'] if x['id'] == ids['micro-chips']][0] == {'id': ids['micro-chips'], 'slug': 'micro-chips', 'name': 'Hardware & Chips', 'count': 0})
order = [ids['security'], ids['micro-chips']] + [i for k, i in ids.items() if k not in ('security', 'micro-chips')]
ok('reorder', [x['slug'] for x in J(c, 'post', '/api/admin/topics/order', {'ids': order}, tok).json['topics']][:2] == ['security', 'micro-chips'])
r = J(c, 'post', '/api/admin/posts', {'title': 'XSS in 2026', 'body': 'Escape it.', 'tags': 'xss', 'topic_id': ids['security'], 'action': 'publish'}, tok)
ok('post saved with topic', r.status_code == 201 and r.json['post']['topic_id'] == ids['security'] and r.json['post']['topic'] == {'slug': 'security', 'name': 'Security'})
sec_id = r.json['post']['id']
ok('unknown topic refused', J(c, 'post', '/api/admin/posts', {'title': 'x', 'topic_id': 999999}, tok).status_code == 400)
ok('filter by topic', [p['slug'] for p in anon.get('/api/posts?topic=security').json['posts']] == ['xss-in-2026'] and anon.get('/api/posts?topic=nope').json['total'] == 0)
ok('public topic counts published posts', {x['slug']: x['count'] for x in anon.get('/api/topics').json['topics']}['security'] == 1)
ok('post page carries its topic', anon.get('/api/posts/xss-in-2026').json['post']['topic']['name'] == 'Security' and anon.get(f'/api/posts/{H}').json['post']['topic'] is None)
J(c, 'delete', f"/api/admin/topics/{ids['security']}", None, tok)
ok('deleting a topic keeps its posts', anon.get('/api/posts/xss-in-2026').status_code == 200 and anon.get('/api/posts/xss-in-2026').json['post']['topic'] is None)
for x in c.get('/api/admin/topics').json['topics']:
    J(c, 'delete', f"/api/admin/topics/{x['id']}", None, tok)
A.init_db()
ok('starter topics are not brought back after you delete them', anon.get('/api/topics').json['topics'] == [])
J(c, 'delete', f'/api/admin/posts/{sec_id}', None, tok)

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
