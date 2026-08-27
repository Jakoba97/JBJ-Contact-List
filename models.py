# =============================================================================
# Author: Kadin Lee-Smith
# Database models for the Contact & Relationship Management Platform.
# All models, relationships, and schema designed by Kadin Lee-Smith.
# =============================================================================
from datetime import datetime, date, time as dtime, timedelta
from sqlalchemy import Index
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from db import db


# User model + granular permission flags — Kadin Lee-Smith
class User(db.Model, UserMixin):
    """An employee login. Accounts are created via create_user.py -- there's
    no public registration since this is an internal tool."""
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, index=True, nullable=False)
    display_name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    can_draft_email = db.Column(db.Boolean, default=False, nullable=False)
    can_export_contacts = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    failed_login_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime, nullable=True)

    def is_locked(self):
        if self.locked_until and self.locked_until > datetime.utcnow():
            return True
        return False

    def record_failed_login(self):
        self.failed_login_attempts = (self.failed_login_attempts or 0) + 1
        if self.failed_login_attempts >= 5:
            self.locked_until = datetime.utcnow() + timedelta(minutes=15)

    def reset_login_attempts(self):
        self.failed_login_attempts = 0
        self.locked_until = None

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name,
            'is_admin': bool(self.is_admin),
            'can_draft_email': bool(self.can_draft_email),
            'can_export_contacts': bool(self.can_export_contacts),
        }


