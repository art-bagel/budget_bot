import os
# from dotenv import load_dotenv

from database_tools.databases import ConnectData

# load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")


postgres_conn = ConnectData(
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT"),
    database=os.getenv("DB_DATABASE"),
    username=os.getenv("POSTGRES_USER"),
    password=os.getenv("POSTGRES_PASSWORD"),
    schema=os.getenv("DB_SCHEMA")
)
