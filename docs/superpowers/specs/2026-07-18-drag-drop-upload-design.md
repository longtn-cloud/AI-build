# Drag-and-Drop File Upload — Design

Extends `DocumentsPage`'s existing upload control with a drag-and-drop target, as an additional way to trigger the exact same upload path already used by click-to-browse — not a parallel or divergent feature.

## Scope

Single file only, matching the current `<input type="file">`'s behavior (no `multiple` attribute today). No new client-side file-type/size validation — a dropped file goes through the same `uploadDocument()` call and error handling as a browsed file; the backend's existing validation (`allowed_file_types`, `max_upload_bytes` in `app/config.py`) remains the single source of truth. Out of scope: multi-file batch upload, upload progress bars, client-side pre-validation.

## Decisions

**Shared upload path:** The current `handleUpload(event)` (triggered by the file input's `onChange`) is refactored into a shared `uploadFile(file: File)` async helper containing the existing try/`uploadDocument`/`refresh`/catch/`setError` logic. Both the file input's `onChange` and the new drop handler call `uploadFile`, so there is exactly one upload/error code path, not two that could drift apart.

**Drop zone structure:** The existing `<label htmlFor="upload-input">Upload document</label>` + `<input id="upload-input" type="file">` pair is wrapped in a new container `<div>` with `onDragOver`, `onDragLeave`, and `onDrop` handlers. The label and input keep their exact existing text/id/htmlFor/onChange — this is additive styling and behavior around them, not a replacement. A boolean `isDraggingOver` state (set on `onDragOver`, cleared on `onDragLeave`/`onDrop`) toggles the container's visual state.

**Single-file selection from a drop:** `event.dataTransfer.files[0]` is used; if additional files were dropped simultaneously, they're silently ignored (matches the existing single-file input's behavior, no new UI needed to explain this).

**Default-behavior safety net:** Every handler (`onDragOver`, `onDrop`) calls `event.preventDefault()`. This is required for `onDrop` to fire at all in the browser (without it, dropping a file navigates the browser to that file instead), and applying it consistently means a file dropped just outside the box does nothing rather than navigating away from the app.

**Visual treatment:** Styled consistent with the app's existing "reading room" design system — a dashed brass-bordered box (evoking a library book-drop tray) that brightens (solid brass border, subtle brass-tinted background) while a file is dragged over it, reverting on drag-leave or drop.

## Error Handling & Edge Cases

- Upload failure (wrong type, too large, network error) from a dropped file surfaces the identical `Alert` and `'Failed to upload document'` message as a failure from the browsed-file path — no divergent error UI.
- Dragging a non-file item (e.g. dragged text or a link) over the zone: `onDrop` still fires; `dataTransfer.files` will simply be empty, so `uploadFile` is never called (guarded by an `if (!file) return`, matching the existing input handler's guard).
- Dropping outside the zone but inside the page: prevented from navigating away by `preventDefault`, but does not trigger an upload — no accidental uploads from stray drops.

## Testing Strategy

- New test in `DocumentsPage.test.tsx`: simulate `fireEvent.drop` on the drop zone with a `dataTransfer: { files: [file] }` object, assert `uploadDocument` was called with that file and the document list refreshes — mirroring the existing "uploads a selected file and refreshes the list" test, but via `drop` instead of `change`.
- No new tests for the `isDraggingOver` visual state — that's an implementation detail, not behavior under test, consistent with this project's testing conventions.
- All existing `DocumentsPage.test.tsx` assertions (`getByLabelText('Upload document')`, rename/delete/download/polling tests) must pass unmodified — this change is additive to the existing upload control, not a replacement.
