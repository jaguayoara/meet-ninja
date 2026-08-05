"""
Meet Ninja - Resumen / analisis con LLM local (ollama) o extractivo.

3 modos:
- reunion: minuta con temas, decisiones, tareas, fechas.
- estudio: resumen educativo con conceptos clave y preguntas.
- conversacion: mapa de hablantes (turnos) y tono general.

Si ollama esta corriendo y el modelo configurado esta disponible, lo usa.
Si no, hace resumen extractivo con numpy (top frases por score, keywords
por frecuencia). Asi la app siempre devuelve algo util.
"""
from __future__ import annotations

import logging
import os
import re
from collections import Counter
from typing import Optional

import httpx
import numpy as np

log = logging.getLogger("meetninja.summarizer")

OLLAMA_URL = os.environ.get("MEETNINJA_OLLAMA_URL", "http://127.0.0.1:11434")
# Modelo preferido. Si no esta, probamos los de FALLBACK_MODELS.
OLLAMA_MODEL = os.environ.get("MEETNINJA_OLLAMA_MODEL", "llama3.1:8b")
# Modelos a probar en orden si el preferido no esta. Abarca los mas comunes.
FALLBACK_MODELS = [
    "llama3.1:8b",
    "llama3:8b",
    "llama3.2:3b",
    "qwen2.5:7b",
    "qwen3:8b",
    "mistral:7b",
    "gemma2:9b",
    "gemma3:4b",
    "phi3:medium",
]


def _is_generative_model(name: str) -> bool:
    """Heuristica: descarta modelos de embeddings y otros no generativos."""
    n = name.lower()
    return not any(skip in n for skip in ("embed", "nomic-embed", "bge-", "minilm", "mpnet"))
OLLAMA_TIMEOUT = float(os.environ.get("MEETNINJA_OLLAMA_TIMEOUT", "120"))


# Stopwords basicas en espanol. Filtramos para que las keywords no sean
# puramente funcionales ("el", "la", "y", "que"...).
STOPWORDS_ES = set(
    """
    a al algo algunas algunos ante antes como con contra cual cuando de del desde
    donde durante e el ella ellas ellos en entre era eran eres es esa esas ese eso
    esos esta estaba estado estar este esto estos fue fueran fueran ha haber habia
    han has hasta hay haya he hemos hoy hubo la las le les lo los mas me mi mis
    mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco
    por porque que quien se sea sean seamos sean seas segun ser si sido siempre
    siendo sin sobre sois somos son soy su sus tambien tan te tendra tendran tener
    tengo tiempo tiene tienen toda todas todavia todo todos tras tu tus un una
    unas uno unos va vamos van vaya veces ver visto voy y ya yo el
    """.split()
)


