-- ============================================================
-- V3: Migration from SQLite to MySQL
-- Usage: Run after setting up MySQL databases.
-- The SQLite radarview.db must be accessible to this script.
-- This is a reference script; the actual migration should be done
-- by the Java migration tool (radarview-migration).
-- ============================================================

-- Step 1: Ensure tables exist (run V1 and V2 first)

-- Step 2: Migration notes
-- The Java migration tool will:
-- 1. Connect to both SQLite (radarview.db) and MySQL (radarview_track)
-- 2. Read from SQLite:
--    SELECT * FROM batches ORDER BY id
--    SELECT * FROM saved_tracks ORDER BY batch_id, icao_address
-- 3. For each batch:
--    INSERT INTO batches (file_name, source, track_count, imported_at)
--    VALUES (?, ?, ?, ?)
-- 4. For each track in saved_tracks:
--    Parse track_json JSON
--    INSERT INTO batch_tracks (batch_id, icao_address, flight_no, ...)
--    For each position in track positions array:
--      INSERT INTO track_positions (track_id, batch_id, timestamp, lat, lng, ...)
--    Batch insert positions in groups of 500

-- This SQL file serves as documentation of the mapping.
-- The actual migration logic is in Java class:
--   com.radarview.migration.SqliteToMySqlMigration

-- Step 3: Verify migration
-- SELECT COUNT(*) FROM batches;                           -- should match SQLite
-- SELECT COUNT(*) FROM batch_tracks;                      -- should match SQLite saved_tracks
-- SELECT COUNT(*) FROM track_positions;                   -- should match sum of all position counts
