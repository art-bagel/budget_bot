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
         ['crypto_assets', 'portfolio_positions', 'portfolio_events', 'crypto_protocol_positions', 'crypto_liability_events']]
files += [DB / 'func' / (n + '.sql') for n in [
    'get__crypto_position_entry_summary', 'get__crypto_position_known_entry_summary',
    'get__crypto_account_assets', 'get__crypto_asset_detail', 'put__crypto_pay_fee', 'get__crypto_protocol_positions',
    'put__create_crypto_protocol_position', 'put__lending_take_more_debt',
    'put__lending_repay_debt', 'set__close_crypto_protocol_position',
    'put__record_portfolio_income', 'put__swap_crypto_investment_asset',
    'set__update_crypto_protocol_position', 'put__lending_accrue_interest']]
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
sql(f"SELECT budgeting.put__swap_crypto_investment_asset(1,{eth},1,2,120,_value_in_base=>12000)")
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
try:
 sql(f"SELECT budgeting.put__lending_take_more_debt(1,{protocol},100,_borrowed_crypto_asset_id=>2)")
 rejected=False
except RuntimeError:
 rejected=True
record('unknown_loan_valuation_rejected_atomically',[rejected,state(2)['quantity_now']],[True,100])
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
try:
 sql("SELECT budgeting.put__swap_crypto_investment_asset(1,2,10,1,1,_value_in_base=>1000)")
 rejected=False
except RuntimeError:
 rejected=True
record('unknown_swap_blocked_without_mutation',[rejected,state(2)['quantity_now']],[True,100])
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
