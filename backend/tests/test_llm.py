from unittest.mock import MagicMock

import pytest
from google.genai import errors as genai_errors

from app.services import llm


def test_answer_from_chunks_calls_gemini_with_context_and_dynamic_thinking(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "Refunds are available within 30 days.", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
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

    assert result == {"answer": "Refunds are available within 30 days.", "used_general_knowledge": False}
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == llm.MODEL
    assert kwargs["config"].thinking_config.thinking_budget == -1
    assert kwargs["config"].system_instruction == llm.DOCUMENTS_SYSTEM_PROMPT + " Respond in Vietnamese."
    assert kwargs["config"].tools[0].function_declarations == [llm.ANSWER_TOOL]
    tool_config = kwargs["config"].tool_config
    assert tool_config.function_calling_config.mode == "ANY"
    assert tool_config.function_calling_config.allowed_function_names == ["provide_answer"]

    contents = kwargs["contents"]
    assert len(contents) == 1
    turn_text = contents[0].parts[0].text
    assert "policy.pdf" in turn_text
    assert "passage 2 of 3" in turn_text
    assert "Refunds must be requested within 30 days" in turn_text
    assert "What is the refund window?" in turn_text


def test_answer_from_chunks_uses_general_knowledge_prompt_when_no_chunks(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "Paris is the capital of France.", "used_general_knowledge": True}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_from_chunks("What is the capital of France?", [])

    assert result == {"answer": "Paris is the capital of France.", "used_general_knowledge": True}
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["config"].system_instruction == llm.GENERAL_KNOWLEDGE_SYSTEM_PROMPT + " Respond in Vietnamese."
    turn_text = kwargs["contents"][-1].parts[0].text
    assert turn_text == "What is the capital of France?"
    assert "Document passages" not in turn_text


def test_answer_from_chunks_includes_conversation_history(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "The second one is a laptop.", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    history = [
        {"role": "user", "content": "What products do you have?"},
        {"role": "assistant", "content": "A phone and a laptop."},
    ]

    llm.answer_from_chunks("What about the second one?", [], history=history)

    _, kwargs = fake_client.models.generate_content.call_args
    contents = kwargs["contents"]
    assert len(contents) == 3
    assert contents[0].role == "user"
    assert contents[0].parts[0].text == "What products do you have?"
    assert contents[1].role == "model"
    assert contents[1].parts[0].text == "A phone and a laptop."
    assert contents[2].role == "user"
    assert contents[2].parts[0].text == "What about the second one?"


def test_answer_from_chunks_raises_when_no_tool_call(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    with pytest.raises(RuntimeError):
        llm.answer_from_chunks("question", [])


def test_answer_with_web_search_calls_gemini_with_search_tool(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="It's sunny today.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_with_web_search("What's the weather?")

    assert result == "It's sunny today."
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == llm.MODEL
    contents = kwargs["contents"]
    assert len(contents) == 1
    assert contents[0].parts[0].text == "What's the weather?"
    tools = kwargs["config"].tools
    assert len(tools) == 1
    assert tools[0].google_search is not None


def test_answer_with_web_search_includes_conversation_history(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="Still sunny tomorrow.")
    monkeypatch.setattr(llm, "_client", fake_client)

    history = [
        {"role": "user", "content": "What's the weather in Paris?"},
        {"role": "assistant", "content": "It's sunny today."},
    ]

    llm.answer_with_web_search("And tomorrow?", history=history)

    _, kwargs = fake_client.models.generate_content.call_args
    contents = kwargs["contents"]
    assert len(contents) == 3
    assert contents[0].parts[0].text == "What's the weather in Paris?"
    assert contents[1].role == "model"
    assert contents[2].parts[0].text == "And tomorrow?"


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


def test_answer_from_chunks_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "answer", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_from_chunks("question", [])

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction


def test_answer_from_chunks_uses_english_instruction_when_requested(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "answer", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_from_chunks("question", [], language="en")

    _, kwargs = fake_client.models.generate_content.call_args
    assert "English" in kwargs["config"].system_instruction


def test_answer_with_web_search_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="answer")
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.answer_with_web_search("question")

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction


def test_generate_quiz_questions_defaults_to_vietnamese_instruction(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    llm.generate_quiz_questions([{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c"}], 5)

    _, kwargs = fake_client.models.generate_content.call_args
    assert "Vietnamese" in kwargs["config"].system_instruction


def test_llm_error_response_maps_quota_error_to_429():
    exc = genai_errors.APIError(429, {"error": {"status": "RESOURCE_EXHAUSTED"}})

    status_code, detail = llm.llm_error_response(exc, "fallback message")

    assert status_code == 429
    assert "quota" in detail.lower() or "rate-limited" in detail.lower()


def test_llm_error_response_maps_other_api_error_to_502_with_fallback():
    exc = genai_errors.APIError(500, {"error": {"status": "INTERNAL"}})

    status_code, detail = llm.llm_error_response(exc, "fallback message")

    assert status_code == 502
    assert detail == "fallback message"


def test_llm_error_response_maps_generic_exception_to_502_with_fallback():
    status_code, detail = llm.llm_error_response(RuntimeError("boom"), "fallback message")

    assert status_code == 502
    assert detail == "fallback message"
