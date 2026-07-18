from unittest.mock import MagicMock

from app.services import llm


def test_answer_from_chunks_calls_gemini_with_context_and_disabled_thinking(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="Refunds are available within 30 days.")
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
    assert kwargs["model"] == llm.MODEL
    assert kwargs["config"].thinking_config.thinking_budget == 0
    assert kwargs["config"].system_instruction == llm.SYSTEM_PROMPT
    assert "policy.pdf" in kwargs["contents"]
    assert "passage 2 of 3" in kwargs["contents"]
    assert "Refunds must be requested within 30 days" in kwargs["contents"]
    assert "What is the refund window?" in kwargs["contents"]


def test_answer_from_chunks_returns_response_text(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="Part one. Part two.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_from_chunks(
        "q", [{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c", "score": 0.9}]
    )

    assert result == "Part one. Part two."


def test_answer_with_web_search_calls_gemini_with_search_tool(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="It's sunny today.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_with_web_search("What's the weather?")

    assert result == "It's sunny today."
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == llm.MODEL
    assert kwargs["contents"] == "What's the weather?"
    tools = kwargs["config"].tools
    assert len(tools) == 1
    assert tools[0].google_search is not None


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
    assert kwargs["model"] == llm.MODEL
    assert kwargs["config"].thinking_config.thinking_budget == 0
    assert kwargs["config"].tools[0].function_declarations == [llm.QUIZ_TOOL]
    tool_config = kwargs["config"].tool_config
    assert tool_config.function_calling_config.mode == "ANY"
    assert tool_config.function_calling_config.allowed_function_names == ["return_quiz_questions"]
    assert "policy.pdf" in kwargs["contents"]
    assert "passage 2 of 3" in kwargs["contents"]
    assert "doc-1" in kwargs["contents"]
    assert "10" in kwargs["config"].system_instruction


def test_generate_quiz_questions_returns_empty_list_when_no_function_call(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.generate_quiz_questions([{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c"}], 5)

    assert result == []
