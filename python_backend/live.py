"""
Meet Ninja - Live transcription + translation pipeline.

Endpoint: WebSocket /live/ws

Protocolo:
  - Al conectarse, el cliente envia un JSON de control con la configuracion:
    { "type": "config", "source_lang": "en", "target_lang": "es",
      "whisper_model": "small" }
  - Despues envia mensajes binarios con audio PCM (Int16, 16kHz, mono).
    Cada mensaje es un chunk de ~2-3 segundos.
  - El servidor responde con JSON:
    { "type": "ready" }                    - config OK, listo para recibir audio
    { "type": "transcript", "text": "...", "language": "en", "is_final": true }
    { "type": "translation", "text": "...", "target_lang": "es", "is_final": true }
    { "type": "error", "message": "..." }
    { "type": "closed" }                    - sesion finalizada

Notas de diseno:
  - Whisper y el LLM son bloqueantes, asi que los corremos en un thread pool
    para no trabar el event loop de asyncio.
  - Si el LLM local no esta listo, devuelve un placeholder para no romper
    la transmision en vivo (la traduccion es "best effort").
  - Mantenemos un buffer de segmentos recientes como contexto para traducciones
    coherentes (pronombre, genero, etc).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("meetninja.live")

router = APIRouter()

SAMPLE_RATE = 16000
# Si el RMS del chunk es menor a esto, lo consideramos silencio y NO lo mandamos
# a Whisper (ahorra tiempo y evita transcripciones de ruido).
SILENCE_RMS_THRESHOLD = 0.005
# Maximo de segmentos recientes a mantener como contexto para traduccion.
CONTEXT_SIZE = 4


@dataclass
class LiveSession:
    session_id: str
    source_lang: str
    target_lang: str
    whisper_model: str = "small"
    recent_texts: list[str] = field(default_factory=list)
    closed: bool = False
    chunks_received: int = 0
    transcripts_emitted: int = 0
    translations_emitted: int = 0


def _audio_chunk_to_text(audio: np.ndarray, lang: str, model_name: str) -> tuple[str, str]:
    """Transcribe un chunk de audio. Bloqueante, llamar en thread pool."""
    from transcriber import get_transcriber
    t0 = time.time()
    tr = get_transcriber(model_name)
    res = tr.transcribe_array(
        audio,
        sample_rate=SAMPLE_RATE,
        language=lang or None,  # type: ignore
        beam_size=1,
        vad_filter=True,
    )
    elapsed = time.time() - t0
    log.info(
        "Live chunk transcrito en %.2fs: %d segmentos, %d chars, lang=%s",
        elapsed, len(res.segments), len(res.text), res.language,
    )
    return res.text.strip(), res.language


def _translate_text(text: str, target_lang: str, context: list[str]) -> str:
    """Traduce un texto. Bloqueante, llamar en thread pool. Best-effort."""
    if not text:
        return ""
    if target_lang == "auto" or not target_lang:
        return text
    try:
        from llm_local import get_llm
        llm = get_llm()
        llm._ensure_ready()
    except Exception as e:
        log.warning("LLM no disponible para traduccion live: %s", e)
        return ""

    # Prompt corto y directo. Sin contexto verbose, queremos velocidad.
    ctx = ""
    if context:
        ctx = "\n".join(f"- {c}" for c in context[-CONTEXT_SIZE:])
    lang_names = {
        "es": "espanol", "en": "English", "pt": "portugues",
        "fr": "frances", "de": "aleman", "it": "italiano",
    }
    target_name = lang_names.get(target_lang.lower(), target_lang)
    system = (
        f"Translate the user's text to {target_name}. "
        "Output ONLY the translation, no quotes, no explanations, no preamble. "
        "Keep the same tone (formal/informal). Use the recent context only for "
        "disambiguating pronouns, do not include it in the output."
    )
    user = (
        (f"Recent context:\n{ctx}\n\n" if ctx else "")
        + f"Text to translate:\n{text}"
    )
    try:
        import httpx
        port = llm.port
        r = httpx.post(
            f"http://127.0.0.1:{port}/v1/chat/completions",
            json={
                "model": "local",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.1,
                "max_tokens": 200,
                "stream": False,
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.warning("LLM devolvio %d en traduccion live", r.status_code)
            return ""
        data = r.json()
        out = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
        return out
    except Exception as e:
        log.warning("Error traduciendo live: %s", e)
        return ""


def _is_silence(audio: np.ndarray) -> bool:
    """True si el RMS del audio es muy bajo (silencio)."""
    if len(audio) == 0:
        return True
    rms = float(np.sqrt(np.mean(audio.astype(np.float32) ** 2)))
    return rms < SILENCE_RMS_THRESHOLD


@router.websocket("/live/ws")
async def live_ws(websocket: WebSocket):
    await websocket.accept()
    session: Optional[LiveSession] = None
    try:
        # Primer mensaje: config JSON
        first = await websocket.receive_text()
        cfg = json.loads(first)
        if cfg.get("type") != "config":
            await websocket.send_json({
                "type": "error",
                "message": "Primer mensaje debe ser {type:'config', ...}",
            })
            await websocket.close()
            return
        session = LiveSession(
            session_id=cfg.get("session_id", "live"),
            source_lang=cfg.get("source_lang", "auto"),
            target_lang=cfg.get("target_lang", "es"),
            whisper_model=cfg.get("whisper_model", "small"),
        )
        log.info(
            "Live session '%s' iniciada: %s -> %s, model=%s",
            session.session_id, session.source_lang, session.target_lang, session.whisper_model,
        )
        await websocket.send_json({"type": "ready", "session_id": session.session_id})

        # Loop: recibir audio binario, procesar, emitir
        while not session.closed:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" not in msg:
                # Mensaje no-binario. Si es "stop", cerramos.
                try:
                    payload = json.loads(msg.get("text", "{}"))
                    if payload.get("type") == "stop":
                        break
                except Exception:
                    pass
                continue
            audio_bytes = msg["bytes"]
            session.chunks_received += 1
            # Int16 -> float32 normalizado
            try:
                audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            except Exception as e:
                log.warning("No se pudo decodificar audio: %s", e)
                continue
            if len(audio) < SAMPLE_RATE * 0:  # placeholder, siempre falso
                pass
            # VAD simple por energy
            if _is_silence(audio):
                # No mandamos transcripcion ni traduccion. Solo seguimos.
                continue
            # 1) Transcribir (en thread pool para no bloquear)
            loop = asyncio.get_running_loop()
            try:
                text, detected_lang = await loop.run_in_executor(
                    None,
                    _audio_chunk_to_text,
                    audio,
                    session.source_lang,
                    session.whisper_model,
                )
            except Exception as e:
                log.exception("Error transcribiendo chunk live")
                await websocket.send_json({"type": "error", "message": f"transcribe: {e}"})
                continue
            if not text:
                continue
            session.transcripts_emitted += 1
            # Si Whisper detecto un idioma distinto al declarado, lo actualizamos.
            if detected_lang and session.source_lang in ("auto", "", None):
                session.source_lang = detected_lang
            await websocket.send_json({
                "type": "transcript",
                "text": text,
                "language": detected_lang or session.source_lang,
                "is_final": True,
                "chunk_index": session.chunks_received,
            })
            session.recent_texts.append(text)
            if len(session.recent_texts) > 10:
                session.recent_texts = session.recent_texts[-10:]
            # 2) Traducir (best effort)
            if session.target_lang and session.target_lang != "auto":
                try:
                    translated = await loop.run_in_executor(
                        None,
                        _translate_text,
                        text,
                        session.target_lang,
                        list(session.recent_texts[:-1]),
                    )
                except Exception as e:
                    log.warning("Error traduciendo: %s", e)
                    translated = ""
                if translated:
                    session.translations_emitted += 1
                    await websocket.send_json({
                        "type": "translation",
                        "text": translated,
                        "target_lang": session.target_lang,
                        "is_final": True,
                    })
    except WebSocketDisconnect:
        log.info("Cliente desconecto del live websocket")
    except Exception as e:
        log.exception("Error en live websocket")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if session:
            session.closed = True
            log.info(
                "Live session '%s' cerrada: chunks=%d, transcripts=%d, translations=%d",
                session.session_id,
                session.chunks_received,
                session.transcripts_emitted,
                session.translations_emitted,
            )
            try:
                await websocket.send_json({"type": "closed"})
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass
