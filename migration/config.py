"""Environment-driven configuration for the migration run."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    access_db_path: str
    branch_code: str
    pg_dsn: str

    @classmethod
    def from_env(cls) -> "Config":
        access_db_path = os.environ["ACCESS_DB_PATH"]
        branch_code = os.environ["BRANCH_CODE"]
        pg_dsn = os.environ["PG_DSN"]
        if not os.path.exists(access_db_path):
            raise FileNotFoundError(f"ACCESS_DB_PATH does not exist: {access_db_path}")
        return cls(access_db_path=access_db_path, branch_code=branch_code, pg_dsn=pg_dsn)
