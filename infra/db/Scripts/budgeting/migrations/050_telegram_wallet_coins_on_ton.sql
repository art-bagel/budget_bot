-- Telegram Wallet coins are ordinary TON jettons. Identify them by their
-- TonAPI-whitelisted masters instead of a Telegram service identity, so they
-- match the same coin in on-chain wallets and are priced by master. IDs, lots,
-- positions and journal references keep pointing at the same rows.
UPDATE budgeting.crypto_assets a
SET network_code = 'ton', contract_address = v.master
FROM (VALUES
    ('service:telegram:DOGS', '0:afc49cb8786f21c87045b19ede78fc6b46c51048513f8e9a6d44060199c1bf0c'),
    ('service:telegram:MAJOR', '0:ae3e6d351e576276e439e7168117fd64696fd6014cb90c77b2f2cbaacd4fcc00'),
    ('service:telegram:HMSTR', '0:09f2e59dec406ab26a5259a45d7ff23ef11f3e5c7c21de0b0d2a1cbe52b76b3d')
) AS v(identity, master)
WHERE a.network_code = 'telegram' AND a.contract_address = v.identity;
