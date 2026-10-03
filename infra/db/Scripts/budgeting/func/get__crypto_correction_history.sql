CREATE OR REPLACE FUNCTION budgeting.get__crypto_correction_history(_user_id bigint,_anchor_account_id bigint,_limit integer DEFAULT 30,_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a record; ownerkey text;
BEGIN
 SELECT * INTO a FROM budgeting.bank_accounts WHERE id=_anchor_account_id;
 IF a.id IS NULL OR NOT budgeting.has__owner_access(_user_id,a.owner_type,a.owner_user_id,a.owner_family_id) THEN
  RAISE EXCEPTION 'Нет доступа к истории';
 END IF;
 IF _limit NOT BETWEEN 1 AND 100 OR _offset<0 THEN RAISE EXCEPTION 'Некорректная страница'; END IF;
 ownerkey:=a.owner_type||':'||CASE WHEN a.owner_type='user' THEN a.owner_user_id ELSE a.owner_family_id END;
 RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY occurred_at DESC,order_in_timestamp DESC),'[]'::jsonb) FROM (
 SELECT s.id,COALESCE((s.commands->0->'payload'->>'operated_at')::date,s.accounting_date) accounting_date,s.occurred_at,s.order_in_timestamp,s.revision,s.reversible,
 (SELECT jsonb_agg(c||jsonb_build_object('editable_fields',budgeting.get__crypto_correction_fields(c->>'kind')) ORDER BY ord)
 FROM jsonb_array_elements(s.commands) WITH ORDINALITY v(c,ord)) commands,
 (SELECT string_agg(DISTINCT COALESCE(p.title,c->'payload'->>'title',pp.protocol_name,ca.symbol)||CASE WHEN c->>'kind'='swap' THEN ' → '||COALESCE(ca.symbol,'') ELSE '' END,' / ')
 FROM jsonb_array_elements(s.commands) c
 LEFT JOIN budgeting.portfolio_positions p ON p.id=COALESCE(c->'payload'->>'source_position_id',c->'payload'->>'position_id')::bigint
 AND (c->>'kind' IN ('swap','transfer','fee','position_income','bank_withdraw','create_protocol') OR c->>'kind' LIKE 'collectible_%')
 LEFT JOIN budgeting.crypto_protocol_positions pp ON pp.id=(c->'payload'->>'position_id')::bigint
 AND c->>'kind' IN ('borrow','repay','liquidate','accrue_interest','protocol_yield','close_protocol','partial_close_protocol','top_up_protocol')
 LEFT JOIN budgeting.crypto_assets ca ON ca.id=COALESCE(c->'payload'->>'crypto_asset_id',c->'payload'->>'to_crypto_asset_id')::bigint) context,

   COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',r.revision,'commands',r.envelope->'commands',
     'superseded_at',r.superseded_at) ORDER BY r.revision DESC) FROM budgeting.crypto_source_revisions r
     WHERE r.source_event_id=s.id),'[]'::jsonb) previous_versions
 FROM budgeting.crypto_source_events s WHERE s.owner_key=ownerkey
 -- Filter non-editable metadata events before pagination.
 AND s.reversible AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(s.commands) c,
     unnest(budgeting.get__crypto_correction_fields(c->>'kind')) field
   WHERE c->'payload'->field IS NOT NULL AND c->'payload'->field <> 'null'::jsonb
 )
 -- Collection editing includes either side of a transfer to this account.
 AND (a.investment_asset_type IS DISTINCT FROM 'collectible' OR (
   EXISTS (SELECT 1 FROM jsonb_array_elements(s.commands) c WHERE c->>'kind' LIKE 'collectible_%')
   AND (s.anchor_account_id=a.id OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(s.commands) c
     WHERE c->>'kind'='collectible_transfer'
       AND a.id IN ((c->'payload'->>'from_account_id')::bigint,(c->'payload'->>'to_account_id')::bigint)
   ))
 ))
 -- Imported technical exchange detail stays out of the ordinary manual editor.
 AND (s.source_namespace IN ('manual-portfolio-v1','manual-collection-v1') OR (s.reversible AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(s.commands) c
   JOIN budgeting.bank_accounts visible ON visible.id=COALESCE(
      (c->'payload'->>'investment_account_id')::bigint,
      (SELECT p.investment_account_id FROM budgeting.portfolio_positions p
       WHERE p.id=COALESCE(c->'payload'->>'source_position_id',c->'payload'->>'position_id')::bigint
       AND c->>'kind' IN ('swap','transfer','fee','position_income','bank_withdraw','create_protocol')),
      (SELECT p.investment_account_id FROM budgeting.crypto_protocol_positions p
       WHERE p.id=(c->'payload'->>'position_id')::bigint
       AND c->>'kind' IN ('borrow','repay','liquidate','accrue_interest','protocol_yield','close_protocol','partial_close_protocol','top_up_protocol')),
      (c->'payload'->>'bank_account_id')::bigint)
   WHERE cardinality(budgeting.get__crypto_correction_fields(c->>'kind'))>0
    AND NOT visible.is_archived
  )))
 ORDER BY occurred_at DESC,order_in_timestamp DESC LIMIT _limit OFFSET _offset) e);
END $f$;
