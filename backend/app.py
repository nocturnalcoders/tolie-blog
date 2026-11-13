"""tolie.space blog backend: a small JSON API (Flask + PostgreSQL + Markdown).

The React frontend (../frontend) talks to this API. Public routes:

  GET  /api/posts?page=&q=&tag=      list published posts
  GET  /api/tags                     tags with counts
  GET  /api/posts/<slug>             one post (rendered HTML)
  GET/POST /api/posts/<slug>/comments    approved comments / leave one (held for review)
  GET/POST /api/posts/<slug>/reactions   reaction counts / toggle one
  POST /api/track                    count a page view (no cookies, no raw IPs stored)
  GET  /feed.xml  /sitemap.xml  /robots.txt  /healthz  /uploads/<file>
  GET  /og/<slug>/card.png  /og/<slug>/story.png   share pictures (link preview, Instagram/TikTok story)
  GET  /post/<slug>                  the React shell with SEO meta tags filled in

Admin routes need a signed-in session and a CSRF header:

  GET  /api/session                  {admin, csrf}
  POST /api/login   POST /api/logout
  GET/POST /api/admin/posts          list / create
  GET/PUT/DELETE /api/admin/posts/<id>
  POST /api/admin/preview  POST /api/admin/upload
  GET  /api/admin/comments?status=   PUT/DELETE /api/admin/comments/<id>
  GET  /api/admin/stats?days=7|30|90 traffic summary

Configuration comes from environment variables (docker-compose.yml sets them).
New comments can be announced on Telegram and/or by email (see .env.example).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html as html_lib
import os
import re
import secrets
import smtplib
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape as xml_escape

import markdown as md
import maxminddb
import nh3
import psycopg
from flask import (Flask, Response, abort, g, jsonify, request,
                   send_from_directory, session)
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

import share_image

BASE_DIR = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    """Optional .env reader for local development (Docker passes real env vars)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env(BASE_DIR / ".env")


def admin_hash_from_env() -> str:
    raw = os.environ.get("BLOG_ADMIN_HASH", "")
    if raw:
        return raw
    packed = os.environ.get("BLOG_ADMIN_HASH_B64", "").strip()
    if not packed or packed == "pending":
        return ""
    try:
        return base64.b64decode(packed).decode("utf-8")
    except Exception:
        return ""


DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://blog:blog@localhost:5432/blog")
DB_SCHEMA = os.environ.get("BLOG_DB_SCHEMA", "")  # optional, used by the tests
SECRET = os.environ.get("BLOG_SECRET_KEY", "")
ADMIN_USER = os.environ.get("BLOG_ADMIN_USER", "admin")
ADMIN_HASH = admin_hash_from_env()
SITE_URL = os.environ.get("BLOG_SITE_URL", "https://blog.tolie.space").rstrip("/")
DATA_DIR = Path(os.environ.get("BLOG_DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = Path(os.environ.get("BLOG_UPLOAD_DIR", str(DATA_DIR / "uploads")))
FRONTEND_DIST = Path(os.environ.get("BLOG_FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))
SHELL_URL = os.environ.get("BLOG_SHELL_URL", "")  # e.g. http://web/index.html inside Docker
COOKIE_SECURE = os.environ.get("BLOG_COOKIE_SECURE", "1") != "0"
OG_DIR = Path(os.environ.get("BLOG_OG_DIR", str(UPLOAD_DIR.parent / "og")))
GEOIP_DB = Path(os.environ.get("BLOG_GEOIP_DB", str(BASE_DIR / "geoip" / "country.mmdb")))
TELEGRAM_TOKEN = os.environ.get("BLOG_TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("BLOG_TELEGRAM_CHAT_ID", "")
SMTP_HOST = os.environ.get("BLOG_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("BLOG_SMTP_PORT", "587") or 587)
SMTP_USER = os.environ.get("BLOG_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("BLOG_SMTP_PASSWORD", "")
NOTIFY_EMAIL = os.environ.get("BLOG_NOTIFY_EMAIL", "")
PER_PAGE = 8
MAX_UPLOAD = 5 * 1024 * 1024
REACTIONS = ("heart", "clap", "laugh", "wow")
DUMMY_HASH = generate_password_hash(secrets.token_hex(8))

if DB_SCHEMA and not re.fullmatch(r"[a-z0-9_]+", DB_SCHEMA):
    raise SystemExit("BLOG_DB_SCHEMA may only contain a-z, 0-9 and _")

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # behind Caddy and nginx
app.config.update(
    SECRET_KEY=SECRET or secrets.token_hex(32),
    SESSION_COOKIE_NAME="tolie_blog",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=MAX_UPLOAD + 512 * 1024,
)

# --------------------------------------------------------------------------
# Database (PostgreSQL)
# --------------------------------------------------------------------------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS posts (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL DEFAULT '',
  tags         TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_posts_status_pub ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING GIN (tags);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip       TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  first_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id         BIGSERIAL PRIMARY KEY,
  post_id    BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  by_author  BOOLEAN NOT NULL DEFAULT false,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  ip         TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip, created_at);
CREATE TABLE IF NOT EXISTS reactions (
  post_id    BIGINT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  voter      TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, kind, voter)
);
CREATE TABLE IF NOT EXISTS page_views (
  id         BIGSERIAL PRIMARY KEY,
  path       TEXT NOT NULL,
  post_id    BIGINT REFERENCES posts (id) ON DELETE SET NULL,
  visitor    TEXT NOT NULL,
  referrer   TEXT NOT NULL DEFAULT '',
  device     TEXT NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_views_time ON page_views (created_at);
CREATE INDEX IF NOT EXISTS idx_views_visitor ON page_views (visitor, path, created_at);
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
"""

SEED_BODY = """This is the first note on the blog. It is written in Markdown, stored in PostgreSQL,
and served by a Python API to a React frontend, all running in Docker.

## What to expect

I will write about software, football, anime, books, movies, and the new tech I am
learning. Some notes will be long, some will be a few lines.

> A blog is a lantern you hang outside the house: small, but it tells people someone is home.

## Code looks like this

```python
def greet(name: str) -> str:
    return f"Hello, {name}. Welcome to the little town."

print(greet("traveller"))
```

Thanks for stopping by.
"""


def _configure(conn: psycopg.Connection) -> None:
    if DB_SCHEMA:
        conn.execute(f'SET search_path TO "{DB_SCHEMA}"')
    conn.commit()


pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=6, kwargs={"row_factory": dict_row},
                      configure=_configure, open=False)


def db() -> psycopg.Connection:
    if "db" not in g:
        g.db = pool.getconn()
    return g.db


@app.teardown_appcontext
def release_db(_exc) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        try:
            conn.rollback()
        finally:
            pool.putconn(conn)


def init_db() -> None:
    """Create tables and the welcome post. Safe to run from several workers at once."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for _ in range(30):  # the database container may still be starting
        try:
            with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
                conn.execute("SELECT pg_advisory_xact_lock(727001)")
                if DB_SCHEMA:
                    conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"')
                    conn.execute(f'SET LOCAL search_path TO "{DB_SCHEMA}"')
                conn.execute(SCHEMA_SQL)
                count = conn.execute("SELECT COUNT(*) AS n FROM posts").fetchone()["n"]
                if count == 0:
                    conn.execute(
                        "INSERT INTO posts (slug, title, excerpt, body_md, tags, status, published_at)"
                        " VALUES (%s, %s, %s, %s, %s, 'published', now())",
                        ("hello-from-the-little-town", "Hello from the little town",
                         "A first note: what this blog is, how it works, and what to expect.",
                         SEED_BODY, ["hello", "meta"]))
            break
        except psycopg.OperationalError as exc:
            last_error = exc
            time.sleep(1)
    else:
        raise RuntimeError(f"Could not reach the database: {last_error}")
    pool.open()
    pool.wait(timeout=30)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Markdown
# --------------------------------------------------------------------------
MD_EXTENSIONS = ["fenced_code", "codehilite", "tables", "toc", "sane_lists", "footnotes", "attr_list"]
MD_CONFIG = {"codehilite": {"guess_lang": False, "css_class": "codehilite"}, "toc": {"permalink": False}}
ALLOWED_TAGS = set(nh3.ALLOWED_TAGS) | {
    "img", "figure", "figcaption", "del", "ins", "kbd", "mark", "details", "summary",
    "div", "span", "pre", "code", "sup", "sub", "table", "thead", "tbody", "tr", "th", "td",
    "hr", "br", "h1", "h2", "h3", "h4", "h5", "h6",
}
ALLOWED_ATTRS = {
    "*": {"class", "id"},
    "a": {"href", "title"},
    "img": {"src", "alt", "title", "width", "height", "loading"},
    "td": {"align"},
    "th": {"align"},
}


def render_md(text: str) -> str:
    return render_post(text)[0]


def render_post(text: str) -> tuple[str, list[dict]]:
    """HTML plus a table of contents: [{id, title, level}] for the h1-h3 headings."""
    converter = md.Markdown(extensions=MD_EXTENSIONS, extension_configs=MD_CONFIG)
    html = converter.convert(text or "")
    toc: list[dict] = []

    def walk(tokens: list[dict]) -> None:
        for t in tokens:
            if t["level"] <= 3:
                toc.append({"id": t["id"], "title": html_lib.unescape(re.sub(r"<[^>]+>", "", t["name"])),
                            "level": t["level"]})
            walk(t.get("children", []))

    walk(getattr(converter, "toc_tokens", []))
    clean = nh3.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes={"http", "https", "mailto"})
    return clean, toc


def auto_excerpt(text: str, limit: int = 170) -> str:
    plain = re.sub(r"```.*?```", " ", text or "", flags=re.S)
    plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", plain)
    plain = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", plain)
    plain = re.sub(r"[#>*_`~|<-]+", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    if len(plain) <= limit:
        return plain
    return plain[:limit].rsplit(" ", 1)[0] + "…"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:80] or "post"


def unique_slug(base: str, ignore_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        row = db().execute("SELECT id FROM posts WHERE slug = %s", (slug,)).fetchone()
        if row is None or row["id"] == ignore_id:
            return slug
        slug = f"{base}-{n}"
        n += 1


def parse_tags(raw: str) -> list[str]:
    seen: list[str] = []
    for part in (raw or "").split(","):
        tag = re.sub(r"[^a-z0-9\-+# ]+", "", part.lower()).strip().replace(" ", "-")
        if tag and tag not in seen:
            seen.append(tag)
    return seen[:8]


def like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def summary(row: dict, admin: bool = False) -> dict:
    words = len(re.findall(r"\w+", row["body_md"]))
    data = {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "excerpt": row["excerpt"],
        "tags": list(row["tags"]),
        "date": iso(row["published_at"] or row["created_at"]),
        "read_min": max(1, round(words / 200)),
    }
    if admin:
        data["status"] = row["status"]
        data["updated_at"] = iso(row["updated_at"])
    return data


# --------------------------------------------------------------------------
# Security helpers
# --------------------------------------------------------------------------
@app.after_request
def security_headers(resp: Response) -> Response:
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.path.startswith("/api/admin") or request.path in ("/api/session", "/api/login", "/api/logout"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def csrf_token() -> str:
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def check_csrf() -> None:
    sent = request.headers.get("X-CSRF-Token", "")
    expected = session.get("csrf", "")
    if not expected or not hmac.compare_digest(sent.encode("utf-8"), expected.encode("utf-8")):
        abort(400)


def is_admin() -> bool:
    return session.get("admin") is True


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            return jsonify(error="Please sign in."), 401
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            check_csrf()
        return view(*args, **kwargs)
    return wrapped


# Login rate limit lives in the database, so it survives restarts and works across workers.
def login_blocked(ip: str) -> bool:
    row = db().execute(
        "SELECT attempts FROM login_attempts WHERE ip = %s AND first_at > now() - interval '15 minutes'",
        (ip,)).fetchone()
    return bool(row and row["attempts"] >= 5)


def record_failure(ip: str) -> None:
    db().execute(
        """INSERT INTO login_attempts (ip, attempts, first_at) VALUES (%s, 1, now())
           ON CONFLICT (ip) DO UPDATE SET
             attempts = CASE WHEN login_attempts.first_at < now() - interval '15 minutes' THEN 1
                             ELSE login_attempts.attempts + 1 END,
             first_at = CASE WHEN login_attempts.first_at < now() - interval '15 minutes' THEN now()
                             ELSE login_attempts.first_at END""", (ip,))
    db().commit()


def clear_failures(ip: str) -> None:
    db().execute("DELETE FROM login_attempts WHERE ip = %s", (ip,))
    db().commit()


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------
@app.get("/api/session")
def api_session():
    return jsonify(admin=is_admin(), csrf=csrf_token(), configured=bool(ADMIN_HASH))


@app.post("/api/login")
def api_login():
    check_csrf()
    ip = request.remote_addr or "?"
    if login_blocked(ip):
        return jsonify(error="Too many attempts. Wait 15 minutes and try again."), 429
    payload = request.get_json(silent=True) or {}
    user = str(payload.get("username", ""))
    password = str(payload.get("password", ""))
    ok_pw = check_password_hash(ADMIN_HASH or DUMMY_HASH, password)
    ok_user = hmac.compare_digest(user.encode("utf-8"), ADMIN_USER.encode("utf-8"))
    if ADMIN_HASH and ok_pw and ok_user:
        session.clear()
        session["admin"] = True
        session.permanent = True
        clear_failures(ip)
        return jsonify(admin=True, csrf=csrf_token())
    record_failure(ip)
    return jsonify(error="That username or password didn't match."), 401


@app.post("/api/logout")
def api_logout():
    check_csrf()
    session.clear()
    return jsonify(admin=False, csrf=csrf_token())


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def list_posts(where: str, args: list, page: int, admin: bool = False):
    total = db().execute(f"SELECT COUNT(*) AS n FROM posts WHERE {where}", args).fetchone()["n"]
    rows = db().execute(
        f"SELECT * FROM posts WHERE {where} ORDER BY published_at DESC NULLS LAST, id DESC LIMIT %s OFFSET %s",
        [*args, PER_PAGE, (page - 1) * PER_PAGE]).fetchall()
    return [summary(r, admin) for r in rows], total, max(1, -(-total // PER_PAGE))


@app.get("/api/posts")
def api_posts():
    q = (request.args.get("q") or "").strip()[:80]
    tag = re.sub(r"[^a-z0-9\-+#]", "", (request.args.get("tag") or "").lower())
    page = max(1, request.args.get("page", type=int) or 1)
    where, args = "status = 'published'", []
    if q:
        like = f"%{like_escape(q)}%"
        where += (" AND (title ILIKE %s ESCAPE '\\' OR body_md ILIKE %s ESCAPE '\\'"
                  " OR array_to_string(tags, ' ') ILIKE %s ESCAPE '\\')")
        args += [like, like, like]
    if tag:
        where += " AND tags @> %s::text[]"
        args.append([tag])
    posts, total, pages = list_posts(where, args, page)
    resp = jsonify(posts=posts, total=total, page=page, pages=pages, q=q, tag=tag)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/tags")
def api_tags():
    rows = db().execute(
        "SELECT t AS tag, COUNT(*) AS count FROM posts, unnest(tags) AS t"
        " WHERE status = 'published' GROUP BY t ORDER BY count DESC, t").fetchall()
    resp = jsonify(tags=[{"tag": r["tag"], "count": r["count"]} for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/posts/<slug>")
def api_post(slug: str):
    row = db().execute("SELECT * FROM posts WHERE slug = %s", (slug,)).fetchone()
    if row is None or (row["status"] != "published" and not is_admin()):
        return jsonify(error="That note doesn't exist, or it hasn't been published yet."), 404
    post = summary(row, admin=True)
    post["html"], post["toc"] = render_post(row["body_md"])
    prev_row = nxt_row = None
    related: list[dict] = []
    if row["status"] == "published":
        key = (row["published_at"], row["id"])
        prev_row = db().execute(
            "SELECT slug, title FROM posts WHERE status = 'published' AND (published_at, id) < (%s, %s)"
            " ORDER BY published_at DESC, id DESC LIMIT 1", key).fetchone()
        nxt_row = db().execute(
            "SELECT slug, title FROM posts WHERE status = 'published' AND (published_at, id) > (%s, %s)"
            " ORDER BY published_at ASC, id ASC LIMIT 1", key).fetchone()
        # Read next: the most shared tags first, then the newest.
        related = [summary(r) for r in db().execute(
            "SELECT *, cardinality(ARRAY(SELECT unnest(tags) INTERSECT SELECT unnest(%s::text[]))) AS shared"
            " FROM posts WHERE status = 'published' AND id <> %s"
            " ORDER BY shared DESC, published_at DESC, id DESC LIMIT 3", (list(row["tags"]), row["id"])).fetchall()]
    resp = jsonify(post=post, prev=prev_row, next=nxt_row, related=related)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# --------------------------------------------------------------------------
# Comments and reactions
# --------------------------------------------------------------------------
def published_post_id(slug: str) -> int | None:
    row = db().execute("SELECT id FROM posts WHERE slug = %s AND status = 'published'", (slug,)).fetchone()
    return row["id"] if row else None


def comment_json(row: dict, admin: bool = False) -> dict:
    data = {"id": row["id"], "author": row["author"], "body": row["body"],
            "by_author": row["by_author"], "date": iso(row["created_at"])}
    if admin:
        data.update(status=row["status"], post_slug=row["slug"], post_title=row["title"])
    return data


@app.get("/api/posts/<slug>/comments")
def api_comments(slug: str):
    pid = published_post_id(slug)
    if pid is None:
        return jsonify(error="That note doesn't exist."), 404
    rows = db().execute(
        "SELECT * FROM comments WHERE post_id = %s AND status = 'approved' ORDER BY created_at, id",
        (pid,)).fetchall()
    resp = jsonify(comments=[comment_json(r) for r in rows])
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.post("/api/posts/<slug>/comments")
def api_comment_create(slug: str):
    check_csrf()
    pid = published_post_id(slug)
    if pid is None:
        return jsonify(error="That note doesn't exist."), 404
    payload = request.get_json(silent=True) or {}
    if str(payload.get("website", "")).strip():  # honeypot: people never see this field, bots fill it
        return jsonify(pending=True), 201
    admin = is_admin()
    author = "Christianto Lie" if admin else re.sub(r"\s+", " ", str(payload.get("name", ""))).strip()
    body = str(payload.get("body", "")).replace("\r\n", "\n").strip()
    if not author or len(author) > 60:
        return jsonify(error="Add your name (60 characters at most)."), 400
    if len(body) < 2 or len(body) > 3000:
        return jsonify(error="Write a comment between 2 and 3000 characters."), 400
    ip = request.remote_addr or "?"
    if not admin:
        recent = db().execute(
            "SELECT COUNT(*) AS n FROM comments"
            " WHERE ip = %s AND NOT by_author AND created_at > now() - interval '10 minutes'",
            (ip,)).fetchone()["n"]
        if recent >= 3:
            return jsonify(error="You've left a few comments already. Try again in a few minutes."), 429
    row = db().execute(
        "INSERT INTO comments (post_id, author, body, by_author, status, ip) VALUES (%s, %s, %s, %s, %s, %s)"
        " RETURNING *",
        (pid, author, body, admin, "approved" if admin else "pending", ip)).fetchone()
    db().commit()
    if admin:
        return jsonify(pending=False, comment=comment_json(row)), 201
    title = db().execute("SELECT title FROM posts WHERE id = %s", (pid,)).fetchone()["title"]
    notify(f"New comment on “{title}” from {author}",
           f"{body[:1000]}\n\nApprove or delete it: {SITE_URL}/admin/comments")
    return jsonify(pending=True), 201


def notify(subject: str, text: str) -> None:
    """Tell the owner about something, without making the visitor wait for it."""
    if (TELEGRAM_TOKEN and TELEGRAM_CHAT_ID) or (SMTP_HOST and NOTIFY_EMAIL):
        threading.Thread(target=deliver, args=(subject, text), daemon=True).start()


def deliver(subject: str, text: str) -> None:
    if TELEGRAM_TOKEN and TELEGRAM_CHAT_ID:
        try:
            data = urllib.parse.urlencode({"chat_id": TELEGRAM_CHAT_ID, "text": f"{subject}\n\n{text}",
                                           "disable_web_page_preview": "true"}).encode()
            urllib.request.urlopen(  # noqa: S310 (fixed https URL)
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage", data=data, timeout=10).read()
        except Exception as exc:
            app.logger.warning("Telegram notification failed: %s", exc)
    if SMTP_HOST and NOTIFY_EMAIL:
        try:
            msg = EmailMessage()
            msg["Subject"], msg["To"] = subject, NOTIFY_EMAIL
            msg["From"] = SMTP_USER if "@" in SMTP_USER else NOTIFY_EMAIL
            msg.set_content(text)
            with (smtplib.SMTP_SSL if SMTP_PORT == 465 else smtplib.SMTP)(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
                if SMTP_PORT != 465:
                    smtp.starttls()
                if SMTP_USER:
                    smtp.login(SMTP_USER, SMTP_PASSWORD)
                smtp.send_message(msg)
        except Exception as exc:
            app.logger.warning("Email notification failed: %s", exc)


def voter_id() -> str:
    if "voter" not in session:
        session["voter"] = secrets.token_urlsafe(16)
        session.permanent = True
    return session["voter"]


def reaction_state(pid: int) -> dict:
    rows = db().execute("SELECT kind, COUNT(*) AS n FROM reactions WHERE post_id = %s GROUP BY kind",
                        (pid,)).fetchall()
    counts = {k: 0 for k in REACTIONS}
    counts.update({r["kind"]: r["n"] for r in rows if r["kind"] in counts})
    mine = [r["kind"] for r in db().execute(
        "SELECT kind FROM reactions WHERE post_id = %s AND voter = %s", (pid, session.get("voter", ""))).fetchall()]
    return {"counts": counts, "mine": mine}


@app.get("/api/posts/<slug>/reactions")
def api_reactions(slug: str):
    pid = published_post_id(slug)
    if pid is None:
        return jsonify(error="That note doesn't exist."), 404
    resp = jsonify(reaction_state(pid))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/posts/<slug>/reactions")
def api_react(slug: str):
    check_csrf()
    pid = published_post_id(slug)
    if pid is None:
        return jsonify(error="That note doesn't exist."), 404
    kind = str((request.get_json(silent=True) or {}).get("kind", ""))
    if kind not in REACTIONS:
        return jsonify(error="Unknown reaction."), 400
    voter, ip = voter_id(), request.remote_addr or "?"
    removed = db().execute("DELETE FROM reactions WHERE post_id = %s AND kind = %s AND voter = %s",
                           (pid, kind, voter)).rowcount
    if not removed:
        # Clearing cookies gives a new voter id, so also cap how often one address can add the same reaction.
        same_ip = db().execute("SELECT COUNT(*) AS n FROM reactions WHERE post_id = %s AND kind = %s AND ip = %s",
                               (pid, kind, ip)).fetchone()["n"]
        if same_ip >= 3:
            return jsonify(error="That reaction has already been counted from here."), 429
        db().execute("INSERT INTO reactions (post_id, kind, voter, ip) VALUES (%s, %s, %s, %s)"
                     " ON CONFLICT DO NOTHING", (pid, kind, voter, ip))
    db().commit()
    resp = jsonify(reaction_state(pid))
    resp.headers["Cache-Control"] = "no-store"
    return resp


# --------------------------------------------------------------------------
# Traffic. A visitor is a hash of (secret, day, IP, browser), so nothing that
# identifies a person is stored and the same person can't be followed across days.
# --------------------------------------------------------------------------
BOT_RE = re.compile(r"bot|crawl|spider|slurp|preview|fetch|curl|wget|python|httpclient|headless|lighthouse|monitor",
                    re.I)
MOBILE_RE = re.compile(r"mobile|android|iphone|ipod|ipad|tablet", re.I)
VIEW_KEEP_DAYS = 400
_geoip: dict = {"reader": None, "mtime": None}


def country_of(ip: str) -> str:
    """Two-letter country code, from Cloudflare's header or the DB-IP country database."""
    cf = request.headers.get("CF-IPCountry", "").upper()
    if re.fullmatch(r"[A-Z]{2}", cf) and cf not in ("XX", "T1"):
        return cf
    try:
        mtime = GEOIP_DB.stat().st_mtime
    except OSError:
        return ""
    if _geoip["mtime"] != mtime:  # (re)open after the file was refreshed
        try:
            _geoip.update(reader=maxminddb.open_database(str(GEOIP_DB)), mtime=mtime)
        except Exception:
            _geoip.update(reader=None, mtime=mtime)
    try:
        rec = _geoip["reader"].get(ip) if _geoip["reader"] else None
    except ValueError:
        return ""
    code = ((rec or {}).get("country") or {}).get("iso_code", "")
    return code if re.fullmatch(r"[A-Z]{2}", code or "") else ""


def visitor_hash() -> str:
    raw = f"{app.secret_key}|{datetime.now(timezone.utc).date().isoformat()}|{request.remote_addr}|{request.user_agent.string}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def referrer_host(raw: str) -> str:
    try:
        host = (urlsplit(raw).hostname or "").lower()
    except ValueError:
        return ""
    if host.startswith("www."):
        host = host[4:]
    own = (urlsplit(SITE_URL).hostname or "").lower()
    return "" if not host or host in (own, request.host.split(":")[0].lower()) else host[:100]


@app.post("/api/track")
def api_track():
    ua = request.user_agent.string or ""
    payload = request.get_json(silent=True) or {}
    path = str(payload.get("path", ""))[:200]
    if is_admin() or not ua or BOT_RE.search(ua) or not path.startswith("/") or path.startswith(("/admin", "//")):
        return "", 204
    visitor = visitor_hash()
    recent = db().execute(  # a reload or double fire within 30 seconds is one view
        "SELECT 1 FROM page_views WHERE visitor = %s AND path = %s AND created_at > now() - interval '30 seconds'",
        (visitor, path)).fetchone()
    if recent:
        return "", 204
    post_id = None
    m = re.fullmatch(r"/post/([^/?#]+)", path)
    if m:
        post_id = published_post_id(m.group(1))
        if post_id is None:
            return "", 204
    db().execute(
        "INSERT INTO page_views (path, post_id, visitor, referrer, device, country) VALUES (%s, %s, %s, %s, %s, %s)",
        (path, post_id, visitor, referrer_host(str(payload.get("referrer", ""))),
         "mobile" if MOBILE_RE.search(ua) else "desktop", country_of(request.remote_addr or "")))
    if secrets.randbelow(200) == 0:  # now and then, forget very old views
        db().execute(f"DELETE FROM page_views WHERE created_at < now() - interval '{VIEW_KEEP_DAYS} days'")
    db().commit()
    return "", 204


# --------------------------------------------------------------------------
# Admin API
# --------------------------------------------------------------------------
@app.get("/api/admin/posts")
@admin_required
def admin_list():
    rows = db().execute("SELECT * FROM posts ORDER BY updated_at DESC").fetchall()
    return jsonify(posts=[summary(r, admin=True) for r in rows])


@app.get("/api/admin/posts/<int:pid>")
@admin_required
def admin_get(pid: int):
    row = db().execute("SELECT * FROM posts WHERE id = %s", (pid,)).fetchone()
    if row is None:
        return jsonify(error="Post not found."), 404
    post = summary(row, admin=True)
    post["body"] = row["body_md"]
    return jsonify(post=post)


def read_payload() -> dict:
    data = request.get_json(silent=True) or {}
    tags = data.get("tags", "")
    if isinstance(tags, list):
        tags = ",".join(str(t) for t in tags)
    return {
        "title": str(data.get("title", "")).strip()[:150],
        "slug": str(data.get("slug", "")).strip(),
        "excerpt": str(data.get("excerpt", "")).strip()[:300],
        "tags": parse_tags(str(tags)),
        "body_md": str(data.get("body", "")).replace("\r\n", "\n")[:200000],
        "action": str(data.get("action", "draft")),
    }


@app.route("/api/admin/posts", methods=["POST"])
@app.route("/api/admin/posts/<int:pid>", methods=["PUT"])
@admin_required
def admin_save(pid: int | None = None):
    existing = None
    if pid is not None:
        existing = db().execute("SELECT * FROM posts WHERE id = %s", (pid,)).fetchone()
        if existing is None:
            return jsonify(error="Post not found."), 404
    form = read_payload()
    if not form["title"]:
        return jsonify(error="Give the post a title first."), 400
    slug = unique_slug(slugify(form["slug"] or form["title"]), ignore_id=pid)
    excerpt = form["excerpt"] or auto_excerpt(form["body_md"])
    action = form["action"]
    if existing:
        status = {"publish": "published", "draft": "draft"}.get(action, existing["status"])
        row = db().execute(
            """UPDATE posts SET slug=%s, title=%s, excerpt=%s, body_md=%s, tags=%s, status=%s, updated_at=now(),
                 published_at = COALESCE(published_at, CASE WHEN %s = 'published' THEN now() END)
               WHERE id=%s RETURNING *""",
            (slug, form["title"], excerpt, form["body_md"], form["tags"], status, status, pid)).fetchone()
    else:
        status = "published" if action == "publish" else "draft"
        row = db().execute(
            """INSERT INTO posts (slug, title, excerpt, body_md, tags, status, published_at)
               VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s = 'published' THEN now() END) RETURNING *""",
            (slug, form["title"], excerpt, form["body_md"], form["tags"], status, status)).fetchone()
    db().commit()
    post = summary(row, admin=True)
    post["body"] = row["body_md"]
    return jsonify(post=post), (200 if existing else 201)


@app.delete("/api/admin/posts/<int:pid>")
@admin_required
def admin_delete(pid: int):
    db().execute("DELETE FROM posts WHERE id = %s", (pid,))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/admin/comments")
@admin_required
def admin_comments():
    status = request.args.get("status", "pending")
    if status not in ("pending", "approved"):
        status = "pending"
    rows = db().execute(
        "SELECT c.*, p.slug, p.title FROM comments c JOIN posts p ON p.id = c.post_id"
        " WHERE c.status = %s ORDER BY c.created_at DESC, c.id DESC LIMIT 200", (status,)).fetchall()
    pending = db().execute("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").fetchone()["n"]
    return jsonify(comments=[comment_json(r, admin=True) for r in rows], pending=pending)


@app.put("/api/admin/comments/<int:cid>")
@admin_required
def admin_comment_approve(cid: int):
    row = db().execute("UPDATE comments SET status = 'approved' WHERE id = %s RETURNING id", (cid,)).fetchone()
    db().commit()
    if row is None:
        return jsonify(error="Comment not found."), 404
    return jsonify(ok=True)


@app.delete("/api/admin/comments/<int:cid>")
@admin_required
def admin_comment_delete(cid: int):
    db().execute("DELETE FROM comments WHERE id = %s", (cid,))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/admin/stats")
@admin_required
def admin_stats():
    days = request.args.get("days", type=int) or 30
    if days not in (7, 30, 90):
        days = 30
    since = "created_at >= date_trunc('day', now()) - make_interval(days => %s)"

    def q(sql: str) -> list[dict]:
        return db().execute(sql, (days - 1,)).fetchall()

    series = [{"day": r["day"].isoformat(), "views": r["views"], "visitors": r["visitors"]} for r in q(
        "SELECT d::date AS day, COUNT(v.id) AS views, COUNT(DISTINCT v.visitor) AS visitors"
        " FROM generate_series(date_trunc('day', now()) - make_interval(days => %s), date_trunc('day', now()),"
        " interval '1 day') AS d LEFT JOIN page_views v ON v.created_at >= d AND v.created_at < d + interval '1 day'"
        " GROUP BY d ORDER BY d")]
    pages = q(f"SELECT v.path, p.title, COUNT(*) AS views, COUNT(DISTINCT v.visitor) AS visitors"
              f" FROM page_views v LEFT JOIN posts p ON p.id = v.post_id WHERE v.{since}"
              f" GROUP BY v.path, p.title ORDER BY views DESC, v.path LIMIT 10")
    refs = q(f"SELECT referrer, COUNT(*) AS views FROM page_views WHERE {since} AND referrer <> ''"
             f" GROUP BY referrer ORDER BY views DESC, referrer LIMIT 10")
    devices = q(f"SELECT device, COUNT(*) AS views FROM page_views WHERE {since} GROUP BY device ORDER BY views DESC")
    countries = q(f"SELECT country, COUNT(*) AS views FROM page_views WHERE {since}"
                  f" GROUP BY country ORDER BY views DESC, country LIMIT 12")
    counts = db().execute(
        f"SELECT (SELECT COUNT(*) FROM comments WHERE {since}) AS comments,"
        f" (SELECT COUNT(*) FROM reactions WHERE {since}) AS reactions", (days - 1, days - 1)).fetchone()
    return jsonify(
        days=days, daily=series,
        views=sum(d["views"] for d in series), visitors=sum(d["visitors"] for d in series),
        comments=counts["comments"], reactions=counts["reactions"],
        pages=[{"path": r["path"], "title": r["title"], "views": r["views"], "visitors": r["visitors"]} for r in pages],
        referrers=[{"host": r["referrer"], "views": r["views"]} for r in refs],
        devices=[{"device": r["device"], "views": r["views"]} for r in devices],
        countries=[{"country": r["country"], "views": r["views"]} for r in countries],
        geoip=GEOIP_DB.exists())


@app.post("/api/admin/preview")
@admin_required
def admin_preview():
    payload = request.get_json(silent=True) or {}
    return jsonify(html=render_md(str(payload.get("md", ""))[:200000]))


def sniff_image(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@app.post("/api/admin/upload")
@admin_required
def admin_upload():
    file = request.files.get("file")
    if file is None:
        return jsonify(error="No file received."), 400
    data = file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        return jsonify(error="That file is too large (5 MB max)."), 413
    ext = sniff_image(data)
    if ext is None:
        return jsonify(error="Only PNG, JPG, GIF, and WebP images are allowed."), 400
    name = f"{secrets.token_hex(8)}.{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / name).write_bytes(data)
    return jsonify(url=f"/uploads/{name}", name=name)


# --------------------------------------------------------------------------
# Feeds, uploads, health
# --------------------------------------------------------------------------
@app.get("/feed.xml")
def feed():
    rows = db().execute(
        "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 20").fetchall()
    items = []
    for row in rows:
        link = f"{SITE_URL}/post/{row['slug']}"
        items.append(
            "<item><title>{t}</title><link>{l}</link><guid isPermaLink=\"true\">{l}</guid>"
            "<pubDate>{d}</pubDate><description>{e}</description></item>".format(
                t=xml_escape(row["title"]), l=xml_escape(link),
                d=formatdate(row["published_at"].timestamp(), usegmt=True), e=xml_escape(row["excerpt"])))
    xml = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
           f"<title>Notes from the little town</title><link>{xml_escape(SITE_URL)}</link>"
           "<description>Software, football, anime, books, and whatever I am learning.</description>"
           f"{''.join(items)}</channel></rss>")
    return Response(xml, mimetype="application/rss+xml")


@app.get("/sitemap.xml")
def sitemap():
    rows = db().execute(
        "SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY published_at DESC").fetchall()
    urls = [f"<url><loc>{xml_escape(SITE_URL)}/</loc></url>"]
    for row in rows:
        urls.append(f"<url><loc>{xml_escape(SITE_URL)}/post/{xml_escape(row['slug'])}</loc>"
                    f"<lastmod>{iso(row['updated_at'])[:10]}</lastmod></url>")
    xml = ('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
           f"{''.join(urls)}</urlset>")
    return Response(xml, mimetype="application/xml")


@app.get("/robots.txt")
def robots():
    return Response(f"User-agent: *\nDisallow: /admin\nSitemap: {SITE_URL}/sitemap.xml\n", mimetype="text/plain")


@app.get("/healthz")
def healthz():
    try:
        db().execute("SELECT 1").fetchone()
    except Exception:
        return Response("database unavailable", status=503, mimetype="text/plain")
    return Response("ok", mimetype="text/plain")


@app.get("/og/<slug>/<kind>.png")
def og_image(slug: str, kind: str):
    if kind not in share_image.SIZES:
        abort(404)
    row = db().execute("SELECT * FROM posts WHERE slug = %s AND status = 'published'", (slug,)).fetchone()
    if row is None:
        abort(404)
    post = summary(row)
    meta = f"{format_day(row['published_at'])} · {post['read_min']} min read"
    site = urlsplit(SITE_URL).netloc
    key = hashlib.sha256(f"2|{kind}|{row['title']}|{meta}|{post['tags'][:1]}|{site}".encode()).hexdigest()[:16]
    path = OG_DIR / f"{key}.png"
    if not path.exists():
        OG_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
        tmp.write_bytes(share_image.render(kind, row["title"], meta, post["tags"], site))
        tmp.replace(path)
    resp = send_from_directory(OG_DIR, path.name, mimetype="image/png", max_age=3600)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


def format_day(value: datetime) -> str:
    return f"{value.day} {value.strftime('%b %Y')}"


@app.get("/uploads/<name>")
def uploads(name: str):
    if not re.fullmatch(r"[a-f0-9]{16}\.(png|jpg|gif|webp)", name):
        abort(404)
    resp = send_from_directory(UPLOAD_DIR, name, max_age=31536000)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


# --------------------------------------------------------------------------
# React shell (SEO meta for post pages, and a full fallback when the backend
# is the only thing running, e.g. local testing)
# --------------------------------------------------------------------------
_shell_cache: dict = {"at": 0.0, "html": None}


def read_shell() -> str | None:
    if SHELL_URL:  # Docker: the web container serves the built app
        if _shell_cache["html"] and time.time() - _shell_cache["at"] < 30:
            return _shell_cache["html"]
        try:
            with urllib.request.urlopen(SHELL_URL, timeout=2) as res:  # noqa: S310 (fixed internal URL)
                _shell_cache.update(at=time.time(), html=res.read().decode("utf-8"))
        except Exception:
            pass  # keep serving the last good copy, if any
        return _shell_cache["html"]
    try:
        return (FRONTEND_DIST / "index.html").read_text(encoding="utf-8")
    except OSError:
        return None


def inject_meta(shell: str, title: str, description: str, canonical: str, og_type: str, image: str = "") -> str:
    esc = html_lib.escape
    picture = (
        f'<meta property="og:image" content="{esc(image, quote=True)}">'
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
        '<meta name="twitter:card" content="summary_large_image">'
        f'<meta name="twitter:image" content="{esc(image, quote=True)}">'
    ) if image else ""
    tags = (
        f'<meta name="description" content="{esc(description, quote=True)}">'
        f'<meta property="og:title" content="{esc(title, quote=True)}">'
        f'<meta property="og:description" content="{esc(description, quote=True)}">'
        f'<meta property="og:type" content="{og_type}">'
        f'<meta property="og:site_name" content="tolie.space notes">'
        f'<meta property="og:url" content="{esc(canonical, quote=True)}">'
        f'<link rel="canonical" href="{esc(canonical, quote=True)}">'
        f"{picture}"
    )
    shell = re.sub(r"<title>.*?</title>", lambda _m: f"<title>{esc(title)}</title>", shell, count=1, flags=re.S)
    shell = re.sub(r'<meta name="description"[^>]*>', "", shell, count=1)
    return shell.replace("<!--ssr-meta-->", tags, 1)


@app.get("/post/<slug>")
def post_shell(slug: str):
    shell = read_shell()
    if shell is None:
        return jsonify(error="The frontend isn't available yet."), 503
    row = db().execute("SELECT slug, title, excerpt, status FROM posts WHERE slug = %s", (slug,)).fetchone()
    if row is None or row["status"] != "published":
        return Response(shell, mimetype="text/html", status=404)
    page = inject_meta(shell, f"{row['title']} · tolie.space notes", row["excerpt"],
                       f"{SITE_URL}/post/{row['slug']}", "article", f"{SITE_URL}/og/{row['slug']}/card.png")
    return Response(page, mimetype="text/html")


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def frontend_fallback(path: str):
    """Serve the built React app when running without the web container (local development)."""
    if path.startswith(("api/", "uploads/", "og/")):
        return jsonify(error="Not found."), 404
    target = (FRONTEND_DIST / path).resolve()
    if path and FRONTEND_DIST.resolve() in target.parents and target.is_file():
        return send_from_directory(FRONTEND_DIST, path)
    shell = read_shell()
    if shell is None:
        return jsonify(error="The frontend isn't available yet."), 503
    return Response(shell, mimetype="text/html")


@app.errorhandler(400)
def bad_request(_exc):
    return jsonify(error="Bad request. Reload the page and try again."), 400


@app.errorhandler(404)
def not_found(_exc):
    return jsonify(error="Not found."), 404


@app.errorhandler(413)
def too_large(_exc):
    return jsonify(error="That file is too large (5 MB max)."), 413


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
