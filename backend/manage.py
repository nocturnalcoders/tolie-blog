#!/usr/bin/env python3
"""Helper used by deploy/setup.sh. Turns a password (read from stdin) into the
base64-encoded hash that goes into .env:

    printf '%s' 'a long password' | python manage.py hash
"""
import base64
import sys

from werkzeug.security import generate_password_hash


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] != "hash":
        print(__doc__)
        sys.exit(1)
    password = sys.stdin.read().rstrip("\n")
    if len(password) < 12:
        sys.exit("The password must be at least 12 characters.")
    print(base64.b64encode(generate_password_hash(password).encode("utf-8")).decode("ascii"))


if __name__ == "__main__":
    main()
