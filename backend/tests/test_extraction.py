import io

import pytest
from docx import Document as DocxDocument

from app.services.extraction import extract_text


def test_extracts_plain_text():
    result = extract_text(b"hello world", "txt")
    assert result == "hello world"


def test_extracts_markdown_as_plain_text():
    result = extract_text(b"# Title\n\nBody text", "md")
    assert result == "# Title\n\nBody text"


def test_extracts_docx_paragraphs():
    doc = DocxDocument()
    doc.add_paragraph("First paragraph")
    doc.add_paragraph("Second paragraph")
    buffer = io.BytesIO()
    doc.save(buffer)

    result = extract_text(buffer.getvalue(), "docx")

    assert "First paragraph" in result
    assert "Second paragraph" in result


def test_unsupported_type_raises():
    with pytest.raises(ValueError):
        extract_text(b"data", "exe")
