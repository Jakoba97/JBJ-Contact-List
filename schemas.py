from marshmallow import Schema, fields


class ContactSchema(Schema):
    id = fields.Int(dump_only=True)
    tag = fields.Str(allow_none=True)
    organization = fields.Str(allow_none=True)
    first_name = fields.Str(allow_none=True)
    last_name = fields.Str(allow_none=True)
    title = fields.Str(allow_none=True)
    phone_office = fields.Str(allow_none=True)
    phone_cell = fields.Str(allow_none=True)
    email = fields.Email(allow_none=True)
    added = fields.DateTime(dump_only=True)
    active = fields.Str(allow_none=True)
    lists = fields.List(fields.Str())
    archived_constant_contact = fields.List(fields.Str())
    county = fields.Str(allow_none=True)
    industry = fields.Str(allow_none=True)
    notes = fields.Str(allow_none=True)
    data_complete = fields.Bool()
