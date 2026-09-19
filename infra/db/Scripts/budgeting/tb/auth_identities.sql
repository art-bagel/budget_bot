CREATE SCHEMA IF NOT EXISTS budgeting;

-- Способы входа, привязанные к аккаунту. users.id остается внутренним
-- идентификатором: на нем завязана вся бизнес-логика, провайдеры входа
-- живут отдельным слоем и не влияют на нее.
CREATE TABLE IF NOT EXISTS budgeting.auth_identities (
    provider        varchar(20)  NOT NULL,
    provider_uid    varchar(200) NOT NULL,
    user_id         bigint       NOT NULL REFERENCES budgeting.users(id) ON DELETE CASCADE,
    secret          text,
    failed_attempts smallint     NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (provider, provider_uid),
    CONSTRAINT ck_auth_identities_provider CHECK (provider IN ('telegram', 'password'))
);

CREATE INDEX IF NOT EXISTS ix_auth_identities_user_id
    ON budgeting.auth_identities (user_id);

-- Не больше одного входа каждого типа на пользователя.
-- ponytail: passkey потребует нескольких записей одного провайдера —
-- тогда этот индекс надо будет снять, а CHECK выше расширить.
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_user_provider
    ON budgeting.auth_identities (user_id, provider);
