-- Close the residual 0.06745508 TON of friend loan 44 (borrowed 27.05.2025,
-- 40.3 of 40.36745508 returned 28.05.2025; the friend expects nothing more).
-- A zero-basis receipt from the friend on the loan's own account settles the
-- residual principal; wallet quantities and costs do not change.
SET search_path TO budgeting;
DO $$
DECLARE r jsonb; t timestamptz := (current_date::timestamp + interval '1 day' - interval '1 microsecond') AT TIME ZONE 'UTC';
  ord bigint; pos bigint;
BEGIN
  IF (SELECT (metadata->>'borrowed_quantity')::numeric FROM crypto_protocol_positions WHERE id=44) <> 0.06745508 THEN
    RAISE EXCEPTION 'Loan 44 changed; review before settling';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crypto-source:user:478559604',0));
  SELECT COALESCE(max(order_in_timestamp)+1,0) INTO ord FROM crypto_source_events WHERE owner_key='user:478559604' AND occurred_at=t;
  r := put__crypto_source_event(478559604, 100, 'manual-portfolio-v1', 'friend-loan-44-residual-receipt', t, ord, current_date,
    jsonb_build_array(jsonb_build_object('kind','receive_unknown','payload',jsonb_build_object(
      'investment_account_id',100,'crypto_asset_id',1,'quantity','0.06745508','basis_assumption','owner_zero',
      'comment','Остаток займа друга от 27.05.2025 не возвращается: друг в расчёте'))),
    jsonb_build_object('manual_kind','friend_loan_residual_settlement','position_id',44));
  SELECT position_id INTO pos FROM portfolio_events WHERE id = (r->'results'->0->>'event_id')::bigint;
  PERFORM put__manual_crypto_movement(478559604, '6f0d9a9e-44b2-4c55-9d7a-0c7c5e1e4444'::uuid, 'repay', jsonb_build_object(
    'position_id',44,'source_position_id',pos,'repay_qty','0.06745508','interest_qty','0',
    'comment','Закрытие остатка займа друга без платежа'));
END $$;
