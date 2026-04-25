"""Piccolo configuration for database connection."""

import os

from piccolo.conf.apps import AppConfig
from piccolo.engine.postgres import PostgresEngine

DB = PostgresEngine(
    config={
        "database": os.environ.get("POSTGRES_DATABASE", "postgres"),
        "user": os.environ.get("POSTGRES_USER", "postgres"),
        "password": os.environ.get("POSTGRES_PASSWORD", ""),
        "host": os.environ.get("POSTGRES_HOST", "localhost"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
    }
)

APP_CONFIG = AppConfig(
    app_name="frame_mog",
    table_classes=[
        "app.storage.database.GeneratedImage",
    ],
    migrations_folder_path="migrations",
)
