-- Receipt scanning is off for every new account, the startup context exposes
-- the flag, and the user settings function cannot switch it on.
BEGIN;
SET search_path TO budgeting;

DO $$
DECLARE
    _user_id bigint := 990000000061;
BEGIN
    INSERT INTO currencies (code, name) VALUES ('RUB', 'Российский рубль')
    ON CONFLICT (code) DO NOTHING;
    PERFORM put__register_user_context(_user_id, 'RUB', NULL, 'Receipt', 'Flag');

    ASSERT (get__user_context(_user_id)->>'receipt_scan_enabled')::boolean = false,
        'new accounts start with receipt scanning off';

    PERFORM set__update_user_settings(_user_id, false, 'dark');
    ASSERT (get__user_context(_user_id)->>'receipt_scan_enabled')::boolean = false,
        'user settings do not touch the flag';

    UPDATE users SET receipt_scan_enabled = true WHERE id = _user_id;
    ASSERT (get__user_context(_user_id)->>'receipt_scan_enabled')::boolean = true,
        'the owner switches it on in the database';
END
$$;

ROLLBACK;
