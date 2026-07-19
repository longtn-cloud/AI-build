# Chat Assistant Reasoning & General-Knowledge Fallback — Design

Extends `docs/superpowers/specs/2026-07-18-chat-design.md` (the original Chat Q&A design, since migrated from Claude to Gemini per `2026-07-18-gemini-migration-design.md`). That design deliberately made grounding a *structural* guarantee: "grounding is enforced by never invoking the LLM when nothing qualifies, not by trusting a prompt." In practice this makes Chat behave like a search tool that occasionally phrases its result as a sentence, not a conversational assistant — every answer is confined to literal passage content, reasoning is explicitly disabled, and each message is answered in isolation with no memory of the conversation. This plan redraws that line: documents remain the *preferred* source and the model is told to reason across them, but the assistant may now fall back to its own general knowledge (clearly flagged) when documents don't fully cover a question, and it remembers the conversation.

## Scope

Changes `backend/app/services/llm.py`, `backend/app/routers/chat.py`, a new migration, and the frontend's `ChatMessage` type/badge rendering in `ChatPage.tsx`/`api.ts`. Retrieval mechanics (embedding model, the 0.5 cosine-similarity threshold, top-10 limit, per-user `WHERE user_id` isolation) are unchanged — this plan changes what happens *after* retrieval, not retrieval itself. Quiz generation (`generate_quiz_questions`, `_quiz_system_prompt`) and the `/search` endpoint are untouched; the "no invented quiz content" and pure-retrieval-search invariants aren't part of this change.

**Deliberately deferred:** per-sentence citation of which specific claim is document-grounded vs. general-knowledge (only a whole-message flag is added, matching the existing `used_web_search` granularity); changing the 0.5 similarity threshold or top-10 chunk limit (out of scope — this plan is about reasoning over what's retrieved, not retrieval quality); adding conversation history to quiz generation (quiz has no notion of a session).

## Decisions

### Two system prompts instead of one, selected by whether any chunk was retrieved

Today's single `SYSTEM_PROMPT` says "using ONLY the document passages... say so directly instead of answering from general knowledge" regardless of whether zero, one, or ten chunks were retrieved. Replaced with two prompts in `llm.py`:

```python
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
```

Rationale: the previous single prompt's "ONLY... say so directly" instruction is exactly what made the model behave like a search tool — it had no license to synthesize, and the answer's caveat-first framing hides an incomplete but nonetheless present partial answer with a rigid "not found" tone rather than answering what the documents do cover. Splitting the prompt by whether context exists keeps each one unambiguous, rather than one prompt trying to cover both cases with conditional language.

### Structured output via forced tool call, not free text

A prompt instruction alone ("call out when you use general knowledge") is exactly the kind of thing this codebase already avoids trusting for grounding — the original design's own rationale ("not by trusting a prompt") applies equally here. Instead, reuse the forced-function-call pattern already proven for quiz generation:

```python
ANSWER_TOOL = types.FunctionDeclaration(
    name="provide_answer",
    description="Return the final answer to the user's question.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "answer": types.Schema(type="STRING", description="The answer, addressed directly to the user."),
            "used_general_knowledge": types.Schema(
                type="BOOLEAN",
                description="True if any part of the answer relies on information not present in the provided document passages.",
            ),
        },
        required=["answer", "used_general_knowledge"],
    ),
)
```

Called with `tool_config=ToolConfig(function_calling_config=FunctionCallingConfig(mode="ANY", allowed_function_names=["provide_answer"]))`, same shape as `QUIZ_TOOL`. `answer_from_chunks` now returns `dict` (`{"answer": str, "used_general_knowledge": bool}`) instead of `str` — a breaking signature change from the current function, accepted because both call sites (`chat.py`) are updated in the same plan.

### `answer_from_chunks` accepts an empty chunk list — replaces the router's hard "not found" bypass

Signature becomes `answer_from_chunks(question: str, chunks: list[dict], history: list[dict] | None = None) -> dict`. When `chunks` is empty, it uses `GENERAL_KNOWLEDGE_SYSTEM_PROMPT` and sends just the question (no "Document passages:" section); when non-empty, it uses `DOCUMENTS_SYSTEM_PROMPT` with the same passage-formatting as today. `chat.py`'s retrieval query and `MIN_SIMILARITY_THRESHOLD` filter are unchanged — it still only fetches chunks scoring ≥0.5 — but the router **no longer special-cases the zero-rows result**. It always calls `answer_from_chunks`, passing whatever chunks (possibly none) were retrieved. This removes `NOT_FOUND_MESSAGE` and the `if not chunk_rows` branch's early return entirely.

Consequence for the "documents first, general knowledge as fallback" requirement: a question entirely unrelated to the user's documents now gets a real, useful answer (flagged `used_general_knowledge: true`, `citations: []`) instead of a canned refusal — matching the approved design choice. A question partially covered by documents gets an answer that draws on both, flagged the same way, with non-empty `citations`.

### Thinking re-enabled: `thinking_budget=0` → `thinking_budget=-1` (dynamic)

`-1` is Gemini's documented value for "let the model decide how much to think, per-request," as opposed to `0` (disabled) or a fixed positive token budget. This directly targets the user-reported symptom ("it doesn't think, just searches") — the model can now reason before producing the forced tool call, at the cost of somewhat higher latency/token usage per message, which is an acceptable tradeoff for chat response quality over a document-Q&A tool. Applied to both `answer_from_chunks` and `answer_with_web_search` (the latter currently omits `thinking_config` entirely, i.e. already model-default — left as-is). `generate_quiz_questions` keeps `thinking_budget=0`, unchanged: quiz generation extracts facts into a fixed schema and doesn't benefit from open-ended reasoning the way conversational answering does, and it's out of scope for this plan.

### Conversation history: last 10 messages, passed as prior turns

`chat.py` fetches the session's existing `chat_messages` (ordered `created_at ASC`, before inserting the new user message) and passes the last 10 (5 user/assistant pairs) to `answer_from_chunks`/`answer_with_web_search` as `history: list[dict]` (`{"role": "user"|"assistant", "content": str}`). `llm.py` converts these into Gemini `Content` objects (role `"model"` for `"assistant"`, matching Gemini's naming — not `"assistant"`) and prepends them to `contents` as a list, with the current turn's documents-context-and-question (or bare question) appended as the final `Content`. 10 is a starting value chosen to keep prompt size bounded for a chat UI expecting quick replies, not a tuned constant — same spirit as the existing `MIN_SIMILARITY_THRESHOLD` comment. Applied to both the document-grounded and web-search paths, since both are conversational chat turns and a follow-up question should work the same way regardless of which mode answered the previous turn.

