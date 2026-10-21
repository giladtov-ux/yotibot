-- Apply through the approved database migration process before starting updated code.
-- Nullable and additive: existing rows remain unreviewed; no status/ID/text changes.
ALTER TABLE ah_sheli_updates ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