# --------------------------------------------------------------------
# Prompts por modo. Espanol, optimizados para un modelo chico (8B).
# --------------------------------------------------------------------
PROMPTS = {
    "reunion": """Eres un asistente que redacta minutas de reunion en espanol.
A partir de la transcripcion, devuelve un JSON estricto con esta estructura:

{{
  "asistentes": ["nombre1", "nombre2", ...],
  "temas": ["tema principal 1", "tema principal 2", ...],
  "decisiones": ["decision 1", "decision 2", ...],
  "tareas": [{{"responsable": "nombre o vacio", "tarea": "descripcion", "fecha": "YYYY-MM-DD o vacio"}}],
  "fechas_clave": ["YYYY-MM-DD o referencia temporal"],
  "resumen_corto": "Resumen ejecutivo de max 3 lineas"
}}

Reglas:
- Si no puedes detectar algo, devuelve lista vacia o string vacio. No inventes.
- Nombres: usa los que aparezcan en la transcripcion. Si no hay nombres, no inventes.
- Devuelve SOLO el JSON, sin texto antes ni despues, sin bloques de codigo.

Transcripcion:
\"\"\"
{transcript}
\"\"\"
""",
    "estudio": """Eres un asistente que ayuda a estudiar a partir de una clase grabada.
A partir de la transcripcion, devuelve un JSON estricto con esta estructura:

{{
  "conceptos_clave": ["concepto 1", "concepto 2", ...],
  "definiciones": [{{"termino": "X", "definicion": "Y"}}],
  "resumen_por_bloque": ["parrafo 1", "parrafo 2", ...],
  "preguntas_probables": ["pregunta que podria caer en un examen 1", ...],
  "resumen_corto": "Resumen ejecutivo de max 3 lineas"
}}

Reglas:
- Solo incluye lo que realmente se mencione en la transcripcion.
- Las definiciones deben ser textuales o muy cercanas, no inventes.
- Devuelve SOLO el JSON, sin texto antes ni despues, sin bloques de codigo.

Transcripcion:
\"\"\"
{transcript}
\"\"\"
""",
    "conversacion": """Eres un asistente que analiza conversaciones.
A partir de la transcripcion, devuelve un JSON estricto con esta estructura:

{{
  "hablantes_estimados": [
    {{"id": "Hablante 1", "intervenciones": 5, "palabras_aprox": 120}}
  ],
  "tono_general": "descripcion breve del tono (formal, informal, tenso, etc.)",
  "momentos_clave": ["momento 1: que ocurrio", "momento 2: que ocurrio", ...],
  "temas_principales": ["tema 1", "tema 2", ...],
  "resumen_corto": "Resumen ejecutivo de max 3 lineas"
}}

Reglas:
- Como no hay diarizacion real, estima hablantes por turnos (cambios de orador).
- No inventes hablantes con nombres propios si no aparecen.
- Devuelve SOLO el JSON, sin texto antes ni despues, sin bloques de codigo.

Transcripcion:
\"\"\"
{transcript}
\"\"\"
""",
}


# --------------------------------------------------------------------
# Resumen extractivo (fallback sin LLM). Funciona siempre.
# --------------------------------------------------------------------

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿])")


def _split_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    parts = _SENT_SPLIT.split(text)
    return [p.strip() for p in parts if len(p.strip()) > 10]


def _tokenize(text: str) -> list[str]:
    text = text.lower()
    # solo letras y numeros, tildes incluidas
    text = re.sub(r"[^a-z0-9áéíóúüñ\s]+", " ", text)
    return [w for w in text.split() if w and w not in STOPWORDS_ES and len(w) > 2]


def _score_sentences(sentences: list[str], top_k: int = 8) -> list[tuple[int, float, str]]:
    """Score por frecuencia de palabras (TextRank simplificado)."""
    tokens = [_tokenize(s) for s in sentences]
    if not any(tokens):
        return [(i, 0.0, s) for i, s in enumerate(sentences)]
    # frecuencias globales
    counter: Counter[str] = Counter()
    for ts in tokens:
        counter.update(set(ts))  # set para no sobreponderar repeticion
    # score por oracion
    scored: list[tuple[int, float, str]] = []
    for i, ts in enumerate(tokens):
        if not ts:
            scored.append((i, 0.0, sentences[i]))
            continue
        # normalizar por largo para no premiar frases larguisimas
        s = sum(counter[t] for t in ts) / (len(ts) ** 0.5)
        scored.append((i, s, sentences[i]))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def _keywords(text: str, top_k: int = 12) -> list[str]:
    toks = _tokenize(text)
    if not toks:
        return []
    return [w for w, _ in Counter(toks).most_common(top_k)]


def _short_summary(sentences_top: list[tuple[int, float, str]], max_chars: int = 500) -> str:
    """Une las top frases en orden original, cortando por max_chars."""
    sentences_top.sort(key=lambda x: x[0])  # restaurar orden
    out = []
    total = 0
    for _, _, s in sentences_top:
        if total + len(s) + 1 > max_chars:
            break
        out.append(s)
        total += len(s) + 1
    return " ".join(out).strip()


