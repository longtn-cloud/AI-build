# Gemini Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the backend's LLM provider from Anthropic (Claude) to Gemini (`google-genai`), since the Anthropic API key no longer supports free usage.

**Architecture:** `backend/app/services/llm.py` is rewritten against the `google-genai` SDK, keeping every function's exact existing signature so `backend/app/routers/chat.py` and `backend/app/routers/quiz.py` need zero changes. Config, dependency, and env-var renames flow through wherever `ANTHROPIC_API_KEY`/`anthropic_api_key` currently appear.

**Tech Stack:** `google-genai` (verified installed version `2.12.1`) replaces `anthropic` in the backend.

## Global Constraints

- Every function in `llm.py` keeps its exact signature: `answer_from_chunks(question: str, chunks: list[dict]) -> str`, `answer_with_web_search(question: str) -> str`, `generate_quiz_questions(chunks: list[dict], num_questions: int) -> list[dict]`. No caller outside `llm.py` changes.
- Model: `gemini-2.5-flash`, module-level `MODEL` constant, same as the existing `MODEL = "claude-sonnet-5"` pattern.
- `SYSTEM_PROMPT` and `_quiz_system_prompt(num_questions)`'s exact text stay unchanged — only the API call shape around them changes.
- `thinking_config=types.ThinkingConfig(thinking_budget=0)` is the direct equivalent of the old `thinking={"type": "disabled"}` and is used everywhere the old code disabled thinking.
- `answer_with_web_search` passes no `system_instruction` — matches today's behavior exactly (the original Claude call has no `system` param there either).

---

### Task 1: Migrate llm.py to Gemini

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/app/services/llm.py`
- Modify: `backend/tests/test_llm.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `answer_from_chunks`, `answer_with_web_search`, `generate_quiz_questions`, `QUIZ_TOOL`, `MODEL`, `SYSTEM_PROMPT` — all consumed by `chat.py`/`quiz.py` exactly as before (unchanged call sites, not touched in this task).

- [ ] **Step 1: Swap the dependency**

Replace the `anthropic==0.117.0` line in `backend/requirements.txt` with:

```
google-genai==2.12.1
```

- [ ] **Step 2: Rename the config field**

In `backend/app/config.py`, replace `anthropic_api_key: str` with `gemini_api_key: str` (keep its position in the class body — right after `voyage_api_key`).

- [ ] **Step 3: Rename the env var everywhere it's referenced**

In `backend/.env.example`, replace:
```
ANTHROPIC_API_KEY=your-anthropic-key
```
with:
```
GEMINI_API_KEY=your-gemini-key
```

In `backend/tests/conftest.py`, replace:
```python
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
```
with:
```python
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
```

- [ ] **Step 4: Install the new dependency**

