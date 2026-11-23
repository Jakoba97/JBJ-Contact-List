"""Org page "Add Contacts to Group" button."""
from urllib.parse import quote

from db import db
from models import Contact, Group, OutreachOrg


def _seed(app):
    with app.app_context():
        db.session.add(OutreachOrg(tag='Clergy', organization='Grace Church'))
        a = Contact(first_name='Amy', last_name='Pew', email='amy.pew@example.com', organization='Grace Church')
        b = Contact(first_name='Bo', last_name='Pew', email='bo.pew@example.com', organization='Grace Church')
        other = Contact(first_name='Cy', last_name='Else', email='cy@example.com', organization='Elsewhere')
        db.session.add_all([a, b, other])
        db.session.commit()
        return a.id, b.id, other.id


def test_button_and_window_list_only_this_orgs_contacts(app, standard_client):
    a, b, other = _seed(app)
    page = standard_client.get('/organizations/' + quote('Grace Church')).data.decode()
    assert 'Add Contacts to Group' in page
    assert 'id="ogOverlay"' in page
    assert f'class="og-cb" value="{a}"' in page and f'class="og-cb" value="{b}"' in page
    assert f'class="og-cb" value="{other}"' not in page


def test_button_disabled_when_org_has_no_contacts(app, standard_client):
    with app.app_context():
        db.session.add(OutreachOrg(tag='Clergy', organization='Empty Org'))
        db.session.commit()
    page = standard_client.get('/organizations/Empty%20Org').data.decode()
    assert 'This organization has no contacts yet' in page
    assert 'id="ogOverlay"' not in page


def test_group_calls_the_window_makes_work_for_staff(app, standard_client):
    # The window creates a group with contact_ids, or adds contact_ids to one.
    a, b, _ = _seed(app)
    res = standard_client.post('/api/groups', json={'name': 'Grace Outreach', 'contact_ids': [a]})
    assert res.status_code == 201
    gid = res.get_json()['id']
    res = standard_client.post(f'/api/groups/{gid}/contacts', json={'contact_ids': [a, b]})
    assert res.status_code == 200 and res.get_json()['contact_count'] == 2
    # Duplicate name -> 409 with the existing id, which the window falls back to.
    dup = standard_client.post('/api/groups', json={'name': 'grace outreach', 'contact_ids': [a]})
    assert dup.status_code == 409 and dup.get_json()['id'] == gid
    with app.app_context():
        assert sorted(db.session.get(Group, gid).contact_ids) == sorted([a, b])
