from google import genai
from google.genai import types

from app.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

MODEL = "gemini-2.5-flash"

DOCUMENTS_SYSTEM_PROMPT = (
    "You are a knowledgeable assistant helping the user understand their uploaded "
    "documents. Treat the document passages below as your primary source: reason "
    "across them, connect related points, and answer in your own words — don't "
    "simply refuse just because no single sentence states the answer verbatim. "
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


def answer_from_chunks(question: str, chunks: list[dict], history: list[dict] | None = None) -> dict:
    if chunks:
        context = "\n\n".join(
            f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
            for c in chunks
        )
        turn_text = f"Document passages:\n\n{context}\n\nQuestion: {question}"
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
            system_instruction=system_prompt,
            thinking_config=types.ThinkingConfig(thinking_budget=-1),
            tools=[types.Tool(function_declarations=[ANSWER_TOOL])],
            tool_config=_ANSWER_TOOL_CONFIG,
        ),
    )
    return _extract_answer(response)


def answer_with_web_search(question: str, history: list[dict] | None = None) -> str:
    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=question)])
    ]
    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
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
