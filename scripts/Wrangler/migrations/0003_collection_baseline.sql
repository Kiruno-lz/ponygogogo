-- Start the current test-development collection baseline without migrating old ciphertext.
DELETE FROM collection_documents;
DELETE FROM collection_challenges;
DELETE FROM collection_rate_limits;
