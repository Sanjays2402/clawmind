"""ClawMind embedding sidecar.

Serves an OpenAI-flavored embedding endpoint backed by MLX on Apple Silicon,
falling back to sentence-transformers everywhere else.
"""
from __future__ import annotations

import os
import platform
from typing import List

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .loader import load_backend

app = FastAPI(title="ClawMind Embed", version="0.1.0")

MODEL = os.environ.get("CLAWMIND_EMBED_MODEL", "mlx-community/bge-small-en-v1.5-4bit")
backend = load_backend(MODEL)


class EmbedRequest(BaseModel):
    texts: List[str]
    model: str | None = None


class EmbedResponse(BaseModel):
    vectors: List[List[float]]
    model: str
    dim: int


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": backend.model_id,
        "dim": backend.dim,
        "platform": platform.platform(),
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.texts:
        raise HTTPException(status_code=400, detail="texts must not be empty")
    vecs = backend.encode(req.texts)
    arr = np.asarray(vecs, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    arr = arr / norms
    return EmbedResponse(vectors=arr.tolist(), model=backend.model_id, dim=backend.dim)
