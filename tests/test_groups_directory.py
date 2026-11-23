"""Groups card page (/groups-directory), styled like the organizations page."""
from db import db
from models import Contact, Group


def _seed(app):
    with app.app_context():
        a = Contact(first_name='A', email='a@example.com', archived_constant_contact=['Old CC List'])
        b = Contact(first_name='B', email='b@example.com')
        db.session.add_all([a, b])
        db.session.flush()
        g1 = Group(name='Gala <2027>', description='Invitees', contact_ids=[a.id, b.id])
        g2 = Group(name='Board', contact_ids=[a.id])
        db.session.add_all([g1, g2])
        db.session.commit()
        return g1.id, g2.id


def test_lists_groups_with_links_to_group_pages(app, standard_client):
    g1, g2 = _seed(app)
    page = standard_client.get('/groups-directory').data.decode()
    assert 'Gala &lt;2027&gt;' in page            # names are escaped
    assert f'href="/groups/{g1}"' in page and f'href="/groups/{g2}"' in page
    assert 'id="newGroupBtn"' in page
    assert '2 contacts' in page and '1 contact\n' in page
    # Contacts in groups counts each person once (A is in both groups).
    assert '<div class="cd-stat-num">2</div>\n          <div class="cd-stat-label">Contacts in Groups' in page


def test_archived_lists_only_for_admins(app, admin_client, standard_client):
    _seed(app)
    assert 'Old CC List' in admin_client.get('/groups-directory').data.decode()
    staff = standard_client.get('/groups-directory').data.decode()
    assert 'Old CC List' not in staff and 'Archived Constant Contact' not in staff


def test_empty_state(app, standard_client):
    page = standard_client.get('/groups-directory').data.decode()
    assert 'No groups yet' in page


def test_home_page_groups_link_points_to_new_page(app, standard_client):
    assert b'href="/groups-directory"' in standard_client.get('/').data


def test_archived_list_links_to_its_page(app, admin_client):
    _seed(app)
    page = admin_client.get('/groups-directory').data.decode()
    assert 'href="/archived-groups/' in page


def test_group_page_shows_members_and_orgs(app, standard_client):
    with app.app_context():
        a = Contact(first_name='Amy', last_name='Lee', email='amy@example.com', organization='Org One')
        b = Contact(first_name='Bob', last_name='Ray', organization='Org One')
        gone = Contact(first_name='Gone', email='gone@example.com', deleted_at=__import__('datetime').datetime.utcnow())
        out = Contact(first_name='Outsider', email='out@example.com')
        db.session.add_all([a, b, gone, out])
        db.session.flush()
        g = Group(name='Board', description='The board', contact_ids=[a.id, b.id, gone.id])
        db.session.add(g)
        db.session.commit()
        gid, a_id = g.id, a.id
    res = standard_client.get(f'/groups/{gid}')
    assert res.status_code == 200
    page = res.data.decode()
    assert 'Board' in page and 'The board' in page
    assert 'Amy Lee' in page and 'Bob Ray' in page
    assert 'Gone' not in page and 'Outsider' not in page   # trashed / non-members hidden
    assert 'Contacts (2)' in page
    assert '/organizations/Org%20One' in page
    assert f'data-id="{a_id}"' in page                     # remove button
    assert 'id="gdEditBtn"' in page and 'id="gdAddInput"' in page
    assert 'id="gdDeleteBtn"' not in page                       # staff can't delete


def test_group_page_404(app, standard_client):
    assert standard_client.get('/groups/999').status_code == 404


def test_archived_page_admin_only_and_read_only(app, admin_client, standard_client):
    _seed(app)
    aid = admin_client.get('/api/archived-groups').get_json()[0]['id']
    assert standard_client.get(f'/archived-groups/{aid}').status_code == 403
    res = admin_client.get(f'/archived-groups/{aid}')
    assert res.status_code == 200
    page = res.data.decode()
    assert 'Old CC List' in page and 'read only' in page
    assert 'id="gdEditBtn"' not in page and 'id="gdAddInput"' not in page and 'xs gd-remove' not in page
    assert admin_client.get('/archived-groups/0000000000000000').status_code == 404
