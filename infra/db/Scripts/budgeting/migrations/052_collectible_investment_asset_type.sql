-- Collections: an investment account type for items (Telegram gifts, stickers,
-- CS2 skins, physical collectibles). Items are ordinary portfolio positions of
-- type 'collectible' bought and sold for the account's money.
ALTER TABLE budgeting.bank_accounts
    DROP CONSTRAINT IF EXISTS chk_bank_accounts_investment_asset_type;

ALTER TABLE budgeting.bank_accounts
    ADD CONSTRAINT chk_bank_accounts_investment_asset_type CHECK (
        (account_kind != 'investment' AND investment_asset_type IS NULL)
        OR
        (account_kind = 'investment' AND investment_asset_type IN ('security', 'deposit', 'crypto', 'other', 'collectible'))
    );