Run: `cd backend && ./venv/Scripts/python.exe -m pip install -r requirements.txt` (or the equivalent activated-venv `pip install -r requirements.txt` on your platform)
Expected: installs `google-genai` and its dependencies; `anthropic` remains installed in the venv until you next recreate it (harmless — it's simply unused going forward, not worth a separate uninstall step).

- [ ] **Step 5: Write the failing tests**

Replace `backend/tests/test_llm.py` in full:

```python
from unittest.mock import MagicMock

from app.services import llm


def test_answer_from_chunks_calls_gemini_with_context_and_disabled_thinking(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(
        text="Refunds are available within 30 days."
    )
    monkeypatch.setattr(llm, "_client", fake_client)

    chunks = [
        {
            "document_id": "doc-1",
            "filename": "policy.pdf",
            "chunk_index": 1,
            "total_chunks": 3,
            "content": "Refunds must be requested within 30 days of purchase.",
            "score": 0.81,
        }
    ]

    result = llm.answer_from_chunks("What is the refund window?", chunks)

    assert result == "Refunds are available within 30 days."
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == "gemini-2.5-flash"
    assert kwargs["config"].thinking_config.thinking_budget == 0
    assert kwargs["config"].system_instruction == llm.SYSTEM_PROMPT
    assert "policy.pdf" in kwargs["contents"]
    assert "passage 2 of 3" in kwargs["contents"]
    assert "Refunds must be requested within 30 days" in kwargs["contents"]
    assert "What is the refund window?" in kwargs["contents"]


def test_answer_from_chunks_returns_response_text_directly(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="Part one. Part two.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_from_chunks(
        "q",
        [
            {
                "document_id": "d",
                "filename": "f.txt",
                "chunk_index": 0,
                "total_chunks": 1,
                "content": "c",
                "score": 0.9,
            }
        ],
    )

    assert result == "Part one. Part two."


def test_answer_with_web_search_calls_gemini_with_search_tool(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="It's sunny today.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_with_web_search("What's the weather?")

    assert result == "It's sunny today."
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == "gemini-2.5-flash"
    assert kwargs["contents"] == "What's the weather?"
    assert kwargs["config"].system_instruction is None
    assert kwargs["config"].tools[0].google_search is not None


def test_generate_quiz_questions_calls_gemini_with_forced_tool_and_context(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "return_quiz_questions"
    fake_call.args = {
        "questions": [
            {
                "question": "What is the refund window?",
                "options": ["7 days", "30 days", "60 days", "90 days"],
                "correct_answer": 1,
                "source_document_id": "doc-1",
                "source_chunk_index": 1,
            }
        ]
    }
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    chunks = [
        {
            "document_id": "doc-1",
            "filename": "policy.pdf",
            "chunk_index": 1,
            "total_chunks": 3,
            "content": "Refunds must be requested within 30 days of purchase.",
        }
    ]

    result = llm.generate_quiz_questions(chunks, 10)

    assert result == [
        {
            "question": "What is the refund window?",
            "options": ["7 days", "30 days", "60 days", "90 days"],
            "correct_answer": 1,
            "source_document_id": "doc-1",
            "source_chunk_index": 1,
        }
    ]
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == "gemini-2.5-flash"
    assert kwargs["config"].thinking_config.thinking_budget == 0
    assert kwargs["config"].tools[0].function_declarations == [llm.QUIZ_TOOL]
    assert kwargs["config"].tool_config.function_calling_config.mode == "ANY"
    assert kwargs["config"].tool_config.function_calling_config.allowed_function_names == [
        "return_quiz_questions"
    ]
    assert "policy.pdf" in kwargs["contents"]
    assert "passage 2 of 3" in kwargs["contents"]
    assert "doc-1" in kwargs["contents"]
    assert "10" in kwargs["config"].system_instruction


def test_generate_quiz_questions_returns_empty_list_when_no_function_call(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.generate_quiz_questions(
        [{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c"}],
        5,
    )

    assert result == []
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_llm.py -v`
Expected: FAIL/ERROR — the current `llm.py` still imports `anthropic` and builds `anthropic.Anthropic(...)`, so `llm._client` doesn't have a `.models.generate_content` attribute shaped the way these tests expect, and `llm.QUIZ_TOOL` doesn't exist as a `types.FunctionDeclaration`. (If `anthropic` was removed from the venv already, this may instead fail at collection with an `ImportError` on `import anthropic` inside `llm.py` — either failure mode confirms the old implementation is still in place.)

- [ ] **Step 7: Rewrite llm.py**

Replace `backend/app/services/llm.py` in full:

```python
from google import genai
from google.genai import types

from app.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = (
    "You are a document assistant. Answer the user's question using ONLY the "
    "document passages provided below. Mention the source filename when you "
    "draw on a passage. If the passages do not contain enough information to "
    "answer the question, say so directly instead of answering from general "
    "knowledge."
)


def answer_from_chunks(question: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    response = _client.models.generate_content(
        model=MODEL,
        contents=f"Document passages:\n\n{context}\n\nQuestion: {question}",
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return response.text


def answer_with_web_search(question: str) -> str:
    response = _client.models.generate_content(
        model=MODEL,
        contents=question,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    return response.text


QUIZ_TOOL = types.FunctionDeclaration(
    name="return_quiz_questions",
    description="Return the generated multiple-choice quiz questions.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "questions": types.Schema(
                type="ARRAY",
                items=types.Schema(
                    type="OBJECT",
                    properties={
                        "question": types.Schema(type="STRING"),
                        "options": types.Schema(
                            type="ARRAY",
                            items=types.Schema(type="STRING"),
                            min_items=4,
                            max_items=4,
                        ),
                        "correct_answer": types.Schema(type="INTEGER", minimum=0, maximum=3),
                        "source_document_id": types.Schema(type="STRING"),
                        "source_chunk_index": types.Schema(type="INTEGER"),
                    },
                    required=[
                        "question",
                        "options",
                        "correct_answer",
                        "source_document_id",
                        "source_chunk_index",
                    ],
                ),
            )
        },
        required=["questions"],
    ),
)


def _quiz_system_prompt(num_questions: int) -> str:
    return (
        f"You are a quiz generator. Using ONLY the document passages provided, "
        f"generate up to {num_questions} multiple-choice questions that test "
        f"understanding of their content. Each question must have exactly 4 "
        f"options with exactly one correct answer, and must cite the passage "
        f"(source_document_id and source_chunk_index) it is based on. If the "
        f"passages cannot support {num_questions} good, clearly-grounded "
        f"questions, generate fewer rather than inventing questions not "
        f"supported by the passages. Do not ask about anything not present "
        f"in the passages."
    )


def generate_quiz_questions(chunks: list[dict], num_questions: int) -> list[dict]:
    context = "\n\n".join(
        f"[Source: {c['filename']} (document_id {c['document_id']}), "
        f"passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    response = _client.models.generate_content(
        model=MODEL,
        contents=f"Document passages:\n\n{context}",
        config=types.GenerateContentConfig(
            system_instruction=_quiz_system_prompt(num_questions),
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            tools=[types.Tool(function_declarations=[QUIZ_TOOL])],
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode="ANY",
                    allowed_function_names=["return_quiz_questions"],
                )
            ),
        ),
    )
    for call in response.function_calls or []:
        if call.name == "return_quiz_questions":
            return call.args["questions"]
    return []
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_llm.py -v`
Expected: 5 passed.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (73 existing, none removed or added by this task — `test_llm.py`'s test count changes from 5 to 5, same count, different tests).

- [ ] **Step 10: Update README mentions of Claude/Anthropic**

In `README.md`, make these replacements:
- Line 13: `- **LLM:** Claude API (\`claude-sonnet-5\`) — chat Q&A and quiz generation` → `- **LLM:** Gemini API (\`gemini-2.5-flash\`) — chat Q&A and quiz generation`
- Line 15: `Data flow: Browser → FastAPI → Supabase (Postgres/pgvector + Storage), and → Voyage AI / Claude APIs.` → `Data flow: Browser → FastAPI → Supabase (Postgres/pgvector + Storage), and → Voyage AI / Gemini APIs.`
- Line 23: `- API keys: Voyage AI, Anthropic (Claude)` → `- API keys: Voyage AI, Google AI Studio (Gemini)`
- Line 41 (the config table): `| \`ANTHROPIC_API_KEY\` | Claude API key (chat + quiz generation) |` → `| \`GEMINI_API_KEY\` | Gemini API key (chat + quiz generation) |`
- Line 123 (project layout comment): `services/       # embeddings.py (Voyage), llm.py (Claude), extraction/chunking/processing/storage` → `services/       # embeddings.py (Voyage), llm.py (Gemini), extraction/chunking/processing/storage`

- [ ] **Step 11: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/.env.example backend/tests/conftest.py backend/app/services/llm.py backend/tests/test_llm.py README.md
git commit -m "feat: switch backend LLM provider from Anthropic to Gemini"
```

---

## Manual End-to-End Verification (after the task completes)

1. Get a real Gemini API key from Google AI Studio, set `GEMINI_API_KEY` in `backend/.env`.
2. Start the backend and frontend, log in, upload a document.
3. Ask a question on `/chat` without web search — confirm a grounded answer citing the document appears.
4. Ask a question on `/chat` with the web-search checkbox on — confirm an answer appears with the "Web" badge. If Google Search grounding isn't available on your account's free tier, this is the step where you'd find out — see the design spec's note on this being an unverified risk.
5. Generate a quiz on `/quiz` — confirm real, grounded multiple-choice questions come back (not an empty list), and that submitting scores correctly.
