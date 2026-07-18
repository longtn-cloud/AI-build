import os
import pathlib

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_ROLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test-signature",
)
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://postgres:postgres@localhost:5433/test")
os.environ.setdefault("VOYAGE_API_KEY", "test-voyage-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")

import psycopg
import pytest

TEST_DB_URL = os.environ["SUPABASE_DB_URL"]
BACKEND_ROOT = pathlib.Path(__file__).parent.parent


def _assert_is_test_db(url: str) -> None:
    if "localhost:5433" not in url or "/test" not in url:
        raise RuntimeError(
            f"refusing to run destructive test fixture against non-test database: {url}"
        )


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    _assert_is_test_db(TEST_DB_URL)
    stub_sql = (BACKEND_ROOT / "tests" / "fixtures" / "0000_test_auth_stub.sql").read_text()
    init_sql = (BACKEND_ROOT / "migrations" / "0001_init.sql").read_text()
    chat_sql = (BACKEND_ROOT / "migrations" / "0002_chat.sql").read_text()
    quiz_sql = (BACKEND_ROOT / "migrations" / "0003_quiz.sql").read_text()
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "DROP TABLE IF EXISTS quiz_attempts, quiz_questions, quizzes, "
            "chat_messages, chat_sessions, chunks, documents CASCADE"
        )
        conn.execute(stub_sql)
        conn.execute(init_sql)
        conn.execute(chat_sql)
        conn.execute(quiz_sql)
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "TRUNCATE quiz_attempts, quiz_questions, quizzes, "
            "chat_messages, chat_sessions, chunks, documents CASCADE"
        )
