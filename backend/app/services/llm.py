import logging

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.gemini_api_key)

MODEL = "gemini-flash-latest"


def llm_error_response(exc: Exception, fallback_detail: str) -> tuple[int, str]:
    """Log a failed LLM/embedding call and map it to an HTTP status + detail.

    The Gemini SDK raises ``APIError`` with an HTTP ``code`` (e.g. 429 when the
    key is rate-limited or over quota). Surfacing that distinctly turns an opaque
    502 into an actionable signal, and logging the exception makes the real cause
    visible in the server logs instead of being swallowed.
    """
    logger.exception("LLM call failed")
    if isinstance(exc, genai_errors.APIError) and exc.code == 429:
        return 429, (
            "The AI service is rate-limited or over quota. "
            "Please try again in a little while."
        )
    return 502, fallback_detail

DOCUMENTS_SYSTEM_PROMPT = (
    "You are a knowledgeable assistant helping the user understand their uploaded "
    "documents. Treat the document passages below as background knowledge to think "
    "with, not as a literal string to pattern-match against the question — reason "
    "across them, connect related points, and answer in your own words. Never treat "
    "retrieval as an exact-keyword search: if a word from the question doesn't "
    "literally appear in the passages, that does not mean the passages lack an "
    "answer, and if a word does appear, that does not mean quoting the sentence "
    "around it answers the question. Analyze what the passages actually convey — "
    "their content, structure, and stated intent — and synthesize that into a "
    "direct answer. For example, if asked \"what is the purpose of this document\", "
    "do not search the passages for the literal word \"purpose\"; read what the "
    "document describes, sets out to do, or is organized around, and state that "
    "purpose in your own words. Before finalizing your answer, check that each "
    "claim in it is actually supported by, or reasonably inferred from, the "
    "passages — not just plausible-sounding. "
    "Cite the source filename when you draw on a passage. If the passages only "
    "partially answer the question, or don't cover it at all, you may fill the "
    "gap with your own general knowledge — but never invent specifics about the "
    "documents themselves (numbers, names, policies) that aren't actually there. "
    "Call provide_answer with used_general_knowledge=true whenever any part of "
    "your answer relies on something not present in the passages."
)

GENERAL_KNOWLEDGE_SYSTEM_PROMPT = (
    "You are a helpful assistant. None of the user's uploaded documents contain "
    "content relevant to this question, so answer from your own general "
    "knowledge as best you can. Always call provide_answer with "
    "used_general_knowledge=true."
)

WEB_SEARCH_SYSTEM_PROMPT = (
    "You are a helpful assistant. Use the web search tool to find current, "
    "accurate information and answer the user's question directly in your own "
    "words, citing sources when it helps the user verify the answer."
)

_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}


def _language_instruction(language: str) -> str:
    return f" Respond in {_LANGUAGE_NAMES[language]}."


ANSWER_TOOL = types.FunctionDeclaration(
    name="provide_answer",
    description="Return the final answer to the user's question.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "answer": types.Schema(
                type="STRING",
                description="The answer, addressed directly to the user.",
            ),
            "used_general_knowledge": types.Schema(
                type="BOOLEAN",
                description=(
                    "True if any part of the answer relies on information not "
                    "present in the provided document passages."
                ),
            ),
        },
        required=["answer", "used_general_knowledge"],
    ),
)

_ANSWER_TOOL_CONFIG = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(
        mode="ANY",
        allowed_function_names=["provide_answer"],
    )
)


def _history_contents(history: list[dict] | None) -> list[types.Content]:
    if not history:
        return []
    return [
        types.Content(
            role="model" if turn["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=turn["content"])],
        )
        for turn in history
    ]


def _extract_answer(response) -> dict:
    for call in response.function_calls or []:
        if call.name == "provide_answer":
            return {
                "answer": call.args["answer"],
                "used_general_knowledge": call.args["used_general_knowledge"],
            }
    raise RuntimeError("Gemini did not call provide_answer")


def answer_from_chunks(
    question: str, chunks: list[dict], history: list[dict] | None = None, language: str = "vi"
) -> dict:
    if chunks:
        context = "\n\n".join(
            f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
            for c in chunks
        )
        turn_text = (
            f"<document_passages>\n{context}\n</document_passages>\n\n"
            f"<question>{question}</question>"
        )
        system_prompt = DOCUMENTS_SYSTEM_PROMPT
    else:
        turn_text = question
        system_prompt = GENERAL_KNOWLEDGE_SYSTEM_PROMPT

    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=turn_text)])
    ]

    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt + _language_instruction(language),
            thinking_config=types.ThinkingConfig(thinking_budget=-1),
            tools=[types.Tool(function_declarations=[ANSWER_TOOL])],
            tool_config=_ANSWER_TOOL_CONFIG,
        ),
    )
    return _extract_answer(response)


def answer_with_web_search(question: str, history: list[dict] | None = None, language: str = "vi") -> str:
    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=question)])
    ]
    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=WEB_SEARCH_SYSTEM_PROMPT + _language_instruction(language),
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


def _quiz_system_prompt(num_questions: int, language: str = "vi") -> str:
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
    ) + _language_instruction(language)


def generate_quiz_questions(chunks: list[dict], num_questions: int, language: str = "vi") -> list[dict]:
    context = "\n\n".join(
        f"[Source: {c['filename']} (document_id {c['document_id']}), "
        f"passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    response = _client.models.generate_content(
        model=MODEL,
        contents=f"Document passages:\n\n{context}",
        config=types.GenerateContentConfig(
            system_instruction=_quiz_system_prompt(num_questions, language),
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