def _extractive_summarize(text: str, mode: str) -> dict:
    """Resumen extractivo. Devuelve un dict con la misma forma que el LLM."""
    sentences = _split_sentences(text)
    top = _score_sentences(sentences, top_k=8)
    keywords = _keywords(text, top_k=12)
    short = _short_summary(top, max_chars=500)

    if mode == "reunion":
        return {
            "asistentes": [],
            "temas": keywords[:6],
            "decisiones": [],
            "tareas": [],
            "fechas_clave": _extract_dates(text),
            "resumen_corto": short,
            "_metodo": "extractivo",
        }
    if mode == "estudio":
        return {
            "conceptos_clave": keywords[:8],
            "definiciones": [],
            "resumen_por_bloque": [s for _, _, s in sorted(top, key=lambda x: x[0])],
            "preguntas_probables": _generate_questions_from_keywords(keywords[:6]),
            "resumen_corto": short,
            "_metodo": "extractivo",
        }
    # conversacion
    hablantes = _estimate_speakers(text)
    return {
        "hablantes_estimados": hablantes,
        "tono_general": _guess_tone(text),
        "momentos_clave": [s for _, _, s in sorted(top[:5], key=lambda x: x[0])],
        "temas_principales": keywords[:6],
        "resumen_corto": short,
        "_metodo": "extractivo",
    }


_DATE_PATTERNS = [
    re.compile(r"\b(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})\b"),
    re.compile(r"\b(\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?)\b", re.IGNORECASE),
]


def _extract_dates(text: str) -> list[str]:
    seen: list[str] = []
    for pat in _DATE_PATTERNS:
        for m in pat.findall(text):
            if m not in seen:
                seen.append(m)
    return seen[:10]


