from app.services.chunking import chunk_text


def test_empty_text_returns_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_short_text_returns_single_chunk():
    result = chunk_text("hello world", chunk_size=1000, overlap=150)
    assert result == ["hello world"]


def test_long_text_splits_into_overlapping_chunks():
    text = "a" * 2500
    result = chunk_text(text, chunk_size=1000, overlap=150)

    assert len(result) == 3
    assert result[0] == "a" * 1000
    # second chunk starts 150 chars before the end of the first
    assert result[1] == text[850:1850]
    assert result[2] == text[1700:2500]


def test_drops_whitespace_only_chunks():
    text = "A" * 100 + " " * 3000 + "B" * 100

    result = chunk_text(text, chunk_size=1000, overlap=150)

    assert all(chunk.strip() for chunk in result)
    assert result[0].startswith("A" * 100)
    assert result[-1].endswith("B" * 100)
