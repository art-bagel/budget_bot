CREATE SCHEMA IF NOT EXISTS budgeting;

CREATE TABLE IF NOT EXISTS budgeting.family_invitations (
    id bigserial PRIMARY KEY,
    family_id bigint NOT NULL REFERENCES budgeting.families(id) ON DELETE CASCADE,
    invited_user_id bigint NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    invited_by_user_id bigint NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    status varchar(20) NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    responded_at timestamptz
);

-- Only one pending invitation per (family, user) pair is allowed.
-- Accepted/declined rows are not constrained so re-invitation after
-- declining works correctly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_invitations_pending
    ON budgeting.family_invitations (family_id, invited_user_id)
    WHERE status = 'pending';
