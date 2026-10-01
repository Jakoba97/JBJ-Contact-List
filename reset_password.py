"""Reset an existing employee's password (and clear any login lockout).
Run interactively so the password never ends up in shell history or logs:

    .venv/bin/python reset_password.py
"""
import getpass
import sys

from app import create_app
from db import db
from models import User


def main():
    app = create_app()
    with app.app_context():
        username = input('Username: ').strip()
        user = User.query.filter_by(username=username).first()
        if not user:
            print(f'No user named "{username}".')
            sys.exit(1)

        password = getpass.getpass('New password: ')
        if len(password) < 8:
            print('Password must be at least 8 characters.')
            sys.exit(1)
        confirm = getpass.getpass('Confirm password: ')
        if password != confirm:
            print('Passwords did not match.')
            sys.exit(1)

        user.set_password(password)
        user.failed_login_attempts = 0
        user.locked_until = None
        db.session.commit()
        print(f'Password reset for "{username}".')


if __name__ == '__main__':
    main()
