-- Add Meta sender ID columns to contacts for cross-channel matching
-- facebook_psid: Page-Scoped ID for Facebook Messenger
-- instagram_id:  Instagram-Scoped ID for Instagram DMs

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS facebook_psid TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id TEXT;

-- Indexes for fast lookup by Meta sender IDs
CREATE INDEX IF NOT EXISTS idx_contacts_facebook_psid
  ON contacts (practice_id, facebook_psid) WHERE facebook_psid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id
  ON contacts (practice_id, instagram_id) WHERE instagram_id IS NOT NULL;
