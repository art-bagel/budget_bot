-- TON coin was officially renamed to GRAM. Only the coin's display symbol changes:
-- network_code 'ton', the bank provider 'TON' and the source journal (history) stay as they were.
UPDATE budgeting.crypto_assets SET symbol = 'GRAM' WHERE symbol = 'TON' AND network_code = 'ton' AND contract_address = '';
UPDATE budgeting.crypto_protocol_positions SET asset_symbol = 'GRAM' WHERE asset_symbol = 'TON';
UPDATE budgeting.crypto_protocol_positions SET metadata = replace(metadata::text, '"TON"', '"GRAM"')::jsonb WHERE metadata::text LIKE '%"TON"%';
UPDATE budgeting.portfolio_positions SET title = 'GRAM' WHERE title = 'TON';
UPDATE budgeting.portfolio_positions SET metadata = replace(metadata::text, '"TON"', '"GRAM"')::jsonb WHERE metadata::text LIKE '%"TON"%';
UPDATE budgeting.portfolio_events SET metadata = replace(metadata::text, '"TON"', '"GRAM"')::jsonb WHERE metadata::text LIKE '%"TON"%';
