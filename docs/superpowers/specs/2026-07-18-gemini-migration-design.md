# Gemini Migration — Design

Switches the backend's LLM provider from Anthropic (Claude) to Google's Gemini API, driven by the Anthropic API key no longer supporting free usage. Verified against the real installed `google-genai` SDK (not just training-data recall) before committing to this design, since Gemini's function-calling and search-grounding APIs differ meaningfully from Anthropic's tool-use API in ways that would have been easy to get subtly wrong from memory.

## Scope

Only `backend/app/services/llm.py` and its test, `backend/requirements.txt`, `backend/app/config.py`, and the two `.env.example` files change. `backend/app/routers/chat.py` and `backend/app/routers/quiz.py` are untouched — every function in `llm.py` keeps its exact existing signature, so nothing downstream needs to change.

## Decisions

**Package:** `google-genai` (the current, maintained Google GenAI Python SDK) replaces `anthropic` in `backend/requirements.txt`.

**Model:** `gemini-2.5-flash` — a free-tier-eligible, cost-efficient Gemini model supporting both function calling and Google Search grounding, the two capabilities this app depends on. Not independently verifiable from this environment: live free-tier quota/grounding policy. If Google Search grounding turns out to be unavailable or too rate-limited on the free tier in practice, that's a follow-up to revisit — not something to speculatively design around now.

**Config renaming:** `Settings.anthropic_api_key` (`backend/app/config.py`) becomes `Settings.gemini_api_key`; `ANTHROPIC_API_KEY` becomes `GEMINI_API_KEY` in both `backend/.env.example` and any local `.env`. No other settings change.

**Client construction:** `_client = genai.Client(api_key=settings.gemini_api_key)` at module load, mirroring the existing `_client = anthropic.Anthropic(api_key=...)` pattern exactly — same lazy, module-level singleton shape.

**`answer_from_chunks(question, chunks) -> str`:** unchanged signature and unchanged `SYSTEM_PROMPT` text. Calls:
```python
response = _client.models.generate_content(
    model=MODEL,
    contents=f"Document passages:\n\n{context}\n\nQuestion: {question}",
    config=types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    ),
)
return response.text
```
`thinking_budget=0` is Gemini's equivalent of Claude's `thinking: {"type": "disabled"}` — verified as a real, accepted field on `ThinkingConfig`.

**`answer_with_web_search(question) -> str`:** unchanged signature, no system instruction (matches today's behavior — the original Claude call passes no `system` param here either). Calls:
```python
response = _client.models.generate_content(
    model=MODEL,
    contents=question,
    config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
)
return response.text
```
`Tool(google_search=GoogleSearch())` is Gemini's built-in search-grounding tool — verified as a real, constructible field on `Tool`. The router already discards citations for web-search answers (`citations: list[dict] = []` in `chat.py`), so no grounding-metadata parsing is needed here.

**`generate_quiz_questions(chunks, num_questions) -> list[dict]`:** unchanged signature and unchanged `_quiz_system_prompt` text. `QUIZ_TOOL` (currently an Anthropic-shaped dict) becomes a module-level `types.FunctionDeclaration` with an equivalent `types.Schema` tree — same field names and structure (`questions` array of objects with `question`/`options`/`correct_answer`/`source_document_id`/`source_chunk_index`), verified to construct correctly against the real SDK. Calls:
```python
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
`response.function_calls` is a real convenience property (verified) returning a list of `FunctionCall` objects; `FunctionCall.args` is a plain `dict[str, Any]` (verified — no `MapComposite`-style conversion needed, unlike some other Google SDKs).

## Error Handling & Edge Cases

- No behavior change to error handling — none of the three functions had explicit error handling before (a raised SDK exception propagates as a 500, same as today), and this migration doesn't add any.
- `generate_quiz_questions` returning `[]` when no matching function call is found is unchanged behavior (mirrors the original "no tool_use block" fallback).

## Testing Strategy

- `backend/tests/test_llm.py` is rewritten in the same `MagicMock`-based style it already uses (no new testing framework or pattern introduced): `monkeypatch.setattr(llm, "_client", fake_client)`, then assert on `fake_client.models.generate_content.call_args` for the right `model`/`config` shape, and set `fake_client.models.generate_content.return_value` to a `MagicMock` with `.text` (for the two plain-text functions) or `.function_calls` (a list of `MagicMock`s with `.name`/`.args`, for the quiz function) set directly — mirroring how the existing tests set `.content` block lists today.
- Every existing test case's *intent* carries over unchanged: right model passed, right context/question text embedded in the prompt, right config flags (`thinking_budget=0`, the web-search tool, the forced quiz tool), correct extraction of the final result, and the empty-list fallback when no function call comes back.