def _estimate_speakers(text: str) -> list[dict]:
    """
    Sin diarizacion real, estimamos hablantes por cambios de turno
    (oraciones que empiezan con marcadores tipo "yo creo que", "a mi me parece",
    "bueno", "mira", o preguntas). Devuelve entre 1 y 4 hablantes estimados.
    """
    sentences = _split_sentences(text)
    if not sentences:
        return []

    # Heuristica: detectar cambios de turno por marcadores conversacionales
    markers = (
        "yo creo", "a mi me", "bueno", "mira", "escuche", "fijate",
        "te cuento", "a ver", "eh", "este", "pues", "entonces",
        "por otro lado", "sin embargo", "disculpa", "espera",
    )
    turns = 1
    for s in sentences:
        sl = s.lower()
        if any(sl.startswith(m) for m in markers) or sl.endswith("?"):
            turns += 1
    n_speakers = max(1, min(4, turns // 3 + 1))
    # repartir palabras aprox
    words = text.split()
    per = max(1, len(words) // n_speakers)
    return [
        {"id": f"Hablante {i + 1}", "intervenciones": 0, "palabras_aprox": per}
        for i in range(n_speakers)
    ]


def _guess_tone(text: str) -> str:
    text_l = text.lower()
    if any(w in text_l for w in ("por favor", "estimado", "cordialmente", "atentamente")):
        return "Formal"
    if any(w in text_l for w in ("jaja", "che", "boludo", "weon", "cachai")):
        return "Informal"
    if any(w in text_l for w in ("problema", "urgente", "error", "no funciona", "reclamo")):
        return "Tenso / problematico"
    if any(w in text_l for w in ("genial", "excelente", "perfecto", "gracias", "buenisimo")):
        return "Positivo / cooperativo"
    return "Neutral / informativo"


def _generate_questions_from_keywords(keywords: list[str]) -> list[str]:
    return [f"Que es {kw}?" for kw in keywords]


# --------------------------------------------------------------------
# LLM via ollama
# --------------------------------------------------------------------

async def _ollama_list_models() -> list[str]:
    """Devuelve la lista de modelos instalados en ollama, vacia si falla."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code != 200:
                return []
            data = r.json()
            return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception:
        return []


async def _ollama_generate_with_model(prompt: str, model: str) -> Optional[str]:
    """Llama a ollama /api/generate con un modelo concreto. None si falla."""
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.2},
                },
            )
            if r.status_code == 404:
                log.info("Modelo ollama '%s' no disponible", model)
                return None
            if r.status_code != 200:
                log.warning("ollama respondio %d con modelo '%s': %s", r.status_code, model, r.text[:200])
                return None
            data = r.json()
            return (data.get("response") or "").strip()
    except Exception as e:
        log.warning("ollama no disponible con modelo '%s': %s", model, e)
        return None


async def _ollama_generate(prompt: str) -> tuple[Optional[str], Optional[str]]:
    """
    Intenta generar con el modelo preferido; si no esta, prueba los FALLBACK_MODELS.
    Descarta modelos de embeddings (no son generativos).
    Si ninguno conocido responde, prueba el resto de modelos instalados en
    orden de tamano (mas chico primero).
    Devuelve (respuesta, modelo_usado) o (None, None) si nada funciono.
    """
    installed = set(await _ollama_list_models())
    # filtrar modelos no generativos
    installed = {m for m in installed if _is_generative_model(m)}
    if not installed:
        return None, None

    # construir lista priorizada de candidatos
    candidates: list[str] = []
    if OLLAMA_MODEL in installed:
        candidates.append(OLLAMA_MODEL)
    for m in FALLBACK_MODELS:
        if m in installed and m not in candidates:
            candidates.append(m)
    # agregar el resto de instalados, ordenados por tamano (chico primero)
    if installed:
        def size_key(n: str) -> int:
            import re
            mm = re.search(r"(\d+(?:\.\d+)?)b", n.lower())
            return int(float(mm.group(1)) * 10) if mm else 9999
        for m in sorted(installed, key=size_key):
            if m not in candidates:
                candidates.append(m)

    for m in candidates:
        out = await _ollama_generate_with_model(prompt, m)
        # string vacio cuenta como fallo
        if out and out.strip():
            return out, m
        log.info("Modelo '%s' devolvio respuesta vacia o fallo, probando el siguiente", m)
    return None, None


def _parse_llm_json(raw: str) -> Optional[dict]:
    """Intenta sacar un JSON valido aunque el modelo haya envuelto en fences."""
    if not raw:
        return None
    # quitar fences ```json ... ```
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    # buscar primer { y ultimo }
    i = s.find("{")
    j = s.rfind("}")
    if i == -1 or j == -1 or j <= i:
        return None
    candidate = s[i : j + 1]
    try:
        import json
        return json.loads(candidate)
    except Exception as e:
        log.warning("No se pudo parsear JSON del LLM: %s", e)
        log.debug("Contenido recibido: %s", candidate[:500])
        return None


# --------------------------------------------------------------------
# API publica
# --------------------------------------------------------------------

async def summarize(transcript: str, mode: str) -> dict:
    """
    Resume `transcript` en el modo pedido.
    Intenta ollama primero; si falla (no esta, no responde, JSON invalido),
    cae a resumen extractivo.
    """
    if mode not in PROMPTS:
        raise ValueError(f"Modo invalido: {mode}. Validos: {list(PROMPTS)}")
    transcript = (transcript or "").strip()
    if not transcript:
        raise ValueError("Transcripcion vacia")

    prompt = PROMPTS[mode].format(transcript=transcript[:12000])  # limite de contexto
    raw, model_used = await _ollama_generate(prompt)
    parsed = _parse_llm_json(raw) if raw else None
    if parsed:
        parsed["_metodo"] = "ollama"
        parsed["_modelo"] = model_used or OLLAMA_MODEL
        return parsed
    # fallback
    log.info("Usando resumen extractivo (ollama no disponible o JSON invalido)")
    return _extractive_summarize(transcript, mode)


async def ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            return r.status_code == 200
    except Exception:
        return False
