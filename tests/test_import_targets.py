"""Import dialog "Add to" options: contact list / group / organization."""
import io

import pytest

from db import db
from models import Contact, Group, OutreachOrg

CSV = (
    "First Name,Last Name,Email - Work,Company\n"
    "Ada,Import,ada.import@example.com,Old Org\n"
    "Ben,Import,ben.import@example.com,Other Org\n"
)

# Ben has no company: normally dropped, kept when an org is chosen.
NO_COMPANY_CSV = CSV.replace(',Other Org', ',')


@pytest.fixture(autouse=True)
def _sync_upload(monkeypatch):
    # On Vercel the import runs inside the request and returns the result,
    # which saves the tests from polling a background thread.
    monkeypatch.setenv('VERCEL', '1')


def _upload(client, csv=CSV, **fields):
    data = {'file': (io.BytesIO(csv.encode()), 'people.csv')}
    data.update(fields)
    return client.post('/api/upload', data=data, content_type='multipart/form-data')


def _by_email(email):
    return Contact.query.filter_by(email=email).first()


def test_default_import_unchanged(app, admin_client):
    res = _upload(admin_client)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()['contacts']['inserted'] == 2
    with app.app_context():
        assert _by_email('ada.import@example.com').organization == 'Old Org'


def test_import_into_new_group(app, admin_client):
    res = _upload(admin_client, add_group='1', group_name='Gala 2027')
    body = res.get_json()
    assert res.status_code == 200, body
    assert body['targets']['group'] == {'name': 'Gala 2027', 'added': 2}
    assert body['targets']['group_created'] is True
    with app.app_context():
        g = Group.query.filter_by(name='Gala 2027').one()
        ids = {_by_email('ada.import@example.com').id, _by_email('ben.import@example.com').id}
        assert set(g.contact_ids) == ids


def test_import_into_existing_group_keeps_members(app, admin_client):
    with app.app_context():
        g = Group(name='Existing', contact_ids=[999])
        db.session.add(g)
        db.session.commit()
        gid = g.id
    res = _upload(admin_client, add_group='1', group_id=str(gid))
    assert res.status_code == 200, res.get_json()
    with app.app_context():
        assert len(db.session.get(Group, gid).contact_ids) == 3
    # Re-importing doesn't add duplicates.
    _upload(admin_client, add_group='1', group_id=str(gid))
    with app.app_context():
        assert len(db.session.get(Group, gid).contact_ids) == 3


def test_import_into_new_org_creates_directory_entry(app, admin_client):
    res = _upload(admin_client, csv=NO_COMPANY_CSV, add_org='1', organization='Brand New Org',
                  org_category='Dallas Civic')
    body = res.get_json()
    assert res.status_code == 200, body
    assert body['targets']['organization_created'] is True
    with app.app_context():
        assert _by_email('ada.import@example.com').organization == 'Brand New Org'
        assert _by_email('ben.import@example.com').organization == 'Brand New Org'
        assert OutreachOrg.query.filter_by(organization='Brand New Org').one().tag == 'Dallas Civic'


def test_group_only_skips_people_not_in_crm(app, admin_client):
    with app.app_context():
        db.session.add(Contact(first_name='Ada', last_name='Import', email='ada.import@example.com'))
        db.session.commit()
        before = Contact.query.count()
    res = _upload(admin_client, add_contacts='0', add_group='1', group_name='Only Existing')
    body = res.get_json()
    assert res.status_code == 200, body
    assert body['contacts']['not_in_crm'] == 1
    assert body['targets']['group']['added'] == 1
    with app.app_context():
        assert Contact.query.count() == before  # nobody created
        assert _by_email('ada.import@example.com').organization is None  # not updated


def test_blank_company_rows_still_dropped_without_org(app, admin_client):
    res = _upload(admin_client, csv=NO_COMPANY_CSV)
    assert res.get_json()['contacts']['inserted'] == 1


def test_must_choose_somewhere(admin_client):
    assert _upload(admin_client, add_contacts='0').status_code == 400


def test_group_checked_without_choice_is_400(admin_client):
    assert _upload(admin_client, add_group='1').status_code == 400
    assert _upload(admin_client, add_group='1', group_id='424242').status_code == 400


def test_targets_endpoint(app, admin_client, standard_client):
    with app.app_context():
        db.session.add(Group(name='G1', contact_ids=[1, 2]))
        db.session.add(OutreachOrg(tag='Cat A', organization='Dir Org'))
        db.session.commit()
    body = admin_client.get('/api/upload/targets').get_json()
    assert {'id': body['groups'][0]['id'], 'name': 'G1', 'contact_count': 2} in body['groups']
    assert 'Dir Org' in body['organizations']
    cats = body['org_categories']
    assert 'Cat A' in cats and 'Community Stakeholders' in cats
    assert cats[0] == 'Dallas Civic' and len(cats) == len(set(cats))
    assert standard_client.get('/api/upload/targets').status_code == 403
