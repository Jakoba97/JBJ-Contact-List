"""List every login and whether it's an admin. Read-only -- deliberately
doesn't go through create_app(), which runs schema changes and seeding on
startup. Reads DATABASE_URL from the environment:

    $env:DATABASE_URL = "<connection string>"
    .venv\\Scripts\\python.exe list_users.py
"""
import os
import sys

from sqlalchemy import create_engine, text

from config import _normalize_database_url


def main():
    url = _normalize_database_url(os.environ.get('DATABASE_URL', '').strip())
    if not url:
        print('DATABASE_URL is not set.')
        sys.exit(1)

    engine = create_engine(url)
    with engine.connect() as conn:
        if engine.dialect.name == 'postgresql':
            conn.execute(text('SET TRANSACTION READ ONLY'))
        rows = conn.execute(text(
            'SELECT username, display_name, is_admin FROM users ORDER BY id'
        )).all()

    if not rows:
        print('No users found.')
        return
    for username, display_name, is_admin in rows:
        role = 'admin' if is_admin else 'staff'
        print(f'{username:<40} {display_name or "":<25} {role}')
    print(f'\n{len(rows)} user(s).')


if __name__ == '__main__':
    main()
