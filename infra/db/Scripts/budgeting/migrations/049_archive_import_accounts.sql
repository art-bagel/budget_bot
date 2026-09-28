-- One-time compatibility migration; runtime uses only the public archive flag.
UPDATE budgeting.bank_accounts SET is_archived=true, provider_name=NULL
WHERE provider_name='reconstruction_internal';
