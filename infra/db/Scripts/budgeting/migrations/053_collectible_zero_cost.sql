-- Items bought with zero-cost coins (rewards, gifts) carry zero cost, like crypto.
ALTER TABLE budgeting.portfolio_positions
    DROP CONSTRAINT IF EXISTS chk_portfolio_positions_amount;

ALTER TABLE budgeting.portfolio_positions
    ADD CONSTRAINT chk_portfolio_positions_amount CHECK (
        (asset_type_code IN ('crypto', 'collectible') AND amount_in_currency >= 0)
        OR
        (asset_type_code NOT IN ('crypto', 'collectible') AND amount_in_currency > 0)
    );
