from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat, documents, search

app = FastAPI(title="Document Knowledge Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)


@app.get("/health")
def health():
    return {"status": "ok"}
