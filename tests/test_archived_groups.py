from db import db
from models import Contact

TRICKY = [
    '2020 Influencers',
    'TC Broadnax | Austin Reception',
    'Parks & Rec "VIP" List',
    "Children's Health / UTSW",
]


def _seed(app):
    with app.app_context():
        db.session.add_all([
            Contact(first_name='Ann', last_name='A', archived_constant_contact=[TRICKY[0], TRICKY[1]]),
            Contact(first_name='Bob', last_name='B', archived_constant_contact=[TRICKY[1], TRICKY[2], TRICKY[3]]),
            Contact(first_name='Cy', last_name='C', archived_constant_contact=[TRICKY[0]]),
            Contact(first_name='Del', last_name='D', archived_constant_contact=[]),
        ])
        db.session.commit()


def test_archived_groups_list_has_ids_and_counts(app, standard_client):
    _seed(app)
    groups = standard_client.get('/api/archived-groups').get_json()
    by_name = {g['name']: g for g in groups}
    assert set(by_name) == set(TRICKY)
    assert by_name['2020 Influencers']['contact_count'] == 2
    assert by_name['TC Broadnax | Austin Reception']['contact_count'] == 2
    assert all(g['id'] and g['id'].isalnum() for g in groups)
    assert len({g['id'] for g in groups}) == len(groups)


def test_archived_group_detail_by_id_matches_card_count(app, standard_client):
    # The bug: names went into the URL and never matched on Vercel, so the
    # popup showed "2020%20Influencers" with 0 contacts.
    _seed(app)
    for g in standard_client.get('/api/archived-groups').get_json():
        res = standard_client.get(f"/api/archived-groups/{g['id']}")
        assert res.status_code == 200
        body = res.get_json()
        assert body['name'] == g['name']
        assert body['contact_count'] == g['contact_count'] == len(body['contacts'])


def test_archived_group_unknown_id_is_404(app, standard_client):
    _seed(app)
    assert standard_client.get('/api/archived-groups/0000000000000000').status_code == 404


def _group_id(client, name):
    return next(g['id'] for g in client.get('/api/archived-groups').get_json() if g['name'] == name)


def test_delete_archived_group_requires_admin(app, standard_client):
    _seed(app)
    gid = _group_id(standard_client, TRICKY[1])
    assert standard_client.delete(f'/api/archived-groups/{gid}').status_code == 403
    assert standard_client.get(f'/api/archived-groups/{gid}').status_code == 200


def test_admin_delete_archived_group_removes_only_that_name(app, admin_client):
    _seed(app)
    with app.app_context():
        before = Contact.query.count()  # the app seeds demo contacts on startup too
    gid = _group_id(admin_client, TRICKY[1])
    res = admin_client.delete(f'/api/archived-groups/{gid}')
    assert res.status_code == 200
    assert res.get_json() == {'deleted': True, 'name': TRICKY[1], 'contacts_updated': 2}

    names = {g['name'] for g in admin_client.get('/api/archived-groups').get_json()}
    assert names == {TRICKY[0], TRICKY[2], TRICKY[3]}
    assert admin_client.get(f'/api/archived-groups/{gid}').status_code == 404
    with app.app_context():
        assert Contact.query.count() == before  # contacts are kept
        bob = Contact.query.filter_by(first_name='Bob').one()
        assert bob.archived_constant_contact == [TRICKY[2], TRICKY[3]]


def test_delete_unknown_archived_group_is_404(app, admin_client):
    _seed(app)
    assert admin_client.delete('/api/archived-groups/0000000000000000').status_code == 404
