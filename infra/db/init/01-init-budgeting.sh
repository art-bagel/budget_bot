#!/bin/sh
set -eu

export DB_DATABASE="${POSTGRES_DB}"

bash /Scripts/run_table_scripts.sh
bash /Scripts/run_func_scripts.sh
