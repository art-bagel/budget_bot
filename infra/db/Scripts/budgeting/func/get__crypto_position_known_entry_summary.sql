DROP FUNCTION IF EXISTS budgeting.get__crypto_position_known_entry_summary;
CREATE FUNCTION budgeting.get__crypto_position_known_entry_summary(_position_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE _s jsonb;
BEGIN
    _s:=budgeting.get__crypto_position_entry_summary(_position_id);
    IF (_s->>'basis_quality') NOT IN ('known','confirmed_zero') THEN
        RAISE EXCEPTION 'Себестоимость позиции % не подтверждена (%). Сначала уточните исходные операции.',
            _position_id,_s->>'basis_quality';
    END IF;
    RETURN _s;
END
$function$;
