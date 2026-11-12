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

Restore the database from a backup:

```bash
cd /opt/tolie-blog
docker compose exec -T db psql -U blog -d blog -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c backups/blog-YYYYMMDD-HHMM.sql.gz | docker compose exec -T db psql -U blog -d blog
docker compose restart api
```

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
