-- Link each copied form submission to its Netlify Forms submission ID,
-- so the same submission is never stored twice (event copy + portal sync).
ALTER TABLE signups          ADD COLUMN IF NOT EXISTS netlify_id TEXT UNIQUE;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS netlify_id TEXT UNIQUE;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS netlify_id TEXT UNIQUE;
