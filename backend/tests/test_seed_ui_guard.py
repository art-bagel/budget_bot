"""The UI-test seed must refuse anything but a local budget_test_* database."""

import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    'seed_ui_test', Path(__file__).resolve().parents[2] / 'scripts' / 'seed_ui_test.py',
)
seed_ui_test = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_ui_test)


class SeedGuardTest(unittest.TestCase):
    def test_accepts_local_test_database(self):
        for host in ('127.0.0.1', 'localhost'):
            seed_ui_test.assert_test_database({'DB_HOST': host, 'DB_DATABASE': 'budget_test_ui'})

    def test_refuses_other_databases_and_hosts(self):
        for env in (
            {'DB_HOST': '127.0.0.1', 'DB_DATABASE': 'budget_bot'},
            {'DB_HOST': '127.0.0.1', 'DB_DATABASE': 'budget_ci'},
            {'DB_HOST': '127.0.0.1', 'DB_DATABASE': ''},
            {'DB_HOST': 'db', 'DB_DATABASE': 'budget_test_ui'},
            {'DB_HOST': '192.168.1.10', 'DB_DATABASE': 'budget_test_ui'},
            {},
        ):
            with self.subTest(env=env), self.assertRaises(SystemExit):
                seed_ui_test.assert_test_database(env)


if __name__ == '__main__':
    unittest.main()
