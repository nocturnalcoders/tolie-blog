# tolie.space notes

A blog with a React frontend, a Python (Flask) backend, and a PostgreSQL database.
Everything runs in Docker Compose.

```
Browser ──► Caddy (already on the droplet) ──► 127.0.0.1:8788
                                                   │
                      ┌────────────────────────────┘
                      ▼
              web  (nginx + the built React app)
                      │  /api, /post/*, /feed.xml, /uploads ...
                      ▼
              api  (Flask + gunicorn)  ──►  db  (PostgreSQL 16)
```

- Only one port is open, and only on the droplet itself: `127.0.0.1:8788`.
  The database and the API are not reachable from outside Docker.
- It is a separate Compose project (`tolie-blog`), so it does not touch your other containers.
- The React app is built inside Docker, so no Node is needed on the droplet.

## First-time setup on the droplet

Run these in the Droplet Web Console (as root, which has Docker access):

```bash
cd /opt
git clone https://github.com/nocturnalcoders/tolie-blog.git
cd tolie-blog
bash deploy/setup.sh                    # creates .env, asks for the admin username and password
docker compose up -d --build            # the first build takes a few minutes
docker compose ps                       # db, api and web should show "healthy"
curl -s http://127.0.0.1:8788/healthz   # prints: ok
python3 deploy/patch_caddy.py           # points the blog domain at the stack
```

`patch_caddy.py` backs up the Caddyfile, validates the new config, reloads Caddy only if it
is valid, and restores the backup if anything fails. It only touches the blog site block.

Then open the blog's `/admin/login` page and sign in.

## Updating

After `git push` from your laptop:

```bash
bash /opt/tolie-blog/deploy/deploy.sh
```

## Backups

```bash
bash /opt/tolie-blog/deploy/backup.sh
```

Saves the database (`backups/blog-*.sql.gz`) and the uploaded images (`backups/uploads-*.tar.gz`),
keeping the latest 14 of each. To run it every night at 03:00, add this line with `crontab -e`:

```
0 3 * * * /opt/tolie-blog/deploy/backup.sh >> /var/log/tolie-blog-backup.log 2>&1
```

### Off-site copies

Backups on the droplet disappear with the droplet. To also keep a copy somewhere else, add the
`BACKUP_S3_*` settings from `.env.example` to `.env` (DigitalOcean Spaces, AWS S3, Cloudflare R2 and
Backblaze B2 all work). Every run of `backup.sh` then uploads both files and removes copies older than
`BACKUP_KEEP_DAYS` days. Nothing needs to be installed: it runs rclone from its Docker image.

To get files back on a new droplet, download them from the bucket (the provider's web page works),
put them in `/opt/tolie-blog/backups/`, and follow the restore steps below.

Restore the database from a backup:

```bash
cd /opt/tolie-blog
docker compose exec -T db psql -U blog -d blog -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c backups/blog-YYYYMMDD-HHMM.sql.gz | docker compose exec -T db psql -U blog -d blog
docker compose restart api
```

Restore the uploaded images:

```bash
cd /opt/tolie-blog
docker run --rm -v tolie-blog_uploads:/data -v "$PWD/backups:/in:ro" alpine \
  tar xzf /in/uploads-YYYYMMDD-HHMM.tar.gz -C /data
```

## Comments, traffic and sharing

- New comments wait for you at `/admin/comments`. Traffic is at `/admin/stats`.
- Email: once SMTP is set in `.env`, readers can subscribe to new notes (double opt-in, optional topics,
  one-click unsubscribe), and commenters can ask to hear about replies. Each note is mailed once, when it
  goes out (scheduled notes too). Notes that were already out before this existed are never mailed.
- Two-factor login is set up at `/admin/security`. Lost your phone and the recovery codes? On the droplet:
  `docker compose exec api python manage.py disable-2fa`, then sign in with your password.
- Topics (the few big sections on the home page, one per note) are managed at `/admin/topics`.
  The first deploy creates Software, Security, Hardware, Football, Anime & Books and Life once.
- To get a message for every new comment, add the Telegram and/or email settings from
  `.env.example` to `.env` on the droplet, then run `bash deploy/deploy.sh`.
  Quick Telegram setup: message `@BotFather`, send `/newbot`, copy the token into `BLOG_TELEGRAM_TOKEN`.
  Send your new bot any message, open `https://api.telegram.org/bot<token>/getUpdates`, and put the
  `"chat":{"id": ...}` number into `BLOG_TELEGRAM_CHAT_ID`.
- Countries on the traffic page come from the free DB-IP country database, downloaded each time the
  API image is built (so it stays fresh with every deploy). If Cloudflare is in front, its
  `CF-IPCountry` header is used instead.
- Every post gets share pictures: `/og/<slug>/card.png` (link previews) and `/og/<slug>/story.png`
  (Instagram/TikTok stories). They are made on first request and cached.

## Everyday commands

```bash
docker compose logs -f api              # backend logs
docker compose logs -f web              # nginx logs
docker compose restart api              # restart only the backend
bash deploy/setup.sh --reset-password   # change the admin password
```

## Working on it locally

```bash
# database
docker run -d --name blogdb -e POSTGRES_USER=blog -e POSTGRES_PASSWORD=blog -e POSTGRES_DB=blog -p 5432:5432 postgres:16-alpine

# backend (terminal 1)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL=postgresql://blog:blog@localhost:5432/blog BLOG_COOKIE_SECURE=0 \
  BLOG_ADMIN_HASH_B64=$(printf '%s' 'a long password' | .venv/bin/python manage.py hash) \
  BLOG_SECRET_KEY=dev .venv/bin/gunicorn -b 127.0.0.1:8000 app:app
DATABASE_URL=postgresql://blog:blog@localhost:5432/blog .venv/bin/python tests/test_api.py

# frontend (terminal 2)
cd frontend && npm install
npm run dev        # http://localhost:5173, proxies /api to the backend on port 8000
npm test
```
