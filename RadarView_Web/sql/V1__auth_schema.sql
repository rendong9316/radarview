-- ============================================================
-- V1: Auth Database Schema
-- ============================================================
CREATE DATABASE IF NOT EXISTS radarview_auth
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE radarview_auth;

CREATE TABLE IF NOT EXISTS sys_user (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(64)  NOT NULL UNIQUE,
    password    VARCHAR(256) NOT NULL COMMENT 'BCrypt hash',
    nickname    VARCHAR(64),
    email       VARCHAR(128),
    enabled     TINYINT      NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='System users';

CREATE TABLE IF NOT EXISTS sys_role (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    role_code   VARCHAR(32) NOT NULL UNIQUE COMMENT 'ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER',
    role_name   VARCHAR(64) NOT NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='System roles';

CREATE TABLE IF NOT EXISTS sys_permission (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    perm_code   VARCHAR(64) NOT NULL UNIQUE COMMENT 'track:import, track:delete, batch:view',
    perm_name   VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='System permissions';

CREATE TABLE IF NOT EXISTS sys_user_role (
    user_id     BIGINT NOT NULL,
    role_id     BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='User-role mapping';

CREATE TABLE IF NOT EXISTS sys_role_permission (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE,
    CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES sys_permission(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Role-permission mapping';

CREATE TABLE IF NOT EXISTS auth_audit_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT,
    username    VARCHAR(64),
    action      VARCHAR(64) NOT NULL COMMENT 'LOGIN, LOGOUT, TOKEN_REFRESH, ACCESS_DENIED',
    ip_address  VARCHAR(45),
    user_agent  VARCHAR(512),
    success     TINYINT NOT NULL DEFAULT 1,
    detail      VARCHAR(1024),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Authentication audit log';

-- ============================================================
-- Seed data: default roles and permissions
-- ============================================================
INSERT INTO sys_role (role_code, role_name) VALUES
    ('ROLE_ADMIN', 'Administrator'),
    ('ROLE_OPERATOR', 'Operator'),
    ('ROLE_VIEWER', 'Viewer')
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

INSERT INTO sys_permission (perm_code, perm_name) VALUES
    ('track:import', 'Import track data'),
    ('track:delete', 'Delete track data'),
    ('track:view', 'View track data'),
    ('batch:view', 'View import batches'),
    ('batch:delete', 'Delete import batches'),
    ('user:manage', 'Manage users')
ON DUPLICATE KEY UPDATE perm_name = VALUES(perm_name);

-- Grant all permissions to ADMIN
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.role_code = 'ROLE_ADMIN'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- Grant track:import, track:view, batch:view to OPERATOR
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.role_code = 'ROLE_OPERATOR' AND p.perm_code IN ('track:import', 'track:view', 'batch:view')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- Grant track:view, batch:view to VIEWER
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.role_code = 'ROLE_VIEWER' AND p.perm_code IN ('track:view', 'batch:view')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- Default admin user (password: admin123, BCrypt encoded)
INSERT INTO sys_user (username, password, nickname, enabled) VALUES
    ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Administrator', 1)
ON DUPLICATE KEY UPDATE username = username;

INSERT INTO sys_user_role (user_id, role_id)
SELECT u.id, r.id FROM sys_user u, sys_role r
WHERE u.username = 'admin' AND r.role_code = 'ROLE_ADMIN'
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);
