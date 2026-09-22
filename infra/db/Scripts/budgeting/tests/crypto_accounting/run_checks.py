"""Run actual repository SQL against an EMPTY disposable PostgreSQL database.

Usage: python3 run_checks.py /absolute/private/tmp/socket_directory port
Never uses environment/default connection strings or the application database.
No production accounting function is modified or mocked. Identity/bank helpers
in fixture.sql are simplified; this is not an API/security/full migration test.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p / 'backend/app').is_dir())
DB = ROOT / 'infra/db/Scripts/budgeting'
socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith('/private/tmp/crypto-portfolio-audit.')
port = int(sys.argv[2])
cmd = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
       '-h', str(socket), '-p', str(port), '-U', 'audit', '-d', 'postgres']

def sql(statement):
    p = subprocess.run(cmd, input=statement, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()

assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='budgeting'") == '0', 'Requires empty disposable database'
sql((HERE / 'fixture.sql').read_text())
files = [DB / 'tb' / (n + '.sql') for n in
         ['crypto_assets', 'portfolio_positions', 'portfolio_events', 'crypto_protocol_positions', 'crypto_liability_events', 'crypto_protocol_accrual_events']]
files += [DB / 'func' / (n + '.sql') for n in [
    'get__crypto_position_entry_summary', 'get__crypto_position_known_entry_summary',
    'get__crypto_position_movable_entry_summary', 'check__crypto_lending_state',
    'get__crypto_account_assets', 'get__crypto_asset_detail', 'put__crypto_pay_fee', 'get__crypto_protocol_positions',
    'put__create_crypto_protocol_position', 'put__lending_take_more_debt',
    'put__lending_repay_debt', 'set__close_crypto_protocol_position',
    'put__record_portfolio_income', 'put__swap_crypto_investment_asset',
    'set__update_crypto_protocol_position', 'put__lending_accrue_interest', 'put__lending_liquidate',
    'put__lending_accrue', 'put__transfer_crypto_between_investment_accounts',
    'put__top_up_crypto_protocol_position', 'put__partial_close_crypto_protocol_position']]
for p in files:
    sql(p.read_text())

def seed():
    sql('''TRUNCATE budgeting.portfolio_events, budgeting.portfolio_positions,
        budgeting.crypto_protocol_positions RESTART IDENTITY CASCADE;
        INSERT INTO budgeting.portfolio_positions
         (id,owner_type,owner_user_id,investment_account_id,asset_type_code,title,
          quantity,amount_in_currency,currency_code,metadata,created_by_user_id)
        VALUES(1,'user',1,1,'crypto','TON',200,0,'RUB',
          '{"crypto_asset_id":1,"asset_symbol":"TON","network_code":"ton"}',1),
          (2,'user',1,1,'crypto','USDT',100,0,'RUB',
          '{"crypto_asset_id":2,"asset_symbol":"USDT","network_code":"ton"}',1);
        SELECT setval('budgeting.portfolio_positions_id_seq',2);
        INSERT INTO budgeting.portfolio_events(position_id,event_type,quantity,metadata,created_by_user_id)
        VALUES(1,'open',200,'{"entry_value_in_base":20000}',1),
              (2,'open',100,'{"entry_value_in_base":10000}',1);''')

def deposit():
    return json.loads(sql('''SELECT budgeting.put__create_crypto_protocol_position(
        _user_id=>1,_investment_account_id=>1,_protocol_name=>'EVAA audit',
        _position_type=>'lending',_asset_symbol=>'TON',_quantity=>100,
        _source_position_id=>1,_deposited_at=>'2024-12-31'::date)'''))['id']

def state(position):
    return json.loads(sql(f'SELECT budgeting.get__crypto_position_entry_summary({position})'))

results = []
def record(name, actual, expected):
    results.append(dict(name=name, actual=actual, expected=expected,
                        passed=actual == expected))

seed(); protocol = deposit()
record('collateral_cost_carried', state(1)['remaining_cost_basis'], 10000)
sql(f'SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)')
record('collateral_round_trip', [state(1)['quantity_now'],state(1)['remaining_cost_basis']], [200,20000])
# A second close must not duplicate the return, whether rejected or idempotent.
try:
    sql(f'SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)')
except RuntimeError:
    pass
record('repeat_close_does_not_mint_assets', [state(1)['quantity_now'],state(1)['remaining_cost_basis']], [200,20000])

seed(); protocol = deposit()
sql(f'''SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,
    _value_in_base=>10000,_borrowed_crypto_asset_id=>2)''')
record('borrow_quantity', state(2)['quantity_now'],200)
sql(f'SELECT budgeting.put__lending_repay_debt(1,{protocol},2,100)')
sql(f'SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)')
record('loan_round_trip_preserves_own_cost',
       [state(2)['quantity_now'],state(2)['remaining_cost_basis']], [100,10000])
debt = json.loads(sql(f"SELECT metadata FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('closed_debt_zero_quantity_and_value',
       [debt['borrowed_quantity'],debt['borrowed_value_in_base']], [0,0])
record('collateral_after_loan_round_trip',
       [state(1)['quantity_now'],state(1)['remaining_cost_basis']], [200,20000])

# Two borrowing prices and a different repayment quote: debt cost is weighted,
# while the settlement quote splits (but does not alter) combined realized P&L.
seed(); protocol = deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,10000,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,20000)")
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,50,9000)")
d = json.loads(sql(f"SELECT metadata FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('partial_debt_basis_independent_of_quote', [d['borrowed_quantity'],d['debt_cost_basis_in_base']],[150,22500])
e = json.loads(sql("SELECT metadata FROM budgeting.portfolio_events WHERE metadata->>'action'='lending_repay' ORDER BY id DESC LIMIT 1"))
record('repayment_price_components', [e['asset_realized_in_base'],e['liability_realized_in_base'],e['realized_in_base']], [2333.33,-1500,833.33])
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,150,1000)")
d = json.loads(sql(f"SELECT metadata FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('full_debt_clears_despite_different_quote', [d['borrowed_quantity'],d['debt_cost_basis_in_base']],[0,0])
record('debt_journal_balances',json.loads(sql("SELECT json_build_array(sum(quantity),sum(debt_basis_change_in_base),count(*)) FROM budgeting.crypto_liability_events")),[0,0,4])

# Borrow a previously absent asset, then exchange it using an explicit quote.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},1,10000,_borrowed_crypto_asset_id=>4)")
eth = int(sql("SELECT id FROM budgeting.portfolio_positions WHERE metadata->>'crypto_asset_id'='4' AND status='open'"))
record('new_asset_borrow_has_acquisition_cost',state(eth)['remaining_cost_basis'],10000)
sql(f"SELECT budgeting.put__swap_crypto_investment_asset(1,{eth},1,2,120,_value_in_base=>12000,_operated_at=>'2025-01-01',_valuation_source=>'synthetic trade')")
record('borrowed_asset_swap_carries_trade_value',state(2)['remaining_cost_basis'],22000)
record('borrowed_asset_swap_realizes_gain',float(sql("SELECT (metadata->>'realized_in_base')::numeric FROM budgeting.portfolio_events WHERE event_type='swap_out' ORDER BY id DESC LIMIT 1")),2000)
try:
 sql(f"SELECT budgeting.set__update_crypto_protocol_position(1,{protocol},_metadata=>'{{\"borrowed_quantity\":0}}'::jsonb)")
 rejected=False
except RuntimeError:
 rejected=True
record('debt_projection_cannot_bypass_journal',rejected,True)

# Loan creation via the combined collateral + first borrowing entry point.
seed()
protocol = json.loads(sql("""SELECT budgeting.put__create_crypto_protocol_position(
 _user_id=>1,_investment_account_id=>1,_protocol_name=>'EVAA audit',
 _position_type=>'lending',_asset_symbol=>'TON',_quantity=>100,_source_position_id=>1,
 _borrowed_crypto_asset_id=>2,_borrowed_quantity=>100,_borrowed_value_in_base=>10000)"""))['id']
record('initial_borrow_acquisition_cost',state(2)['remaining_cost_basis'],20000)
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,100)")
record('initial_borrow_round_trip_cost',state(2)['remaining_cost_basis'],10000)
record('initial_borrow_journal_balances',json.loads(sql("SELECT json_build_array(sum(quantity),sum(debt_basis_change_in_base),count(*)) FROM budgeting.crypto_liability_events")),[0,0,2])

seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,_borrowed_crypto_asset_id=>2)")
record('unknown_loan_keeps_quantity_and_unknown_basis',[state(2)['quantity_now'],state(2)['remaining_cost_basis']],[200,None])
seed(); protocol=deposit()
sql(f"UPDATE budgeting.crypto_protocol_positions SET metadata=metadata || '{{\"borrowed_quantity\":100,\"borrowed_crypto_asset_id\":2}}'::jsonb WHERE id={protocol}")
try:
 sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,50)")
 rejected=False
except RuntimeError:
 rejected=True
record('legacy_loan_not_silently_revalued',[rejected,state(2)['quantity_now']],[True,100])

seed(); protocol = deposit()
sql(f'''SELECT budgeting.put__lending_take_more_debt(1,{protocol},50,
    _borrowed_crypto_asset_id=>1,_value_in_base=>5000)''')
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},0.051166723,5.12,'interest-328')")
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},0.051166723,5.12,'interest-328')")
record('interest_retry_is_idempotent',int(sql("SELECT count(*) FROM budgeting.crypto_liability_events WHERE event_kind='interest_accrual'")),1)
try:
 sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},1,5.12,'interest-328')")
 rejected=False
except RuntimeError:
 rejected=True
record('conflicting_interest_retry_rejected',rejected,True)
sql(f'SELECT budgeting.put__lending_repay_debt(1,{protocol},1,50.051166723,_interest_qty=>0.051166723)')
d = json.loads(sql(f"SELECT metadata FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('principal_and_interest_fully_settled',[d['borrowed_quantity'],d['debt_cost_basis_in_base'],d['debt_interest_quantity'],d['debt_interest_basis_in_base']],[0,0,0,0])
record('interest_not_counted_twice',float(sql("SELECT sum(realized_in_base) FROM budgeting.crypto_liability_events")),-5.12)
record('real_TON_repayment_preserves_nine_decimals',str(sql('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=1')),'99.948833277000000000')

# Partial interest payment leaves the principal untouched.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,10000,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},2,200,'partial-interest')")
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,1,_interest_qty=>1)")
d=json.loads(sql(f"SELECT metadata FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('interest_only_payment_preserves_principal',[d['borrowed_quantity'],d['debt_cost_basis_in_base'],d['debt_interest_quantity'],d['debt_interest_basis_in_base']],[101,10100,1,100])
try:
 sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,101)")
 rejected=False
except RuntimeError:
 rejected=True
record('interest_cannot_be_mislabeled_principal',rejected,True)
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,100)")
try:
 sql(f"SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)")
 rejected=False
except RuntimeError:
 rejected=True
record('unpaid_interest_blocks_close',rejected,True)
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,1,_interest_qty=>1)")
record('partial_interest_journal_balances',json.loads(sql("SELECT json_build_array(sum(quantity),sum(debt_basis_change_in_base),sum(interest_quantity),sum(interest_basis_change_in_base),sum(realized_in_base)) FROM budgeting.crypto_liability_events")),[0,0,0,0,-200])

# ETH-scale nominal precision is preserved by the lending SQL path.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},0.123456789123456789,100,_borrowed_crypto_asset_id=>4)")
record('ETH_lending_eighteen_decimals',sql("SELECT quantity::text FROM budgeting.portfolio_positions WHERE metadata->>'crypto_asset_id'='4' AND status='open'"),'0.123456789123456789')

seed()
sql("SELECT budgeting.put__record_portfolio_income(1,2,0,'RUB',_destination=>'position',_quantity=>20,_income_kind=>'reward')")
record('reward_preserves_cost_and_increases_quantity',
       [state(2)['quantity_now'],state(2)['remaining_cost_basis']], [120,10000])

seed()
sql("UPDATE budgeting.portfolio_positions SET quantity=1.000000001 WHERE id=1")
record('TON_nine_decimals_preserved', sql('SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=1'),'1.000000001000000000')
sql("UPDATE budgeting.portfolio_events SET metadata='{}' WHERE position_id=2")
record('missing_basis_distinguished_from_zero',state(2)['remaining_cost_basis'],None)

# Unknown cost must survive read APIs and prevent cost-consuming writes.
record('unknown_summary_quality',state(2)['basis_quality'],'unknown')
unknown = json.loads(sql('SELECT budgeting.get__crypto_account_assets(1,1)'))
u=next(x for x in unknown if x['position_id']==2)
record('unknown_read_API_preserves_null',[u['remaining_cost_basis'],u['avg_cost_per_unit'],u['realized_pnl_lifetime_in_base']],[None,None,None])
sql("SELECT budgeting.put__swap_crypto_investment_asset(1,2,10,1,1,_value_in_base=>1000,_operated_at=>'2025-01-01',_valuation_source=>'synthetic trade')")
record('unknown_source_swap_known_trade_prices_destination',[state(2)['quantity_now'],state(1)['remaining_cost_basis']],[90,21000])
seed()
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":0}' WHERE position_id=2")
record('explicit_zero_is_not_unknown',[state(2)['remaining_cost_basis'],state(2)['basis_quality']],[0,'confirmed_zero'])
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":1000,\"basis_quality\":\"estimated\"}' WHERE position_id=2")
record('estimate_keeps_label_and_amount',[state(2)['remaining_cost_basis'],state(2)['basis_quality']],[1000,'estimated'])
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":null}' WHERE position_id=2")
record('json_null_is_unknown',state(2)['basis_quality'],'unknown')
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":\"NaN\"}' WHERE position_id=2")
record('nonfinite_cost_is_invalid',[state(2)['basis_quality'],state(2)['remaining_cost_basis']],['invalid',None])
seed()
sql("INSERT INTO budgeting.portfolio_events(position_id,event_type,quantity,metadata,created_by_user_id) VALUES(2,'transfer_out',1,'{\"consumed_cost_basis\":10001}',1)")
record('overconsumption_not_clamped_to_zero',[state(2)['basis_quality'],state(2)['remaining_cost_basis']],['invalid',None])
seed()
sql("DELETE FROM budgeting.portfolio_events WHERE position_id=2")
record('positive_balance_without_entries_is_unknown',state(2)['basis_quality'],'unknown')
seed()
sql("SELECT budgeting.put__crypto_pay_fee(1,1,1)")
record('network_fee_reduces_remaining_basis',[state(1)['quantity_now'],state(1)['remaining_cost_basis']],[199,19900])

# Unknown/estimated basis travels with transfers and fees; corrupt ledgers do not.
sql("INSERT INTO budgeting.bank_accounts VALUES(2,'Second test','user',1,NULL,'investment','crypto',true),(3,'Third test','user',1,NULL,'investment','crypto',true)")
seed()
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":null}' WHERE position_id=1")
a=json.loads(sql("SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,1,2,50)"))['position_id']
b=json.loads(sql(f"SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,{a},3,20)"))['position_id']
fee=json.loads(sql(f"SELECT budgeting.put__crypto_pay_fee(1,{b},1)"))
record('unknown_basis_survives_two_transfers_and_fee',
       [[state(p)['quantity_now'],state(p)['basis_quality'],state(p)['remaining_cost_basis']] for p in [1,a,b]],
       [[150,'unknown',None],[30,'unknown',None],[19,'unknown',None]])
record('unknown_fee_cost_and_result_not_zero',
       [fee['consumed_cost_basis'],json.loads(sql(f"SELECT metadata FROM budgeting.portfolio_events WHERE position_id={b} AND event_type='fee'"))['realized_in_base']], [None,None])
sql(f"SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,{b},1,19)")
record('unknown_full_transfer_closes_quantity',state(b)['quantity_now'],0)
seed()
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":20000,\"basis_quality\":\"estimated\"}' WHERE position_id=1")
a=json.loads(sql("SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,1,2,50)"))['position_id']
record('estimated_transfer_preserves_label_and_cost',[state(a)['basis_quality'],state(a)['remaining_cost_basis']],['estimated',5000])
seed()
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":0}' WHERE position_id=1")
a=json.loads(sql("SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,1,2,50)"))['position_id']
record('zero_transfer_stays_confirmed_zero',[state(a)['basis_quality'],state(a)['remaining_cost_basis']],['confirmed_zero',0])
seed()
sql("UPDATE budgeting.portfolio_events SET metadata='{\"entry_value_in_base\":\"NaN\"}' WHERE position_id=1")
for label,statement in [('transfer',"SELECT budgeting.put__transfer_crypto_between_investment_accounts(1,1,2,1)"),('fee',"SELECT budgeting.put__crypto_pay_fee(1,1,1)")]:
    rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record('invalid_basis_still_blocks_'+label,[rejected,state(1)['quantity_now']],[True,200])
seed()
sql("SELECT budgeting.put__crypto_pay_fee(1,1,0.000000000000000001)")
record('fee_keeps_18_decimal_quantity',sql("SELECT quantity::text FROM budgeting.portfolio_positions WHERE id=1"),'199.999999999999999999')

# Accrual preserves acquisition basis and writes interest exactly once.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,10000,_borrowed_crypto_asset_id=>2)")
spot=[state(1),state(2)]
accrue=f"SELECT budgeting.put__lending_accrue(1,{protocol},10,5,500,100,100,'yield-1','2025-01-01')"
first=json.loads(sql(accrue))
record('accrual_exact_repeat',json.loads(sql(accrue)),first)
record('accrual_collateral_basis_preserved',json.loads(sql(f"SELECT jsonb_build_array(quantity,current_quantity,cost_basis_in_base,metadata->'borrowed_quantity',metadata->'debt_cost_basis_in_base') FROM budgeting.crypto_protocol_positions WHERE id={protocol}")),[110,110,10000,105,10500])
record('accrual_spot_untouched',[state(1),state(2)],spot)
record('accrual_interest_once',json.loads(sql("SELECT jsonb_build_array(count(*),sum(realized_in_base)) FROM budgeting.crypto_liability_events WHERE event_kind='interest_accrual'")),[1,-500])
for label,statement in [
    ('conflict',accrue.replace('10,5,500','11,5,500')),
    ('wrong_opening',accrue.replace("'yield-1'","'wrong'")),
    ('no_access',accrue.replace('accrue(1,','accrue(2,')),
    ('manual_quantity',f"SELECT budgeting.set__update_crypto_protocol_position(1,{protocol},_quantity=>111)"),
]:
    rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record('accrual_rejects_'+label,rejected,True)
# Inject failure after both projections and liability event have been written.
sql("""CREATE FUNCTION budgeting.fail_accrual_test() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected accrual failure'; END $$;
CREATE TRIGGER fail_accrual_test BEFORE INSERT ON budgeting.crypto_protocol_accrual_events
FOR EACH ROW EXECUTE FUNCTION budgeting.fail_accrual_test();""")
before=sql(f"SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id={protocol}");rejected=False
try: sql(f"SELECT budgeting.put__lending_accrue(1,{protocol},1,1,100,110,105,'fail','2025-01-02')")
except RuntimeError: rejected=True
record('accrual_both_legs_rollback',[rejected,sql(f"SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id={protocol}")],[True,before])
record('accrual_failed_interest_not_recorded',int(sql("SELECT count(*) FROM budgeting.crypto_liability_events WHERE external_id='protocol-accrual:fail'")),0)
sql('DROP TRIGGER fail_accrual_test ON budgeting.crypto_protocol_accrual_events')
liquidated=json.loads(sql(f"SELECT budgeting.put__lending_liquidate(1,{protocol},55,52.5,'after-accrual','2025-01-02',2.5)"))
record('liquidation_after_accrual_uses_diluted_basis',
       [liquidated['collateral_cost_consumed_in_base'],liquidated['debt_basis_released_in_base'],liquidated['realized_in_base']], [5000,5250,250])
# Unknown collateral value is preserved; free unit growth adds no acquisition cost.
seed(); protocol=deposit()
sql(f"UPDATE budgeting.crypto_protocol_positions SET metadata=metadata || '{{\"basis_quality\":\"unknown\"}}' WHERE id={protocol}")
free=f"SELECT budgeting.put__lending_accrue(1,{protocol},1,0,NULL,100,0,'free','2025-01-01')"
free_result=json.loads(sql(free))
record('collateral_only_accrual_does_not_invent_known_basis',
       json.loads(sql(f"SELECT jsonb_build_array(quantity,cost_basis_in_base,metadata->>'basis_quality') FROM budgeting.crypto_protocol_positions WHERE id={protocol}")),[101,10000,'unknown'])
record('collateral_only_accrual_has_no_interest_expense',[free_result['interest_expense_in_base'],free_result['liability_event_id']],[0,None])
# A simultaneous exact retry must not double either leg.
from concurrent.futures import ThreadPoolExecutor
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,10000,_borrowed_crypto_asset_id=>2)")
concurrent_accrual=f"SELECT budgeting.put__lending_accrue(1,{protocol},1,1,100,100,100,'concurrent-accrual','2025-01-01')"
with ThreadPoolExecutor(max_workers=2) as executor:
    replies=list(executor.map(sql,[concurrent_accrual,concurrent_accrual]))
record('concurrent_accrual_once',
       [replies[0]==replies[1],json.loads(sql(f"SELECT jsonb_build_array(quantity,metadata->'borrowed_quantity') FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))], [True,[101,101]])

# Actual index increment between historical 741 and 742, with synthetic basis.
seed(); protocol=deposit()
sql(f"UPDATE budgeting.crypto_protocol_positions SET quantity=678.257870828,current_quantity=678.257870828 WHERE id={protocol}")
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},1574.332244,100000,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_accrue(1,{protocol},0.000021275,0.000464,0.05,678.257870828,1574.332244,'before-742','2025-10-10')")
record('historical_742_accrual_exact_opening',json.loads(sql(f"SELECT jsonb_build_array(quantity,metadata->'borrowed_quantity',cost_basis_in_base) FROM budgeting.crypto_protocol_positions WHERE id={protocol}")),[678.257892103,1574.332708,10000])

# Liquidation is protocol-only: no second consumption from the spot wallet.
seed(); protocol = deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,8000,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},10,1000,'interest','2025-01-01')")
spot_before = [state(1), state(2)]
call = f"SELECT budgeting.put__lending_liquidate(1,{protocol},40,55,'liq-1','2025-01-02',5,2,5000)"
liquidation = json.loads(sql(call))
record('liquidation_cost_debt_fee_and_result',
       [liquidation[k] for k in ['collateral_cost_consumed_in_base','debt_basis_released_in_base',
        'interest_basis_released_in_base','fee_cost_in_base','realized_before_fee_in_base',
        'realized_in_base','asset_realized_before_fee_in_base','liability_realized_in_base']],
       [4000,4500,500,200,700,500,1200,-500])
record('liquidation_does_not_touch_spot', [state(1),state(2)], spot_before)
record('liquidation_exact_retry', json.loads(sql(call)), liquidation)
def protocol_state():
    return json.loads(sql(f"SELECT jsonb_build_array(quantity,cost_basis_in_base,metadata->'borrowed_quantity',metadata->'debt_cost_basis_in_base',metadata->'debt_interest_quantity') FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
record('partial_liquidation_remaining', protocol_state(), [60,6000,55,4500,5])
for label, statement in [
    ('conflicting_retry',call.replace('40,55','41,55')),
    ('access_denied',call.replace('liquidate(1,','liquidate(2,')),
    ('excess_collateral',call.replace("40,55,'liq-1'","61,55,'bad'")),
    ('excess_principal',call.replace("40,55,'liq-1','2025-01-02',5", "40,55,'bad','2025-01-02',0")),
    ('nan',call.replace("40,55,'liq-1'","'NaN',55,'bad'")),
    ('precision',call.replace("40,55,'liq-1'","0.0000000000000000001,55,'bad'")),
]:
    before=protocol_state(); rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record('liquidation_'+label, [rejected,protocol_state()], [True,before])
# Force an error AFTER the projection UPDATE to prove statement rollback.
sql("""CREATE FUNCTION budgeting.fail_liquidation_test() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected ledger failure'; END $$;
CREATE TRIGGER fail_liquidation_test BEFORE INSERT ON budgeting.crypto_liability_events
FOR EACH ROW EXECUTE FUNCTION budgeting.fail_liquidation_test();""")
before=protocol_state(); rejected=False
try: sql(call.replace("'liq-1'", "'fail'"))
except RuntimeError: rejected=True
record('liquidation_rolls_back_projection_on_ledger_failure',[rejected,protocol_state()],[True,before])
sql('DROP TRIGGER fail_liquidation_test ON budgeting.crypto_liability_events')
last=json.loads(sql(f"SELECT budgeting.put__lending_liquidate(1,{protocol},60,55,'liq-2','2025-01-03',5)"))
record('full_liquidation_zero_residual',protocol_state(),[0,0,0,0,0])
record('unknown_settlement_does_not_invent_components',
       [last['realized_in_base'],last['asset_realized_before_fee_in_base'],last['liability_realized_in_base']],[-1500,None,None])
record('liquidation_total_includes_interest_once', json.loads(sql(
    f"SELECT jsonb_build_array(sum(realized_in_base),sum(asset_cost_consumed_in_base),sum(debt_basis_change_in_base)) FROM budgeting.crypto_liability_events WHERE protocol_position_id={protocol}")),[-2000,10000,0])
sql(f'SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>0)')
record('retry_after_close',json.loads(sql(call)),liquidation)
record('close_after_full_liquidation_does_not_mint', [state(1),state(2)],spot_before)

# Historical quantities with EXPLICITLY SYNTHETIC RUB opening costs.
# This proves API-input amounts/remainders, not the owner's historical result.
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
history_path=HERE/'evaa-liquidation-quantities.json'
files.append(history_path)
for event in json.loads(history_path.read_text())['events']:
    seed()
    collateral=Decimal(event['collateral_before']); debt=Decimal(event['debt_before'])
    sql(f"UPDATE budgeting.portfolio_positions SET quantity={collateral} WHERE id=1")
    sql(f"UPDATE budgeting.portfolio_events SET quantity={collateral},metadata='{{\"entry_value_in_base\":100000}}' WHERE position_id=1")
    protocol=json.loads(sql(f"""SELECT budgeting.put__create_crypto_protocol_position(
        _user_id=>1,_investment_account_id=>1,_protocol_name=>'Historical quantities / synthetic RUB',
        _position_type=>'lending',_asset_symbol=>'TON',_quantity=>{collateral},
        _source_position_id=>1)"""))['id']
    sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},{debt},100000,_borrowed_crypto_asset_id=>2)")
    # The fixture's collateral asset uses a test id, including the TON-SLP case.
    before_spot=[state(1),state(2)]
    event_date=datetime.fromtimestamp(event['timestamp'],timezone.utc).date().isoformat()
    out=json.loads(sql(f"SELECT budgeting.put__lending_liquidate(1,{protocol},{event['collateral_removed']},{event['debt_removed']},'historical-{event['event']}','{event_date}')"))
    remaining=json.loads(sql(f"SELECT jsonb_build_array(quantity::text,metadata->>'borrowed_quantity') FROM budgeting.crypto_protocol_positions WHERE id={protocol}"))
    record(f"historical_{event['event']}_exact_quantity_remainders",
           [str(Decimal(remaining[0]).normalize()),str(Decimal(remaining[1]).normalize())],
           [str(Decimal(event['collateral_after']).normalize()),str(Decimal(event['debt_after']).normalize())])
    cost=(Decimal(100000)*Decimal(event['collateral_removed'])/collateral).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    release=(Decimal(100000)*Decimal(event['debt_removed'])/debt).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    record(f"historical_{event['event']}_synthetic_basis_result",Decimal(str(out['realized_in_base']))==release-cost,True)
    record(f"historical_{event['event']}_spot_unchanged",[state(1),state(2)],before_spot)

# Historical swap value is independent of source cost and never falls back.
seed()
sql("SELECT budgeting.put__swap_crypto_investment_asset(1,1,50,2,20)")
record('swap_without_quote_keeps_source_cost_and_unknown_destination',
       [state(1)['remaining_cost_basis'],state(2)['remaining_cost_basis']],[15000,None])
a=next(x for x in json.loads(sql('SELECT budgeting.get__crypto_account_assets(1,1)')) if x['position_id']==1)
detail=json.loads(sql('SELECT budgeting.get__crypto_asset_detail(1,1,1)'))
record('unknown_swap_realized_not_hidden_by_SUM',[a['realized_pnl_lifetime_in_base'],detail['realized_pnl_lifetime_in_base']],[None,None])
seed()
for label,suffix in [('no_source',"_value_in_base=>1234,_operated_at=>'2025-01-01'"),
                     ('no_date',"_value_in_base=>1234,_valuation_source=>'receipt'"),
                     ('nan',"_value_in_base=>'NaN',_operated_at=>'2025-01-01',_valuation_source=>'receipt'")]:
    rejected=False
    try: sql(f'SELECT budgeting.put__swap_crypto_investment_asset(1,1,1,2,1,{suffix})')
    except RuntimeError: rejected=True
    record('swap_rejects_'+label,[rejected,state(1)['quantity_now']],[True,200])
sql("SELECT budgeting.put__swap_crypto_investment_asset(1,1,200,2,20,_value_in_base=>22000,_operated_at=>'2025-01-01',_valuation_source=>'receipt')")
record('full_swap_closes_source_and_records_gain',[state(1)['quantity_now'],state(2)['remaining_cost_basis']],[0,32000])
record('swap_price_provenance_stored',json.loads(sql("SELECT jsonb_build_array(metadata->>'valuation_source',metadata->>'valuation_date',metadata->'realized_in_base') FROM budgeting.portfolio_events WHERE event_type='swap_out'")),['receipt','2025-01-01',2000])

# Unknown collateral travels through deposit, additional supply and both returns.
seed()
sql("UPDATE budgeting.portfolio_events SET metadata=jsonb_build_object('entry_value_in_base',NULL) WHERE position_id=1")
protocol=deposit()
def proto():
    return json.loads(sql(f"SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id={protocol}"))
record('unknown_collateral_is_SQL_null',[proto()['cost_basis_in_base'],proto()['metadata']['basis_quality']],[None,'unknown'])
sql(f"SELECT budgeting.put__top_up_crypto_protocol_position(1,{protocol},1,10)")
record('unknown_top_up_does_not_reset_cost',[proto()['quantity'],proto()['cost_basis_in_base']],[110,None])
sql(f"SELECT budgeting.put__partial_close_crypto_protocol_position(1,{protocol},_principal_qty=>50)")
record('unknown_partial_return_preserves_quantities',[proto()['quantity'],state(1)['quantity_now'],state(1)['remaining_cost_basis']],[60,140,None])
sql(f"SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>60)")
record('unknown_collateral_round_trip',[state(1)['quantity_now'],state(1)['remaining_cost_basis']],[200,None])
seed(); protocol=deposit()
sql("UPDATE budgeting.portfolio_events SET metadata=jsonb_build_object('entry_value_in_base',NULL) WHERE position_id=1 AND event_type='open'")
sql(f"SELECT budgeting.put__top_up_crypto_protocol_position(1,{protocol},1,10)")
record('known_collateral_plus_unknown_becomes_unknown',proto()['cost_basis_in_base'],None)

# Loan and interest with missing valuation keep quantity, not fabricated RUB.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},50,5000)")
record('unknown_debt_not_overwritten_by_known_topup',[proto()['metadata']['borrowed_quantity'],proto()['metadata']['debt_cost_basis_in_base'],state(2)['remaining_cost_basis']],[150,None,None])
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},10,NULL,'unknown-interest','2025-01-01')")
sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},10,NULL,'unknown-interest','2025-01-01')")
record('unknown_interest_exact_retry_once',int(sql("SELECT count(*) FROM budgeting.crypto_liability_events WHERE event_kind='interest_accrual'")),1)
rejected=False
try: sql(f"SELECT budgeting.put__lending_accrue_interest(1,{protocol},10,1000,'unknown-interest','2025-01-01')")
except RuntimeError: rejected=True
record('unknown_interest_cannot_be_silently_revalued_on_retry',rejected,True)
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,80,_interest_qty=>5)")
record('unknown_partial_debt_repayment',[proto()['metadata']['borrowed_quantity'],proto()['metadata']['debt_cost_basis_in_base']],[80,None])
sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,80,_interest_qty=>5)")
record('unknown_debt_full_closure_known_zero_residual',
       [proto()['metadata'][k] for k in ['borrowed_quantity','debt_cost_basis_in_base','debt_interest_quantity','debt_interest_basis_in_base']],[0,0,0,0])
record('unknown_debt_disposals_do_not_fabricate_realized',int(sql("SELECT count(*) FROM budgeting.crypto_liability_events WHERE event_kind='repayment' AND realized_in_base IS NULL")),2)
sql(f"SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)")
record('unknown_loan_does_not_destroy_known_collateral',[state(1)['quantity_now'],state(1)['remaining_cost_basis']],[200,20000])

seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,10000,_borrowed_crypto_asset_id=>2)")
sql(f"SELECT budgeting.put__lending_accrue(1,{protocol},1,2,NULL,100,100,'unknown-accrual','2025-01-01')")
record('unknown_interest_in_atomic_accrual',
       [proto()['quantity'],proto()['cost_basis_in_base'],proto()['metadata']['borrowed_quantity'],proto()['metadata']['debt_cost_basis_in_base']],[101,10000,102,None])

# Either leg may be unknown; liquidation still changes exact quantities atomically.
for unknown_collateral,unknown_debt in [(True,False),(False,True),(True,True)]:
    seed()
    if unknown_collateral:
        sql("UPDATE budgeting.portfolio_events SET metadata=jsonb_build_object('entry_value_in_base',NULL) WHERE position_id=1")
    protocol=deposit()
    price='NULL' if unknown_debt else '10000'
    sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,{price},_borrowed_crypto_asset_id=>2)")
    out=json.loads(sql(f"SELECT budgeting.put__lending_liquidate(1,{protocol},100,100,'unknown-liquidation','2025-01-01')"))
    record(f'unknown_liquidation_{unknown_collateral}_{unknown_debt}',
           [proto()['quantity'],proto()['cost_basis_in_base'],proto()['metadata']['borrowed_quantity'],proto()['metadata']['debt_cost_basis_in_base'],out['realized_in_base']], [0,0,0,0,None])
# Shared create+borrow path uses the same nullable liability logic.
seed()
protocol=json.loads(sql("""SELECT budgeting.put__create_crypto_protocol_position(
    _user_id=>1,_investment_account_id=>1,_protocol_name=>'Unknown initial loan',
    _position_type=>'lending',_asset_symbol=>'TON',_quantity=>100,_source_position_id=>1,
    _borrowed_crypto_asset_id=>2,_borrowed_quantity=>100)"""))['id']
record('initial_unknown_borrow_recorded_once',
       [state(2)['quantity_now'],proto()['metadata']['debt_cost_basis_in_base'],int(sql("SELECT count(*) FROM budgeting.crypto_liability_events"))],[200,None,1])
# Bad ledger values remain blocked and never turn into ordinary unknowns.
sql(f"UPDATE budgeting.crypto_protocol_positions SET metadata=metadata || '{{\"debt_cost_basis_in_base\":-1}}' WHERE id={protocol}")
rejected=False
try: sql(f"SELECT budgeting.put__lending_repay_debt(1,{protocol},2,10)")
except RuntimeError: rejected=True
record('negative_debt_basis_still_rejected',rejected,True)

seed(); protocol=deposit()
for name, statement in [
    ('create_collateral_asset_mismatch_rejected', "SELECT budgeting.put__create_crypto_protocol_position(_user_id=>1,_investment_account_id=>1,_protocol_name=>'audit',_position_type=>'lending',_asset_symbol=>'USDT',_quantity=>10,_source_position_id=>1,_crypto_asset_id=>2)"),
    ('top_up_collateral_asset_mismatch_rejected', f"SELECT budgeting.put__top_up_crypto_protocol_position(1,{protocol},2,10)")]:
    before=state(1),state(2),proto()
    rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record(name,[rejected,(state(1),state(2),proto())==before],[True,True])

seed(); protocol=deposit()
for name, statement in [
    ('partial_close_nonfinite_rejected', f"SELECT budgeting.put__partial_close_crypto_protocol_position(1,{protocol},'NaN'::numeric)"),
    ('full_close_excess_precision_rejected', f"SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>1.0000000000000000001)"),
    ('borrow_excess_precision_rejected', f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},1.0000000000000000001,_borrowed_crypto_asset_id=>2)")]:
    rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record(name,rejected,True)
sql(f"UPDATE budgeting.crypto_protocol_positions SET cost_basis_in_base=-1 WHERE id={protocol}")
for name, statement in [
    ('negative_collateral_topup_rejected', f"SELECT budgeting.put__top_up_crypto_protocol_position(1,{protocol},1,1)"),
    ('negative_collateral_partial_return_rejected', f"SELECT budgeting.put__partial_close_crypto_protocol_position(1,{protocol},1)"),
    ('negative_collateral_return_rejected', f"SELECT budgeting.set__close_crypto_protocol_position(1,{protocol},_return_quantity=>100)")]:
    rejected=False
    try: sql(statement)
    except RuntimeError: rejected=True
    record(name,rejected,True)

# Concurrent retries must serialize on the protocol lock and write only once.
seed(); protocol=deposit()
sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,8000,_borrowed_crypto_asset_id=>2)")
concurrent_call=f"SELECT budgeting.put__lending_liquidate(1,{protocol},40,50,'concurrent','2025-01-02')"
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=2) as executor:
    responses=list(executor.map(sql,[concurrent_call,concurrent_call]))
record('liquidation_concurrent_retry_once',
       [responses[0]==responses[1],protocol_state(),int(sql("SELECT count(*) FROM budgeting.crypto_liability_events WHERE event_kind='liquidation'"))],
       [True,[60,6000,50,4000,0],1])
# The upgrade preserves existing ledger data and installs the same rules as tb/.
migration=DB/'migrations/038_crypto_liquidations.sql'
files.append(migration)
before=sql('SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM budgeting.crypto_liability_events e')
sql(migration.read_text()); sql(migration.read_text())
record('liquidation_migration_preserves_ledger',
       sql('SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM budgeting.crypto_liability_events e'),before)

result = {'scope':'Isolated actual SQL functions; simplified identity/bank fixture; no production access',
          'checks':results,'passed':sum(x['passed'] for x in results),'total':len(results),
          'source_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
(socket / 'checks-after.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='source_sha256'},ensure_ascii=False,indent=2))

# Known gaps are retained as explicit audit expectations until implemented.
# Any new regression, or any fixed gap not yet reviewed, must fail this runner.
known_gaps = set()
observed_gaps = {x['name'] for x in results if not x['passed']}
assert observed_gaps == known_gaps, (observed_gaps, known_gaps)