class LoginEvent(db.Model):
    """Every login attempt — successful or not — with IP and outcome."""
    __tablename__ = 'login_events'

    id         = db.Column(db.Integer, primary_key=True)
    username   = db.Column(db.String(80), nullable=False, index=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    ip_address = db.Column(db.String(64), nullable=True)
    user_agent = db.Column(db.String(256), nullable=True)
    success    = db.Column(db.Boolean, nullable=False)
    note       = db.Column(db.String(128), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)


# Contact model with scoring, soft delete, and pipeline stage — Kadin Lee-Smith
class Contact(db.Model):
    __tablename__ = 'contacts'

    id = db.Column(db.Integer, primary_key=True)
    tag = db.Column(db.String(128), index=True, nullable=True)
    organization = db.Column(db.String(256), nullable=True)
    first_name = db.Column(db.String(128), nullable=True)
    last_name = db.Column(db.String(128), nullable=True)
    title = db.Column(db.String(256), nullable=True)
    phone_office = db.Column(db.String(64), nullable=True)
    phone_cell = db.Column(db.String(64), nullable=True)
    email = db.Column(db.String(320), unique=True, index=True, nullable=True)
    added = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    active = db.Column(db.String(32), nullable=True)
    lists = db.Column(db.JSON, nullable=True)
    county = db.Column(db.String(128), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    data_complete = db.Column(db.Boolean, default=False, nullable=False)
    is_favorite = db.Column(db.Boolean, default=False, nullable=False, index=True)
    # Set when someone clicks the unsubscribe link in a sent email -- the
    # email builder's send route excludes these contacts, but the rest of
    # the app (exports, Draft Email, the main list) still shows them.
    # unsubscribe_token is the lookup key for that link (not the contact's
    # id) so the link can't be used to guess-unsubscribe other contacts.
    unsubscribed = db.Column(db.Boolean, default=False, nullable=False, index=True)
    unsubscribe_token = db.Column(db.String(64), unique=True, nullable=True, index=True)
    pipeline_stage = db.Column(db.String(32), nullable=True, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True, index=True)

    # Extended fields from the expanded spreadsheet format
    salutation           = db.Column(db.String(64), nullable=True)
    middle_initial       = db.Column(db.String(128), nullable=True)
    suffix               = db.Column(db.String(256), nullable=True)
    email_secondary      = db.Column(db.String(512), nullable=True)
    industry             = db.Column(db.String(256), nullable=True)
    email_status         = db.Column(db.String(128), nullable=True)
    phone_personal       = db.Column(db.String(128), nullable=True)
    phone_misc           = db.Column(db.String(128), nullable=True)
    street               = db.Column(db.String(512), nullable=True)
    city                 = db.Column(db.String(256), nullable=True)
    state                = db.Column(db.String(128), nullable=True)
    zip_code             = db.Column(db.String(128), nullable=True)
    website              = db.Column(db.String(512), nullable=True)
    duns_number          = db.Column(db.String(128), nullable=True)
    b2gnow_vendor_number = db.Column(db.String(128), nullable=True)
    cmbl_status          = db.Column(db.String(128), nullable=True)
    certification_type   = db.Column(db.String(512), nullable=True)
    dba_name             = db.Column(db.String(512), nullable=True)
    certifying_agency    = db.Column(db.String(512), nullable=True)

    __table_args__ = (
        Index('ix_contacts_name', 'first_name', 'last_name'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'tag': self.tag,
            'organization': self.organization,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'title': self.title,
            'phone_office': self.phone_office,
            'phone_cell': self.phone_cell,
            'email': self.email,
            'added': self.added.isoformat() if self.added else None,
            'active': self.active,
            'lists': self.lists or [],
            'county': self.county,
            'notes': self.notes,
            'data_complete': bool(self.data_complete),
            'is_favorite': bool(self.is_favorite),
            'unsubscribed': bool(self.unsubscribed),
            'pipeline_stage': self.pipeline_stage,
            'deleted_at': self.deleted_at.isoformat() if self.deleted_at else None,
            'score': self._score(),
            'salutation': self.salutation,
            'middle_initial': self.middle_initial,
            'suffix': self.suffix,
            'email_secondary': self.email_secondary,
            'industry': self.industry,
            'email_status': self.email_status,
            'phone_personal': self.phone_personal,
            'phone_misc': self.phone_misc,
            'street': self.street,
            'city': self.city,
            'state': self.state,
            'zip_code': self.zip_code,
            'website': self.website,
            'duns_number': self.duns_number,
            'b2gnow_vendor_number': self.b2gnow_vendor_number,
            'cmbl_status': self.cmbl_status,
            'certification_type': self.certification_type,
            'dba_name': self.dba_name,
            'certifying_agency': self.certifying_agency,
        }

    def _score(self):
        s = 0
        if self.email:                                              s += 20
        if self.phone_office or self.phone_cell or self.phone_personal: s += 15
        if self.organization:                                       s += 10
        if self.tag:                                                s += 10
        if self.title:                                              s += 10
        if self.notes:                                              s += 10
        if self.county:                                             s += 5
        if self.street:                                             s += 5
        if self.website:                                            s += 5
        if self.email_secondary:                                    s += 5
        if self.industry:                                           s += 5
        return min(s, 100)


# Community organization outreach tracking — Kadin Lee-Smith
class OutreachOrg(db.Model):
    """Organization-level outreach checklist (category + org + last-touched date + notes),
    distinct from the per-person Contact table. Backs the Sections page."""
    __tablename__ = 'outreach_orgs'

    id = db.Column(db.Integer, primary_key=True)
    tag = db.Column(db.String(128), index=True, nullable=False)
    organization = db.Column(db.String(256), nullable=False)
    updated = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)

    __table_args__ = (
        Index('ix_outreach_orgs_tag_org', 'tag', 'organization'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'tag': self.tag,
            'organization': self.organization,
            'updated': self.updated.isoformat() if self.updated else None,
            'notes': self.notes,
        }


class AuditLog(db.Model):
    """Who did what -- contact/org changes, spreadsheet syncs, user-account
    changes. actor_name is a snapshot of the user's display name at the time
    of the action, so the log stays readable even if that account is later
    renamed or removed."""
    __tablename__ = 'audit_log'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    actor_name = db.Column(db.String(120), nullable=False)
    action = db.Column(db.String(64), nullable=False, index=True)
    entity_type = db.Column(db.String(32), nullable=False, index=True)
    entity_id = db.Column(db.Integer, nullable=True)
    entity_label = db.Column(db.String(256), nullable=True)
    details = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'actor_name': self.actor_name,
            'action': self.action,
            'entity_type': self.entity_type,
            'entity_id': self.entity_id,
            'entity_label': self.entity_label,
            'details': self.details,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Activity(db.Model):
    """A logged outreach touchpoint. Lets staff see, before reaching out,
    whether someone (or an organization) has already been contacted --
    by whom, when, and what was discussed."""
    __tablename__ = 'activities'

    id = db.Column(db.Integer, primary_key=True)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=True, index=True)
    organization = db.Column(db.String(256), nullable=True, index=True)
    employee_name = db.Column(db.String(128), nullable=False)
    channel = db.Column(db.String(32), nullable=True)
    summary = db.Column(db.Text, nullable=False)
    contacted_on = db.Column(db.Date, nullable=False, default=date.today)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    contact = db.relationship('Contact', backref=db.backref('activities', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'contact_id': self.contact_id,
            'organization': self.organization,
            'employee_name': self.employee_name,
            'channel': self.channel,
            'summary': self.summary,
            'contacted_on': self.contacted_on.isoformat() if self.contacted_on else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class CaseStudy(db.Model):
    """A past-project writeup (challenge/solution/results) staff can browse
    or reference when prepping outreach. Add/edit/delete is admin-only --
    viewing is open to everyone logged in, same as the rest of the app."""
    __tablename__ = 'case_studies'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(256), nullable=False)
    client = db.Column(db.String(256), nullable=True)
    sector = db.Column(db.String(128), index=True, nullable=True)
    challenges = db.Column(db.Text, nullable=True)
    solution = db.Column(db.Text, nullable=True)
    results = db.Column(db.Text, nullable=True)
    # Uploaded-file path: the original file is kept as-is (downloadable via
    # /case-studies/<id>/file) and its text is best-effort extracted for
    # search -- no AI involved. Manually-typed entries leave these null.
    file_data = db.Column(db.LargeBinary, nullable=True)
    file_name = db.Column(db.String(256), nullable=True)
    file_mimetype = db.Column(db.String(128), nullable=True)
    extracted_text = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'client': self.client,
            'sector': self.sector,
            'challenges': self.challenges,
            'solution': self.solution,
            'results': self.results,
            'has_file': bool(self.file_data),
            'file_name': self.file_name,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Task(db.Model):
    """A scheduled follow-up action tied to a contact. Overdue/due-today
    tasks drive the header badge so nothing slips through the cracks."""
    __tablename__ = 'tasks'

    id = db.Column(db.Integer, primary_key=True)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=True, index=True)
    title = db.Column(db.String(512), nullable=False)
    due_date = db.Column(db.Date, nullable=True)
    completed = db.Column(db.Boolean, default=False, nullable=False, index=True)
    notes = db.Column(db.Text, nullable=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    completed_at = db.Column(db.DateTime, nullable=True)

    contact = db.relationship('Contact', backref=db.backref('task_list', lazy='dynamic'))
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    def to_dict(self):
        contact_name = None
        if self.contact:
            contact_name = ' '.join(
                p for p in [self.contact.first_name or '', self.contact.last_name or ''] if p
            ).strip() or None
        return {
            'id': self.id,
            'contact_id': self.contact_id,
            'contact_name': contact_name,
            'title': self.title,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'completed': bool(self.completed),
            'notes': self.notes,
            'created_by_name': self.created_by.display_name if self.created_by else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }


class Group(db.Model):
    """A named, hand-picked list of contacts (e.g. "2026 Gala Invitees") --
    contact_ids is a simple JSON list rather than a join table, matching
    how Contact.lists already stores per-contact email-list membership."""
    __tablename__ = 'groups'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(256), nullable=False)
    description = db.Column(db.Text, nullable=True)
    contact_ids = db.Column(db.JSON, nullable=True, default=list)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_by = db.relationship('User', foreign_keys=[created_by_id], lazy='joined')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'contact_ids': self.contact_ids or [],
            'contact_count': len(self.contact_ids or []),
            'created_by_name': self.created_by.display_name if self.created_by else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
