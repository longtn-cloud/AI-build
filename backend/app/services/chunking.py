def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        piece = text[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= len(text):
            break
        start = end - overlap

    return chunks
