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
