"""Backend loader: prefer MLX on Apple Silicon, otherwise sentence-transformers."""
from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import List, Protocol


class Backend(Protocol):
    model_id: str
    dim: int
    def encode(self, texts: List[str]) -> List[List[float]]: ...


@dataclass
class SentenceTransformersBackend:
    model_id: str
    dim: int
    _model: object

    def encode(self, texts: List[str]) -> List[List[float]]:
        return self._model.encode(texts, normalize_embeddings=False).tolist()  # type: ignore[attr-defined]


@dataclass
class MlxBackend:
    model_id: str
    dim: int
    _model: object
    _tokenizer: object

    def encode(self, texts: List[str]) -> List[List[float]]:
        import mlx.core as mx  # type: ignore
        out: List[List[float]] = []
        for t in texts:
            tokens = self._tokenizer.encode(t, return_tensors="np")  # type: ignore[attr-defined]
            x = mx.array(tokens)
            h = self._model(x)  # type: ignore[operator]
            vec = mx.mean(h, axis=1).tolist()[0]
            out.append(vec)
        return out


def load_backend(model_id: str) -> Backend:
    is_apple = platform.system() == "Darwin" and platform.machine() == "arm64"
    if is_apple:
        try:
            return _load_mlx(model_id)
        except Exception:
            pass
    return _load_st(model_id)


def _load_mlx(model_id: str) -> Backend:
    from mlx_lm import load  # type: ignore
    model, tokenizer = load(model_id)
    dim = 384
    return MlxBackend(model_id=model_id, dim=dim, _model=model, _tokenizer=tokenizer)


def _load_st(model_id: str) -> Backend:
    from sentence_transformers import SentenceTransformer
    fallback = "sentence-transformers/all-MiniLM-L6-v2"
    model_name = model_id if "/" in model_id and "mlx" not in model_id else fallback
    model = SentenceTransformer(model_name)
    dim = model.get_sentence_embedding_dimension() or 384
    return SentenceTransformersBackend(model_id=model_name, dim=dim, _model=model)
