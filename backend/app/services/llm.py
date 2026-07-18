import anthropic

from app.config import settings

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

MODEL = "claude-sonnet-5"

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
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Document passages:\n\n{context}\n\nQuestion: {question}",
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text")


def answer_with_web_search(question: str) -> str:
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
        messages=[{"role": "user", "content": question}],
    )
    return "".join(block.text for block in message.content if block.type == "text")


QUIZ_TOOL = {
    "name": "return_quiz_questions",
    "description": "Return the generated multiple-choice quiz questions.",
    "input_schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 4,
                            "maxItems": 4,
                        },
                        "correct_answer": {"type": "integer", "minimum": 0, "maximum": 3},
                        "source_document_id": {"type": "string"},
                        "source_chunk_index": {"type": "integer"},
                    },
                    "required": [
                        "question",
                        "options",
                        "correct_answer",
                        "source_document_id",
                        "source_chunk_index",
                    ],
                },
            }
        },
        "required": ["questions"],
    },
}


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
    message = _client.messages.create(
        model=MODEL,
        max_tokens=8192,
        thinking={"type": "disabled"},
        system=_quiz_system_prompt(num_questions),
        tools=[QUIZ_TOOL],
        tool_choice={"type": "tool", "name": "return_quiz_questions"},
        messages=[
            {
                "role": "user",
                "content": f"Document passages:\n\n{context}",
            }
        ],
    )
    for block in message.content:
        if block.type == "tool_use" and block.name == "return_quiz_questions":
            return block.input["questions"]
    return []
