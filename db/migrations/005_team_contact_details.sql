-- Public-facing details for a team or organisation, shown on its booking page.
-- Teams and organisations share this table, so both get them.

ALTER TABLE teams
  ADD COLUMN website_url   TEXT,
  ADD COLUMN contact_email TEXT,
  ADD COLUMN contact_phone TEXT,
  ADD COLUMN location      TEXT;
