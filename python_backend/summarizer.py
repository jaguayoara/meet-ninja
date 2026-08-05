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

import asyncio
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
# Por defecto NO pedimos un modelo grande porque en PCs de oficina sin GPU
# son inutilizables. El usuario puede sobreescribir via env var.
OLLAMA_MODEL = os.environ.get("MEETNINJA_OLLAMA_MODEL", "llama3.2:3b")
# Tope maximo de parametros del modelo (en miles de millones) que vamos
# a usar automaticamente. Por default 4B - en CPU sin GPU dedicada,
# modelos mas grandes son lentisimos (minutos por respuesta, swap a disco).
# Si el usuario quiere usar un modelo mas grande (tiene GPU, mucha RAM),
# puede subirlo via MEETNINJA_MAX_MODEL_B=12 o similar.
try:
    MAX_MODEL_B = float(os.environ.get("MEETNINJA_MAX_MODEL_B", "4"))
except ValueError:
    MAX_MODEL_B = 4.0
# Si es True, permite usar modelos que exceden MAX_MODEL_B (queda a criterio
# del usuario). Por default False para no degradar UX en PCs debiles.
ALLOW_OVERSIZE = os.environ.get("MEETNINJA_ALLOW_OVERSIZE", "0") in ("1", "true", "yes")
# Modelos a probar en orden si el preferido no esta. Priorizamos modelos
# CHICOS (1-3B) que corren rapido en CPU. Los grandes quedan como ultimo
# recurso y solo si no hay nada chico.
FALLBACK_MODELS = [
    # primera linea: modelos chicos (rapidos en CPU)
    "llama3.2:3b",
    "qwen2.5:3b",
    "gemma3:4b",
    "phi3:mini",
    "llama3.2:1b",
    "qwen2.5:1.5b",
    "gemma3:1b",
    "qwen3:1.7b",
    "qwen3.5:0.8b",
    "tinyllama:1.1b",
    # segunda linea: medianos (pasan el cap, pero tolerables en CPU buena)
    "mistral:7b",
    "llama3.1:8b",
    "qwen2.5:7b",
    # tercera linea: grandes (se evitan salvo que no haya otra cosa Y
    # el usuario habilito ALLOW_OVERSIZE)
    "gemma4:12b",
    "gemma2:9b",
    "qwen3:8b",
]


def _is_generative_model(name: str) -> bool:
    """Heuristica: descarta modelos de embeddings y otros no generativos."""
    n = name.lower()
    return not any(skip in n for skip in ("embed", "nomic-embed", "bge-", "minilm", "mpnet"))


def _parse_model_size_b(name: str) -> float | None:
    """
    Devuelve el tamano aproximado en miles de millones de parametros
    extraido del nombre del modelo ollama. Ej: "gemma4:12b" -> 12.0,
    "qwen3.5:0.8b" -> 0.8, "llama3.1:8b" -> 8.0. None si no se puede.
    """
    import re
    m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", name.lower())
    if m:
        return float(m.group(1))
    return None


def _is_oversize(name: str) -> bool:
    """
    True si el modelo excede el cap MAX_MODEL_B. Si el tamano no se puede
    inferir del nombre (ej "gemma4:latest"), se considera oversize por
    default para ser conservadores. El usuario puede forzar via
    MEETNINJA_ALLOW_OVERSIZE=1 si sabe lo que hace.
    """
    size = _parse_model_size_b(name)
    if size is None:
        return True
    return size > MAX_MODEL_B
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


