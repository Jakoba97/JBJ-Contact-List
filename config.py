import os
from datetime import timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _normalize_database_url(url):
    # Some providers (older Heroku-style connection strings) hand out
    # postgres:// -- SQLAlchemy only accepts the postgresql:// scheme.
    if url and url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


class Config:
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(os.environ.get("DATABASE_URL")) or f"sqlite:///{os.path.join(BASE_DIR, 'contacts.db')}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Neon's serverless Postgres closes idle connections after ~5 min.
    # pool_pre_ping tests each connection before reuse and silently
    # replaces dead ones, preventing "SSL connection closed unexpectedly"
    # errors when the app comes back from an idle period.
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    JSON_SORT_KEYS = False
    SECRET_KEY = os.environ.get("SECRET_KEY", "change-me")

    # Render sets RENDER=true on every deployed service; use that to harden
    # session cookies in production without breaking local http:// dev.
    SESSION_COOKIE_SECURE = bool(os.environ.get("RENDER"))
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
