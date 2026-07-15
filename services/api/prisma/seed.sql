-- Fix user password and seed database
-- This script is run automatically on first startup

-- Set the seeded user's password hash.
UPDATE "User"
SET "passwordHash" = '$2b$10$8yaNNEbrEX.hja8kyxyDbeaqlvE5sATATPw8zNMAZM9qiwsx4fYyy'
WHERE email = 'yev.rachkovan@gmail.com';

-- Ensure user exists with correct vault
INSERT INTO "Vault" (id, "ownerId", name, "createdAt", "updatedAt")
VALUES ('vault_001', 'test_user_001', 'Personal Vault', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
