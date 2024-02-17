#!/bin/bash
USERNAME="$POSTGRES_USER"
DATABASE="$DB_DATABASE"
DIRECTORY="/Scripts/functions/"
for sql_file in $(find "$DIRECTORY" -name '*.sql'); do
    psql -U "$USERNAME" -d "$DATABASE" -f "$sql_file"
done