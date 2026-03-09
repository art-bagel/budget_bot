-- Migration 002: add theme to users
ALTER TABLE budgeting.users
    ADD COLUMN IF NOT EXISTS theme varchar(10) NOT NULL DEFAULT 'system'
        CHECK (theme IN ('light', 'dark', 'system'));
