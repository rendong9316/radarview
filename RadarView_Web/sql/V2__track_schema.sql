-- ============================================================
-- V2: Track Database Schema
-- ============================================================
CREATE DATABASE IF NOT EXISTS radarview_track
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE radarview_track;

CREATE TABLE IF NOT EXISTS batches (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    file_name   VARCHAR(512)  NOT NULL,
    source      VARCHAR(32)   NOT NULL COMMENT 'ADS-B, Radar, RadarRaw',
    track_count INT           NOT NULL DEFAULT 0,
    file_hash   VARCHAR(64)   COMMENT 'SHA-256 hex digest',
    file_size   BIGINT        COMMENT 'File size in bytes',
    imported_by BIGINT        COMMENT 'User ID who imported',
    status      VARCHAR(16)   NOT NULL DEFAULT 'COMPLETED' COMMENT 'PROCESSING, COMPLETED, FAILED',
    error_msg   VARCHAR(2048),
    imported_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_file_name (file_name),
    INDEX idx_source (source),
    INDEX idx_imported_at (imported_at),
    INDEX idx_status (status),
    UNIQUE KEY uk_file_name (file_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Import batches';

CREATE TABLE IF NOT EXISTS batch_tracks (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    batch_id       BIGINT        NOT NULL,
    icao_address   VARCHAR(16)   NOT NULL COMMENT 'ICAO hex address or target ID',
    flight_no      VARCHAR(16)   COMMENT 'IATA flight number',
    icao_flight_no VARCHAR(16)   COMMENT 'ICAO flight number',
    aircraft_type  VARCHAR(16)   COMMENT 'ICAO aircraft type code',
    registration   VARCHAR(16)   COMMENT 'Aircraft registration',
    airline        VARCHAR(8)    COMMENT 'ICAO airline code',
    origin         VARCHAR(8)    COMMENT 'Departure airport IATA',
    destination    VARCHAR(8)    COMMENT 'Arrival airport IATA',
    source         VARCHAR(32)   NOT NULL,
    position_count INT           NOT NULL DEFAULT 0,
    min_timestamp  BIGINT        NOT NULL COMMENT 'Epoch milliseconds',
    max_timestamp  BIGINT        NOT NULL COMMENT 'Epoch milliseconds',
    INDEX idx_batch (batch_id),
    INDEX idx_icao (icao_address),
    INDEX idx_source (source),
    INDEX idx_timerange (min_timestamp, max_timestamp),
    CONSTRAINT fk_bt_batch FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tracks per batch';

CREATE TABLE IF NOT EXISTS track_positions (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    track_id      BIGINT   NOT NULL COMMENT 'FK to batch_tracks.id',
    batch_id      BIGINT   NOT NULL COMMENT 'Denormalized FK to batches.id',
    timestamp     BIGINT   NOT NULL COMMENT 'Epoch milliseconds',
    latitude      DOUBLE   NOT NULL,
    longitude     DOUBLE   NOT NULL,
    altitude      DOUBLE   COMMENT 'Meters',
    heading       DOUBLE   COMMENT 'Degrees 0-360',
    ground_speed  DOUBLE   COMMENT 'Knots',
    vertical_rate DOUBLE   COMMENT 'Feet per minute',
    INDEX idx_track_time (track_id, timestamp),
    INDEX idx_batch_track (batch_id, track_id),
    INDEX idx_batch_id (batch_id),
    CONSTRAINT fk_tp_track FOREIGN KEY (track_id) REFERENCES batch_tracks(id) ON DELETE CASCADE,
    CONSTRAINT fk_tp_batch FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Track position data (high volume)';

-- Business audit log for track operations
CREATE TABLE IF NOT EXISTS business_audit_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT,
    username    VARCHAR(64),
    action      VARCHAR(64) NOT NULL COMMENT 'IMPORT, DELETE_BATCH, VIEW',
    target      VARCHAR(128) COMMENT 'e.g., batchId=123, fileName=abc.csv',
    ip_address  VARCHAR(45),
    detail      VARCHAR(1024),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at),
    INDEX idx_user (user_id),
    INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Business audit log';
