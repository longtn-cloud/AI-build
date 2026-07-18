from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    supabase_db_url: str
    gemini_api_key: str
    storage_bucket: str = "documents"
    max_upload_bytes: int = 20 * 1024 * 1024
    allowed_file_types: set[str] = {"pdf", "docx", "txt", "md"}

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
