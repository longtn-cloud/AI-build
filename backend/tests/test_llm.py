from unittest.mock import MagicMock

from app.services import llm


def _text_block(text):
    block = MagicMock()
    block.type = "text"
    block.text = text
    return block


def test_answer_from_chunks_calls_claude_with_context_and_disabled_thinking(monkeypatch):
    fake_client = MagicMock()
    fake_client.messages.create.return_value = MagicMock(content=[_text_block("Refunds are available within 30 days.")])
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
    _, kwargs = fake_client.messages.create.call_args
    assert kwargs["model"] == "claude-sonnet-5"
    assert kwargs["thinking"] == {"type": "disabled"}
    assert "policy.pdf" in kwargs["messages"][0]["content"]
    assert "passage 2 of 3" in kwargs["messages"][0]["content"]
    assert "Refunds must be requested within 30 days" in kwargs["messages"][0]["content"]
    assert "What is the refund window?" in kwargs["messages"][0]["content"]


def test_answer_from_chunks_joins_multiple_text_blocks(monkeypatch):
    fake_client = MagicMock()
    fake_client.messages.create.return_value = MagicMock(
        content=[_text_block("Part one. "), _text_block("Part two.")]
    )
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_from_chunks("q", [{"document_id": "d", "filename": "f.txt", "chunk_index": 0, "total_chunks": 1, "content": "c", "score": 0.9}])

    assert result == "Part one. Part two."


def test_answer_with_web_search_calls_claude_with_web_search_tool(monkeypatch):
    fake_client = MagicMock()
    fake_client.messages.create.return_value = MagicMock(content=[_text_block("It's sunny today.")])
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_with_web_search("What's the weather?")

    assert result == "It's sunny today."
    _, kwargs = fake_client.messages.create.call_args
    assert kwargs["model"] == "claude-sonnet-5"
    assert kwargs["tools"] == [{"type": "web_search_20260209", "name": "web_search"}]
    assert kwargs["messages"] == [{"role": "user", "content": "What's the weather?"}]
