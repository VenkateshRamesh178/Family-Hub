from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment variables or services/api/.env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://familyhub:familyhub@localhost:5432/familyhub"
    test_database_url: str = "postgresql+asyncpg://familyhub:familyhub@localhost:5432/familyhub_test"

    session_cookie_name: str = "fh_session"
    session_days: int = 30
    # Must be true once the app is served over HTTPS.
    cookie_secure: bool = False

    # Where document files live: "local" (a folder on this machine, for development)
    # or "s3" (browser uploads and downloads go straight to the bucket via presigned URLs).
    docs_storage: Literal["local", "s3"] = "local"
    # Relative paths are relative to services/api.
    docs_local_dir: str = "data/docs"
    docs_s3_bucket: str | None = None
    docs_s3_region: str | None = None
    # A profile from ~/.aws/config, e.g. "family-hub-dev". None = the default credential chain
    # (env vars, AWS_PROFILE, or the instance role on EC2).
    docs_s3_profile: str | None = None
    docs_max_upload_mb: int = 25
    # How long upload and download links stay valid.
    docs_link_seconds: int = 300

    @property
    def docs_max_upload_bytes(self) -> int:
        return self.docs_max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
