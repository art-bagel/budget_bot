#!/bin/sh
set -eu

export DB_DATABASE="${POSTGRES_DB}"

chmod +x /Scripts/run_table_scripts.sh /Scripts/run_func_scripts.sh

/Scripts/run_table_scripts.sh
/Scripts/run_func_scripts.sh