### New column: `chat_messages.used_general_knowledge`

`backend/migrations/0005_chat_general_knowledge.sql`:

```sql
alter table chat_messages
    add column used_general_knowledge boolean not null default false;
```

Mirrors `used_web_search`'s existing shape exactly (same type, same default, same "false unless explicitly set" semantics). User messages and the web-search path always have `used_general_knowledge = false` at the row level, even if this plan added history-aware reasoning to web search — the *web search itself* is the flagged distinction for that path, not a separate general-knowledge sub-flag.

### Frontend: extend the existing badge, don't add new UI chrome

`ChatMessage` type (`frontend/src/lib/api.ts`) gets `used_general_knowledge: boolean` alongside `used_web_search`. `ChatPage.tsx`'s badge logic (currently only `used_web_search && <Badge variant="blue">Web</Badge>`) becomes:

- `used_web_search` → `Web` badge (unchanged, checked first — web search is structurally exclusive from document retrieval already).
- else `used_general_knowledge && citations.length === 0` → `General knowledge` badge.
- else `used_general_knowledge && citations.length > 0` → `Documents + General knowledge` badge.
- else (fully document-grounded, or no citations and no flags — shouldn't happen post-change but harmless) → no badge, same as today.

No new badge variant/color is introduced beyond reusing `Badge`'s existing `variant="blue"` — visually consistent with the current single "Web" badge, just with different label text for the two new cases.

## Error Handling & Edge Cases

- Gemini API failure still surfaces as a `502` from `chat.py` — unchanged from today; the forced tool call adds a new failure mode (model doesn't emit the `provide_answer` call) that should also surface as a 502 rather than silently returning an empty/default answer, since a missing tool call is a genuine generation failure, not a valid "no answer" state.
- Empty/whitespace message content, session ownership (404 for another user's session), and cross-user chunk isolation are all unchanged from the original design — this plan doesn't touch those code paths.
- The "not found" canned message and its constant (`NOT_FOUND_MESSAGE`) are removed from `chat.py` entirely — there is no longer a code path that returns it.
- History fetched for a brand-new session (no prior messages) is an empty list — `llm.py` must handle `history=[]`/`None` by sending only the current turn, matching today's single-turn behavior for a session's first message.

## Testing Strategy

- **`backend/tests/test_llm.py`**: rewrite the `answer_from_chunks` tests for the new dict return shape and forced-tool-call pattern (same `fake_client.models.generate_content.return_value = MagicMock(function_calls=[...])` style already used for the quiz test in this file). Add cases: chunks present → `DOCUMENTS_SYSTEM_PROMPT` used; chunks empty → `GENERAL_KNOWLEDGE_SYSTEM_PROMPT` used and no "Document passages:" text sent; `thinking_config.thinking_budget == -1`; history messages converted into the `contents` list with the right roles, in order, ahead of the current turn.
- **`backend/tests/test_chat.py`**: `test_send_message_returns_not_found_message_when_nothing_clears_threshold` and `test_send_message_excludes_other_users_chunks` currently assert `answer_mock.assert_not_called()` and the fixed message — both must change to assert `answer_from_chunks` **is** called with an empty chunk list, and that the response's `used_general_knowledge`/`citations` reflect the mocked return value. Add: a message with prior session history includes those messages when calling `answer_from_chunks`/`answer_with_web_search`; `used_general_knowledge` round-trips correctly through the persisted row and the response JSON for all three cases (fully grounded, partially grounded, ungrounded).
- **Frontend**: extend `ChatPage`'s existing test coverage (or add if none exists yet — verify during planning) for the three new badge states, alongside the existing `used_web_search` badge test.
- No end-to-end/Playwright tests, consistent with the original Chat design and every other plan in this codebase.
