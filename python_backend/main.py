"""
Meet Ninja - API FastAPI local.

Sirve en 127.0.0.1:8765 (puerto fijo, no configurable por el usuario para
que Electron siempre sepa donde encontrarlo).

Endpoints:
- GET  /health                  : estado de whisper, ollama, version
- GET  /models                  : modelos whisper disponibles
- POST /transcribe              : recibe audio, devuelve transcripcion
- POST /summarize               : recibe texto + modo, devuelve resumen
- POST /search                  : recibe texto/segmentos + terminos, devuelve matches

El audio se guarda en una carpeta temporal y se borra despues de transcribir.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from summarizer import (
    OLLAMA_MODEL,
    OLLAMA_URL,
    MAX_MODEL_B,
    ALLOW_OVERSIZE,
    ollama_available,
    summarize,
)
from transcriber import DEFAULT_MODEL, VALID_MODELS, get_transcriber
from searcher import search

# --------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------
logging.basicConfig(
    level=os.environ.get("MEETNINJA_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("meetninja")

# --------------------------------------------------------------------
# App
# --------------------------------------------------------------------
app = FastAPI(title="Meet Ninja API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # solo se accede desde localhost
    allow_methods=["*"],
    allow_headers=["*"],
)

# Carpeta temporal para audios subidos. Se limpian al transcribir.
TMP_DIR = Path(tempfile.gettempdir()) / "meetninja"
TMP_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------
class SummarizeRequest(BaseModel):
    text: str
    mode: str  # 'reunion' | 'estudio' | 'conversacion'


class SearchRequest(BaseModel):
    segments: list[dict]  # [{start, end, text}, ...]
    terms: list[str]
    mode: str = "any"  # 'any' | 'all'
    context_chars: int = 80


class ChatRequest(BaseModel):
    transcript: str
    question: str
    history: list[dict] = []  # [{role: "user"|"assistant", content: str}, ...]


# --------------------------------------------------------------------
# Rutas
# --------------------------------------------------------------------
@app.get("/")
def root():
    return {
        "name": "Meet Ninja API",
        "version": "0.1.0",
        "endpoints": ["/health", "/models", "/transcribe", "/summarize", "/search", "/chat"],
    }


@app.get("/health")
async def health():
    """Chequeo de servicios. La UI lo usa para mostrar estado."""
    ollama_ok = await ollama_available()
    ollama_model = OLLAMA_MODEL
    if ollama_ok:
        from summarizer import _ollama_list_models, _is_generative_model, FALLBACK_MODELS
        installed = await _ollama_list_models()
        installed = {m for m in installed if _is_generative_model(m)}
        if installed:
            if OLLAMA_MODEL in installed:
                ollama_model = OLLAMA_MODEL
            else:
                chosen = next((m for m in FALLBACK_MODELS if m in installed), None)
                if chosen:
                    ollama_model = chosen
                else:
                    # el mas chico disponible
                    import re
                    def size_key(n: str) -> int:
                        mm = re.search(r"(\d+(?:\.\d+)?)b", n.lower())
                        return int(float(mm.group(1)) * 10) if mm else 9999
                    ollama_model = min(installed, key=size_key)
    return {
        "ok": True,
        "whisper": {
            "default_model": DEFAULT_MODEL,
            "available_models": list(VALID_MODELS),
        },
        "llm_local": _llm_local_status(),
        "ollama": {
            "available": ollama_ok,
            "url": OLLAMA_URL,
            "model": ollama_model,
            "max_model_b": MAX_MODEL_B,
            "allow_oversize": ALLOW_OVERSIZE,
        },
        "ffmpeg": _which("ffmpeg"),
        "python": sys.version.split()[0],
    }


def _llm_local_status() -> dict:
    """Status del LLM local embebido (no rompe si el modulo no esta)."""
    try:
        from llm_local import status
        return status()
    except Exception as e:
        return {"enabled": False, "error": str(e)[:200]}


@app.get("/models")
def models():
    return {"valid_models": list(VALID_MODELS), "default": DEFAULT_MODEL}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: str = Form("es"),
    beam_size: int = Form(5),
):
    """
    Recibe un audio, lo guarda temporalmente, lo transcribe y devuelve
    los segmentos con timestamps + el texto completo.
    """
    if model not in VALID_MODELS:
        raise HTTPException(
            400, f"Modelo invalido. Validos: {list(VALID_MODELS)}"
        )

    # leer y guardar
    suffix = Path(file.filename or "").suffix.lower() or ".wav"
    if suffix not in {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm", ".mp4", ".aac"}:
        raise HTTPException(400, f"Formato de audio no soportado: {suffix}")

    fid = uuid.uuid4().hex[:12]
    saved_path = TMP_DIR / f"{fid}{suffix}"

    log.info("Recibido audio '%s' (modelo=%s)", file.filename, model)
    t0 = time.time()
    with saved_path.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    try:
        if saved_path.stat().st_size == 0:
            raise HTTPException(400, "Archivo de audio vacio")

        transcriber = get_transcriber(model_name=model)
        lang = (language or "").strip() or None
        result = transcriber.transcribe(
            saved_path, language=lang, beam_size=beam_size, vad_filter=True
        )
        log.info("Transcripcion OK en %.1fs", time.time() - t0)
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Error en transcripcion")
        raise HTTPException(500, f"Error transcribiendo: {e}")
    finally:
        # limpiar
        try:
            saved_path.unlink(missing_ok=True)
        except OSError:
            pass


@app.post("/summarize")
async def summarize_endpoint(req: SummarizeRequest):
    try:
        result = await summarize(req.text, req.mode)
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("Error en summarize")
        raise HTTPException(500, f"Error resumiendo: {e}")


@app.post("/search")
async def search_endpoint(req: SearchRequest):
    try:
        from searcher import Segment
        segs = [Segment(start=float(s["start"]), end=float(s["end"]), text=s["text"]) for s in req.segments]
        matches = search(segs, req.terms, mode=req.mode, context_chars=req.context_chars)
        return {"ok": True, "matches": [m.to_dict() for m in matches], "count": len(matches)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("Error en search")
        raise HTTPException(500, f"Error buscando: {e}")


@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """
    RAG basico: responde preguntas del usuario sobre la transcripcion.
    Usa el LLM local embebido (Qwen2.5-1.5B) con la transcripcion
    como system context. Mantiene historial de la conversacion.
    """
    transcript = (req.transcript or "").strip()
    question = (req.question or "").strip()
    if not transcript:
        raise HTTPException(400, "Transcripcion vacia")
    if not question:
        raise HTTPException(400, "Pregunta vacia")

    # System prompt con la transcripcion como contexto
    system = (
        "INSTRUCCIONES ESTRICTAS:\n"
        "- Tu unica fuente de informacion es la transcripcion entre comillas triples.\n"
        "- Si la respuesta NO esta en la transcripcion, responde EXACTAMENTE: 'No se encontro en la transcripcion'.\n"
        "- NO uses conocimiento externo. NO inventes datos. NO hagas suposiciones.\n"
        "- Cita textualmente entre comillas cuando menciones algo de la transcripcion.\n"
        "- Responde en espanol, maximo 3-4 oraciones.\n\n"
        "Transcripcion:\n"
        f'"""\n{transcript[:16000]}\n"""'
    )

    # Construir messages con historial
    messages = [{"role": "user", "content": question}]
    # si hay historial previo, lo agregamos
    history_msgs = []
    for h in (req.history or [])[-10:]:  # ultimos 10 mensajes
        role = h.get("role")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            history_msgs.append({"role": role, "content": content[:2000]})

    try:
        from llm_local import get_llm
        llm = get_llm()
        # asegura que el server local este corriendo (lazy: arranca si no)
        llm._ensure_ready()
        log.info("Chat: pregunta=%d chars, historial=%d msgs", len(question), len(history_msgs))

        # si hay historial, lo metemos en una sola llamada con mensajes
        # sino, llamada simple con system+user
        import asyncio
        if history_msgs:
            full_messages = history_msgs + messages
            # mandamos todo como un solo prompt al LLM (sin system)
            # el system ya va por separado
            # el endpoint /v1/chat/completions acepta messages con role system
            response = await asyncio.to_thread(
                _llm_chat_with_messages, llm, system, full_messages, 512
            )
        else:
            response = await asyncio.to_thread(
                _llm_chat_simple, llm, system, question, 512
            )
        return {"ok": True, "answer": response.strip()}
    except Exception as e:
        log.exception("Error en chat")
        raise HTTPException(500, f"Error en chat: {e}")


def _llm_chat_simple(llm, system: str, user: str, max_tokens: int) -> str:
    """Llamada simple al LLM con system + user prompt."""
    # usamos el endpoint /v1/chat/completions directamente via httpx
    import httpx
    port = llm._port
    with httpx.Client(timeout=180.0) as client:
        r = client.post(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            json={
                "model": "local",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "stream": False,
            },
        )
    if r.status_code != 200:
        raise RuntimeError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
    return r.json()["choices"][0]["message"]["content"]


def _llm_chat_with_messages(llm, system: str, messages: list, max_tokens: int) -> str:
    """Llamada al LLM con system + historial + pregunta actual."""
    import httpx
    port = llm._port
    msgs = [{"role": "system", "content": system}] + messages
    with httpx.Client(timeout=180.0) as client:
        r = client.post(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            json={
                "model": "local",
                "messages": msgs,
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "stream": False,
            },
        )
    if r.status_code != 200:
        raise RuntimeError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
    return r.json()["choices"][0]["message"]["content"]


def _which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------
def main():
    import uvicorn

    port = int(os.environ.get("MEETNINJA_PORT", "8765"))
    host = os.environ.get("MEETNINJA_HOST", "127.0.0.1")
    log.info("Meet Ninja API arrancando en http://%s:%d", host, port)
    print(f"\n  Meet Ninja API - http://{host}:{port}\n", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
