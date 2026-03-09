-- Migration 001: add hints_enabled to users
ALTER TABLE budgeting.users
    ADD COLUMN IF NOT EXISTS hints_enabled boolean NOT NULL DEFAULT true;