async def _ollama_generate(prompt: str) -> tuple[Optional[str], Optional[str], str | None]:
    """
    Intenta generar con el modelo preferido; si no esta, prueba los FALLBACK_MODELS.
    Descarta modelos de embeddings (no son generativos).
    Si ninguno conocido responde, prueba el resto de modelos instalados en
    orden de tamano (mas GRANDE primero: prefiere el mas capaz que respete
    el cap de MAX_MODEL_B; si todo es oversize, usa el mas chico como
    ultimo recurso).
    Respeta MAX_MODEL_B: modelos mas grandes se evitan salvo ALLOW_OVERSIZE.
    Devuelve (respuesta, modelo_usado, warning) o (None, None, warning).
    """
    installed = set(await _ollama_list_models())
    # filtrar modelos no generativos
    installed = {m for m in installed if _is_generative_model(m)}
    if not installed:
        return None, None, None

    # separar modelos en "dentro del cap" y "sobre el cap"
    in_cap: list[str] = []
    oversize: list[str] = []
    for m in installed:
        if _is_oversize(m):
            oversize.append(m)
        else:
            in_cap.append(m)

    warning: str | None = None
    if oversize and not ALLOW_OVERSIZE:
        # loguear los modelos que estamos ignorando
        nombres = ", ".join(f"{m} ({_parse_model_size_b(m) or '?'}B)" for m in oversize)
        log.warning(
            "Modelos ignorados por exceder MAX_MODEL_B=%.1f (usar MEETNINJA_ALLOW_OVERSIZE=1 para forzar): %s",
            MAX_MODEL_B, nombres,
        )
        warning = (
            f"{len(oversize)} modelo(s) instalado(s) ignorado(s) por exceder el cap de "
            f"{MAX_MODEL_B:.0f}B (configurable con MEETNINJA_MAX_MODEL_B). "
            f"En PC de oficina sin GPU, modelos grandes son muy lentos. "
            f"Para forzar: MEETNINJA_ALLOW_OVERSIZE=1"
        )

    pool = in_cap if in_cap else (oversize if ALLOW_OVERSIZE else [])

    # construir lista priorizada de candidatos
    candidates: list[str] = []
    if OLLAMA_MODEL in pool:
        candidates.append(OLLAMA_MODEL)
    for m in FALLBACK_MODELS:
        if m in pool and m not in candidates:
            candidates.append(m)
    # agregar el resto del pool, ordenados por tamano (GRANDE primero,
    # para preferir el modelo mas capaz disponible que respete el cap)
    def size_key(n: str) -> float:
        s = _parse_model_size_b(n)
        return s if s is not None else 0.0
    for m in sorted(pool, key=size_key, reverse=True):
        if m not in candidates:
            candidates.append(m)

    # si no hay candidatos (pool vacio porque solo habia oversize y no
    # permitimos oversized), avisar y caer al mas chico de los oversize
    # como ultimo recurso, igualmente
    if not candidates and oversize:
        chosen = min(oversize, key=size_key)
        log.warning(
            "No hay modelos <= %.1fB. Usando '%s' (%.1fB) como ultimo recurso. "
            "Configura MEETNINJA_MAX_MODEL_B mas alto o instala un modelo mas chico.",
            MAX_MODEL_B, chosen, _parse_model_size_b(chosen) or 0,
        )
        warning = (
            f"Solo hay modelos grandes instalados. Usando '{chosen}' por defecto "
            f"puede ser muy lento en CPU. Considera instalar uno mas chico "
            f"(ej `ollama pull llama3.2:3b` o `qwen2.5:1.5b`)."
        )
        candidates = [chosen]

    for m in candidates:
        out = await _ollama_generate_with_model(prompt, m)
        # string vacio cuenta como fallo
        if out and out.strip():
            return out, m, warning
        log.info("Modelo '%s' devolvio respuesta vacia o fallo, probando el siguiente", m)
    return None, None, warning


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

async def summarize(transcript: str, mode: str, language: str | None = None) -> dict:
    """
    Resume `transcript` en el modo pedido.

    Orden de prioridad:
    1. LLM local embebido (llama.cpp + GGUF). Si esta disponible y responde,
       se usa esto. No requiere servicios externos.
    2. Ollama (opcional, si el usuario lo tiene instalado y la red esta ok).
    3. Resumen extractivo (sin LLM). Siempre funciona, menor calidad.

    Si `language` esta definido, se agrega una instruccion al final del
    prompt para que el resumen salga en ese idioma.
    """
    if mode not in PROMPTS:
        raise ValueError(f"Modo invalido: {mode}. Validos: {list(PROMPTS)}")
    transcript = (transcript or "").strip()
    if not transcript:
        raise ValueError("Transcripcion vacia")

    base_prompt = PROMPTS[mode].format(transcript=transcript[:12000])  # limite de contexto
    if language:
        _LANG_NAMES = {
            "es": "espanol",
            "en": "English",
            "pt": "portugues",
            "fr": "frances",
            "de": "aleman",
            "it": "italiano",
        }
        lang_name = _LANG_NAMES.get(language.lower(), language)
        prompt = (
            base_prompt
            + f"\n\nIMPORTANTE: Responde todo el resumen en {lang_name}. "
            + "Los nombres propios y terminos tecnicos que aparezcan en la transcripcion se mantienen tal cual, "
            + "pero todo el texto generado (titulos, descripciones, resumen corto) debe estar en "
            + f"{lang_name}."
        )
    else:
        prompt = base_prompt
    warning: str | None = None

    # 1) LLM local embebido (preferido, no requiere nada externo)
    try:
        from llm_local import get_llm, is_available
        if is_available() or os.environ.get("MEETNINJA_LLM_AUTO_DOWNLOAD", "1") == "1":
            llm = get_llm()
            log.info("Probando LLM local embebido...")
            try:
                raw = await asyncio.to_thread(llm.generate, prompt, max_tokens=1024, temperature=0.2, timeout=180)
                parsed = _parse_llm_json(raw) if raw else None
                if parsed:
                    from llm_local import MODEL_REPO, MODEL_FILE
                    parsed["_metodo"] = "llm_local"
                    parsed["_modelo"] = f"{MODEL_REPO}/{MODEL_FILE}"
                    parsed["_modelo_b"] = _parse_model_size_b(MODEL_FILE)
                    if warning:
                        parsed["_warning"] = warning
                    return parsed
                log.info("LLM local devolvio algo no parseable, probando ollama...")
            except Exception as e:
                log.warning("LLM local fallo: %s", e)
    except ImportError:
        # modulo no disponible, seguir con ollama/extractivo
        pass

    # 2) Ollama (opcional)
    raw, model_used, warning = await _ollama_generate(prompt)
    parsed = _parse_llm_json(raw) if raw else None
    if parsed:
        parsed["_metodo"] = "ollama"
        parsed["_modelo"] = model_used or OLLAMA_MODEL
        parsed["_modelo_b"] = _parse_model_size_b(model_used or "")
        if warning:
            parsed["_warning"] = warning
        return parsed
    # fallback
    log.info("Usando resumen extractivo (ollama no disponible o JSON invalido)")
    result = _extractive_summarize(transcript, mode)
    if warning:
        result["_warning"] = warning
    return result


async def ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            return r.status_code == 200
    except Exception:
        return False
