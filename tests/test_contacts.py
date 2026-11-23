def test_stats_includes_organizations_and_complete_pct(standard_client):
    res = standard_client.get('/api/stats')
    assert res.status_code == 200
    body = res.get_json()
    assert 'organizations' in body
    assert 'complete_pct' in body


def test_complete_pct_reflects_email_or_phone_on_file(standard_client):
    # "Complete" is derived from having an email or phone on file, not the
    # unused data_complete flag (nothing in the UI ever sets that).
    standard_client.post('/api/contacts', json={'first_name': 'Has', 'last_name': 'Email', 'email': 'has@example.com'})
    standard_client.post('/api/contacts', json={'first_name': 'No', 'last_name': 'Contact Info'})

    res = standard_client.get('/api/stats')
    body = res.get_json()
    assert body['total'] == 2
    assert body['incomplete'] == 1
    assert body['complete_pct'] == 50


def test_create_contact_requires_login(client):
    # /api/ routes return 401 JSON (not a redirect) when unauthenticated --
    # see require_login() in app.py.
    res = client.post('/api/contacts', json={'first_name': 'Jane', 'last_name': 'Doe'})
    assert res.status_code == 401


def test_create_and_fetch_contact(standard_client):
    res = standard_client.post('/api/contacts', json={
        'first_name': 'Jane', 'last_name': 'Doe', 'organization': 'Acme',
        'email': 'jane.doe@example.com',
    })
    assert res.status_code == 201
    contact_id = res.get_json()['id']

    res = standard_client.get(f'/api/contacts/{contact_id}')
    assert res.status_code == 200
    assert res.get_json()['email'] == 'jane.doe@example.com'


def test_exact_email_duplicate_is_blocked_case_insensitively(standard_client):
    standard_client.post('/api/contacts', json={
        'first_name': 'Jane', 'last_name': 'Doe', 'organization': 'Acme',
        'email': 'jane.doe@example.com',
    })
    res = standard_client.post('/api/contacts', json={
        'first_name': 'Someone', 'last_name': 'Else', 'organization': 'Other Org',
        'email': 'JANE.DOE@EXAMPLE.COM',
    })
    assert res.status_code == 409
    assert res.get_json()['error'] == 'email exists'


def test_likely_duplicate_name_and_org_warns_without_force(standard_client):
    standard_client.post('/api/contacts', json={
        'first_name': 'Jordan', 'last_name': 'Smith', 'organization': 'Acme Test Co',
        'email': 'jordan@example.com',
    })
    res = standard_client.post('/api/contacts', json={
        'first_name': 'jordan', 'last_name': 'SMITH', 'organization': 'acme test co',
        'email': 'different@example.com',
    })
    assert res.status_code == 409
    body = res.get_json()
    assert body['warning'] == 'possible_duplicate'


def test_likely_duplicate_can_be_force_created(standard_client):
    standard_client.post('/api/contacts', json={
        'first_name': 'Jordan', 'last_name': 'Smith', 'organization': 'Acme Test Co',
        'email': 'jordan@example.com',
    })
    res = standard_client.post('/api/contacts', json={
        'first_name': 'jordan', 'last_name': 'SMITH', 'organization': 'acme test co',
        'email': 'different@example.com', 'force_create': True,
    })
    assert res.status_code == 201


def test_update_contact_tracks_changes_in_audit_log(admin_client):
    res = admin_client.post('/api/contacts', json={'first_name': 'Jane', 'last_name': 'Doe', 'title': 'Old Title'})
    contact_id = res.get_json()['id']

    res = admin_client.put(f'/api/contacts/{contact_id}', json={'title': 'New Title'})
    assert res.status_code == 200

    res = admin_client.get('/admin/audit')
    assert res.status_code == 200
    body = res.get_data(as_text=True)
    assert 'Old Title' in body and 'New Title' in body


def test_update_contact_email_conflict_is_case_insensitive(standard_client):
    standard_client.post('/api/contacts', json={'first_name': 'A', 'last_name': 'B', 'email': 'taken@example.com'})
    res = standard_client.post('/api/contacts', json={'first_name': 'C', 'last_name': 'D', 'email': 'other@example.com'})
    other_id = res.get_json()['id']

    res = standard_client.put(f'/api/contacts/{other_id}', json={'email': 'TAKEN@EXAMPLE.COM'})
    assert res.status_code == 409
    assert res.get_json()['error'] == 'email exists'


def test_needs_followup_filter_never_contacted(standard_client):
    standard_client.post('/api/contacts', json={'first_name': 'Never', 'last_name': 'Contacted'})
    res = standard_client.get('/api/contacts?followup=never')
    assert res.status_code == 200
    names = [c['first_name'] for c in res.get_json()['contacts']]
    assert 'Never' in names


def test_needs_followup_filter_excludes_recently_contacted(standard_client):
    res = standard_client.post('/api/contacts', json={'first_name': 'Recently', 'last_name': 'Contacted'})
    contact_id = res.get_json()['id']
    standard_client.post(f'/api/contacts/{contact_id}/activity', json={'summary': 'Talked today'})

    res = standard_client.get('/api/contacts?followup=30')
    names = [c['first_name'] for c in res.get_json()['contacts']]
    assert 'Recently' not in names


def test_new_contact_defaults_to_not_favorite(standard_client):
    # Favorites are per-user, so is_favorite is reported when a contact is
    # loaded (the create response doesn't include it).
    res = standard_client.post('/api/contacts', json={'first_name': 'A', 'last_name': 'B'})
    contact_id = res.get_json()['id']
    assert standard_client.get(f'/api/contacts/{contact_id}').get_json()['is_favorite'] is False


