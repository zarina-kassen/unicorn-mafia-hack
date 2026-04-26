"""Piccolo configuration for database connection."""

from __future__ import annotations

import os

from piccolo.conf.apps import AppConfig
from piccolo.engine.postgres import PostgresEngine

DB = PostgresEngine(config={"dsn": os.environ.get("DATABASE_URL", "")})

APP_CONFIG = AppConfig(
    app_name="frame_mog",
    table_classes=[  # type: ignore
        "app.storage.database.GeneratedImage",
    ],
    migrations_folder_path="migrations",
)
