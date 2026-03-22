from storage import Context, Ledger, Reports, TinkoffStorage
from backend.app.config import postgres_conn

context = Context(postgres_conn)
ledger = Ledger(postgres_conn)
reports = Reports(postgres_conn)
tinkoff = TinkoffStorage(postgres_conn)