def test_favorite_toggle_and_filter(standard_client):
    res = standard_client.post('/api/contacts', json={'first_name': 'Star', 'last_name': 'Me'})
    contact_id = res.get_json()['id']

    res = standard_client.put(f'/api/contacts/{contact_id}/favorite', json={'is_favorite': True})
    assert res.status_code == 200
    assert res.get_json()['is_favorite'] is True

    res = standard_client.get('/api/contacts?favorites_only=1')
    ids = [c['id'] for c in res.get_json()['contacts']]
    assert contact_id in ids

    standard_client.put(f'/api/contacts/{contact_id}/favorite', json={'is_favorite': False})
    res = standard_client.get('/api/contacts?favorites_only=1')
    ids = [c['id'] for c in res.get_json()['contacts']]
    assert contact_id not in ids


def test_favorite_toggle_is_not_audit_logged(app, admin_client):
    res = admin_client.post('/api/contacts', json={'first_name': 'No', 'last_name': 'Audit'})
    contact_id = res.get_json()['id']

    with app.app_context():
        from models import AuditLog
        count_before = AuditLog.query.count()

    admin_client.put(f'/api/contacts/{contact_id}/favorite', json={'is_favorite': True})

    with app.app_context():
        from models import AuditLog
        count_after = AuditLog.query.count()

    # the create itself is legitimately logged; the favorite toggle should add nothing
    assert count_after == count_before


def test_contact_list_includes_last_contacted_and_last_emailed(standard_client):
    res = standard_client.post('/api/contacts', json={'first_name': 'Recap', 'last_name': 'Person'})
    contact_id = res.get_json()['id']
    standard_client.post(f'/api/contacts/{contact_id}/activity', json={'summary': 'called', 'channel': 'Phone'})
    standard_client.post(f'/api/contacts/{contact_id}/activity', json={'summary': 'emailed', 'channel': 'Email'})

    res = standard_client.get('/api/contacts?q=Recap')
    contact = res.get_json()['contacts'][0]
    assert contact['last_contacted_on'] is not None
    assert contact['last_emailed_on'] is not None


def test_contact_list_last_emailed_is_none_when_no_email_logged(standard_client):
    res = standard_client.post('/api/contacts', json={'first_name': 'Called', 'last_name': 'Only'})
    contact_id = res.get_json()['id']
    standard_client.post(f'/api/contacts/{contact_id}/activity', json={'summary': 'called', 'channel': 'Phone'})

    res = standard_client.get('/api/contacts?q=Called')
    contact = res.get_json()['contacts'][0]
    assert contact['last_contacted_on'] is not None
    assert contact['last_emailed_on'] is None


def test_delete_contact_requires_admin(standard_client):
    res = standard_client.post('/api/contacts', json={'first_name': 'Should', 'last_name': 'Stay'})
    contact_id = res.get_json()['id']

    res = standard_client.delete(f'/api/contacts/{contact_id}')
    assert res.status_code == 403

    res = standard_client.get(f'/api/contacts/{contact_id}')
    assert res.status_code == 200


def _listed_ids(client, **params):
    res = client.get('/api/contacts', query_string={'limit': 100, **params})
    return {c['id'] for c in res.get_json()['contacts']}


def test_admin_can_delete_contact(admin_client):
    # Delete moves the contact to the trash (soft delete) so it can be
    # restored: it drops out of the normal list and shows in the trash view.
    res = admin_client.post('/api/contacts', json={'first_name': 'To', 'last_name': 'Delete'})
    contact_id = res.get_json()['id']
    assert contact_id in _listed_ids(admin_client)

    res = admin_client.delete(f'/api/contacts/{contact_id}')
    assert res.status_code == 200

    assert contact_id not in _listed_ids(admin_client)
    assert contact_id in _listed_ids(admin_client, show_deleted='1')

    assert admin_client.post(f'/api/contacts/{contact_id}/restore').status_code == 200
    assert contact_id in _listed_ids(admin_client)


def test_trashing_contact_keeps_activity_and_purge_removes_it(app, admin_client):
    # Trashing keeps the contact's activity history (it comes back on
    # restore); permanently deleting (purge) removes the contact and it.
    from db import db
    from models import Activity, Contact
    res = admin_client.post('/api/contacts', json={'first_name': 'Has', 'last_name': 'Activity'})
    contact_id = res.get_json()['id']
    admin_client.post(f'/api/contacts/{contact_id}/activity', json={'summary': 'called'})

    assert admin_client.delete(f'/api/contacts/{contact_id}').status_code == 200
    with app.app_context():
        assert Activity.query.filter_by(contact_id=contact_id).count() == 1

    assert admin_client.delete(f'/api/contacts/{contact_id}/purge').status_code == 200
    with app.app_context():
        assert Activity.query.filter_by(contact_id=contact_id).count() == 0
        assert db.session.get(Contact, contact_id) is None


def test_delete_contact_is_audit_logged(admin_client):
    res = admin_client.post('/api/contacts', json={'first_name': 'Audited', 'last_name': 'Deletion'})
    contact_id = res.get_json()['id']

    admin_client.delete(f'/api/contacts/{contact_id}')

    res = admin_client.get('/admin/audit')
    assert 'Audited Deletion' in res.get_data(as_text=True)
