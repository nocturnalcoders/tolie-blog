#!/usr/bin/env python3
"""Small admin helpers.

    printf '%s' 'a long password' | python manage.py hash   base64 password hash for .env (deploy/setup.sh)
    python manage.py disable-2fa                             turn off two-factor login (lost phone and codes)

The second one runs inside the api container:  docker compose exec api python manage.py disable-2fa
"""
import base64
import os
import re
import sys

from werkzeug.security import generate_password_hash


def disable_2fa() -> None:
    import psycopg

    schema = os.environ.get("BLOG_DB_SCHEMA", "")
    table = f'"{schema}".meta' if re.fullmatch(r"[a-z0-9_]+", schema) else "meta"
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        n = conn.execute(f"DELETE FROM {table} WHERE key LIKE 'totp\\_%'").rowcount
    print("Two-factor login is off. Sign in with your password and set it up again." if n else
          "Two-factor login was already off.")


def main() -> None:
    if sys.argv[1:] == ["disable-2fa"]:
        disable_2fa()
        return
    if len(sys.argv) != 2 or sys.argv[1] != "hash":
        print(__doc__)
        sys.exit(1)
    password = sys.stdin.read().rstrip("\n")
    if len(password) < 12:
        sys.exit("The password must be at least 12 characters.")
    print(base64.b64encode(generate_password_hash(password).encode("utf-8")).decode("ascii"))


if __name__ == "__main__":
    main()
