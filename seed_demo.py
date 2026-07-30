"""
seed_demo.py — Populates the database with realistic fake data for portfolio demos.
Run once on a fresh database: python seed_demo.py
"""

import os
import random
from datetime import date, timedelta
from app import create_app
from models import db, Contact, OutreachOrg, User, Activity

FIRST_NAMES = [
    "James", "Maria", "David", "Linda", "Robert", "Patricia", "Michael", "Barbara",
    "William", "Susan", "Richard", "Jessica", "Joseph", "Sarah", "Thomas", "Karen",
    "Charles", "Lisa", "Christopher", "Nancy", "Daniel", "Betty", "Matthew", "Margaret",
    "Anthony", "Sandra", "Mark", "Ashley", "Donald", "Dorothy", "Steven", "Kimberly",
    "Paul", "Emily", "Andrew", "Donna", "Kenneth", "Michelle", "George", "Carol",
    "Joshua", "Amanda", "Kevin", "Melissa", "Brian", "Deborah", "Edward", "Stephanie",
]

LAST_NAMES = [
    "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez",
    "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
    "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
    "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
    "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter",
]

ORGANIZATIONS = [
    ("City of Dallas", "Municipal Government"),
    ("Dallas County", "County Government"),
    ("Dallas ISD", "Education"),
    ("North Texas Council of Governments", "Regional Government"),
    ("Dallas Area Rapid Transit", "Transportation"),
    ("Greater Dallas Chamber", "Business"),
    ("Dallas Black Chamber of Commerce", "Business"),
    ("United Way of Metropolitan Dallas", "Nonprofit"),
    ("Communities Foundation of Texas", "Nonprofit"),
    ("North Texas Food Bank", "Nonprofit"),
    ("Parkland Health", "Healthcare"),
    ("UT Southwestern Medical Center", "Healthcare"),
    ("Southern Methodist University", "Education"),
    ("University of Texas at Dallas", "Education"),
    ("Dallas Independent School District", "Education"),
    ("Texas Department of Transportation", "State Government"),
    ("Texas Education Agency", "State Government"),
    ("Office of the Governor", "State Government"),
    ("Dallas City Council", "Municipal Government"),
    ("Dallas Housing Authority", "Municipal Government"),
]

TITLES = [
    "Executive Director", "Chief of Staff", "Deputy Director", "Policy Advisor",
    "Communications Director", "Government Affairs Manager", "Senior Advisor",
    "Director of Community Engagement", "Deputy Chief of Staff", "Program Manager",
    "Legislative Liaison", "Public Affairs Coordinator", "Chief Operating Officer",
    "Director of External Affairs", "Senior Policy Analyst", "Vice President",
    "Community Relations Manager", "Director of Development", "Chief Executive Officer",
    "Assistant Director", "Senior Manager", "Director of Operations",
]

TAGS = [
    "City Council", "County Official", "State Legislator", "Nonprofit Leader",
    "Business Leader", "Education Leader", "Healthcare", "Transportation",
    "Advocacy Agency", "Community Organizer",
]

COUNTIES = ["Dallas", "Tarrant", "Collin", "Denton", "Rockwall"]

ACTIVITY_SUMMARIES = [
    "Called to discuss upcoming budget session. Will follow up next week.",
    "Met at Chamber event. Expressed interest in partnership opportunities.",
    "Sent briefing on infrastructure priorities. Awaiting response.",
    "Coffee meeting downtown. Discussed community engagement strategy.",
    "Attended town hall. Connected during Q&A session.",
    "Email exchange regarding upcoming legislative session priorities.",
    "Introduced at nonprofit gala. Exchanged cards, scheduling follow-up.",
    "Phone call re: procurement opportunities. Very receptive.",
    "Attended city council meeting. Brief conversation after adjournment.",
    "Sent proposal overview. Requested 30-minute call to review.",
]

CHANNELS = ["phone", "email", "in-person", "event"]


def random_date(days_back=365):
    return date.today() - timedelta(days=random.randint(0, days_back))


def random_phone():
    area = random.choice(["214", "972", "469", "817", "682"])
    return f"({area}) {random.randint(200,999)}-{random.randint(1000,9999)}"


def seed():
    app = create_app()
    with app.app_context():
        # Clear existing demo data (keeps admin users)
        Activity.query.delete()
        Contact.query.filter_by().delete()
        db.session.commit()

        # Create demo admin if none exists
        if not User.query.filter_by(username="admin@demo.com").first():
            admin = User(
                username="admin@demo.com",
                display_name="Demo Admin",
                is_admin=True,
            )
            admin.set_password("demo1234")
            db.session.add(admin)

        # Create demo staff user
        if not User.query.filter_by(username="staff@demo.com").first():
            staff = User(
                username="staff@demo.com",
                display_name="Demo Staff",
                is_admin=False,
                can_draft_email=True,
                can_export_contacts=True,
            )
            staff.set_password("demo1234")
            db.session.add(staff)

        db.session.commit()
        print("✔ Demo users created")
        print("  admin@demo.com  /  demo1234  (full admin)")
        print("  staff@demo.com  /  demo1234  (contacts + draft + export)")

        # Seed 60 fake contacts
        contacts = []
        used_emails = set()
        for i in range(60):
            first = random.choice(FIRST_NAMES)
            last = random.choice(LAST_NAMES)
            org_name, industry = random.choice(ORGANIZATIONS)
            title = random.choice(TITLES)
            county = random.choice(COUNTIES)
            tag = random.choice(TAGS)

            # Unique email
            base = f"{first.lower()}.{last.lower()}"
            email = f"{base}@{org_name.lower().replace(' ', '').replace(',', '')[:12]}.org"
            if email in used_emails:
                email = f"{base}{i}@{org_name.lower().replace(' ', '')[:10]}.org"
            used_emails.add(email)

            c = Contact(
                first_name=first,
                last_name=last,
                organization=org_name,
                title=title,
                email=email,
                phone_cell=random_phone() if random.random() > 0.3 else None,
                phone_office=random_phone() if random.random() > 0.5 else None,
                tag=tag,
                county=county,
                industry=industry,
                active="Active" if random.random() > 0.15 else "Inactive",
                added=random_date(400),
                data_complete=random.random() > 0.2,
                is_favorite=random.random() > 0.85,
            )
            db.session.add(c)
            contacts.append(c)

        db.session.commit()
        print(f"✔ {len(contacts)} demo contacts seeded")

        # Seed activity logs for ~30 contacts
        sample_contacts = random.sample(contacts, 30)
        activities_added = 0
        for c in sample_contacts:
            num_activities = random.randint(1, 3)
            for _ in range(num_activities):
                a = Activity(
                    contact_id=c.id,
                    organization=c.organization,
                    employee_name="Demo Admin",
                    channel=random.choice(CHANNELS),
                    summary=random.choice(ACTIVITY_SUMMARIES),
                    contacted_on=random_date(180),
                )
                db.session.add(a)
                activities_added += 1

        db.session.commit()
        print(f"✔ {activities_added} activity log entries seeded")
        print("\nDemo database ready. Run: python app.py")


if __name__ == "__main__":
    seed()
