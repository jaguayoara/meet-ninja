"""
Meet Ninja - Busqueda de palabras clave en transcripciones.

Pensado para el caso de uso del user: un policia buscando terminos
especificos en una escucha telefonica, o un abogado buscando delitos,
o cualquiera que tenga una lista de palabras y quiera ver cada match
con su contexto.

- Acepta 1 o varios terminos.
- Modo 'any' (cualquiera) o 'all' (todos). Default 'any'.
- Case-insensitive y acento-insensitive (busca 'delito' y encuentra 'delitos', 'delito', 'DELITO').
- Devuelve lista de matches con timestamp, frase donde aparece y un
  snippet con contexto (N caracteres antes y despues).
- Permite exportar la lista de matches.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict
from typing import Iterable

from transcriber import Segment


@dataclass
class Match:
    term: str
    segment_index: int
    start: float
    end: float
    snippet: str
    full_segment_text: str

    def to_dict(self) -> dict:
        return asdict(self)


# Tamano del contexto alrededor del match (caracteres).
CONTEXT_CHARS = 80


def _normalize(text: str) -> str:
    """
    Quita acentos y pasa a minusculas para hacer busqueda acento-insensitive.
    'delito' matchea 'delito', 'delitos', 'DELITO'.
    """
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    sin = "".join(c for c in nfkd if not unicodedata.combining(c))
    return sin.lower()


def _make_pattern(terms: Iterable[str], match_all: bool) -> re.Pattern:
    """
    Compila un regex unico con todos los terminos.
    Si match_all=True, exige que TODOS los terminos aparezcan (cada uno
    en alguna parte del segmento). Esto se evalua a posteriori.
    """
    escaped = []
    for t in terms:
        t = (t or "").strip()
        if not t:
            continue
        escaped.append(re.escape(_normalize(t)))
    if not escaped:
        # match nada
        return re.compile(r"(?!)")
    # any: un solo regex con alternancia
    return re.compile("|".join(escaped), flags=re.IGNORECASE)


def _all_terms_present(normalized_segment: str, normalized_terms: list[str]) -> bool:
    return all(t in normalized_segment for t in normalized_terms if t)


def search(
    segments: list[Segment],
    terms: list[str],
    mode: str = "any",
    context_chars: int = CONTEXT_CHARS,
) -> list[Match]:
    """
    Busca `terms` en cada segmento de la transcripcion.

    - terms: lista de palabras o frases. Se buscan acento-insensitive.
    - mode: 'any' (cualquiera matchea) o 'all' (todos deben aparecer en el mismo segmento).
    - context_chars: cuantos caracteres de contexto mostrar alrededor del match.
    """
    if mode not in ("any", "all"):
        raise ValueError("mode debe ser 'any' o 'all'")
    if not segments:
        return []
    if not terms or not [t for t in terms if (t or "").strip()]:
        return []

    clean_terms = [(t or "").strip() for t in terms if (t or "").strip()]
    pattern = _make_pattern(clean_terms, match_all=(mode == "all"))
    normalized_terms = [_normalize(t) for t in clean_terms if _normalize(t)]
    ctx = max(0, int(context_chars))

    matches: list[Match] = []

    for idx, seg in enumerate(segments):
        text = seg.text or ""
        if not text.strip():
            continue
        normalized_text = _normalize(text)

        if mode == "all" and not _all_terms_present(normalized_text, normalized_terms):
            continue

        # Buscar cada ocurrencia del patron en el texto ORIGINAL (para
        # mantener el snippet legible con tildes y mayusculas).
        for m in pattern.finditer(_normalize(text)):
            start_in_orig = m.start()
            end_in_orig = m.end()
            # recuperar el termino original que matcheo
            matched = text[start_in_orig:end_in_orig]
            # construir snippet con contexto
            snip_start = max(0, start_in_orig - ctx)
            snip_end = min(len(text), end_in_orig + ctx)
            prefix = "..." if snip_start > 0 else ""
            suffix = "..." if snip_end < len(text) else ""
            snippet = prefix + text[snip_start:snip_end].strip() + suffix

            # detectar que termino de la lista original es
            for original in clean_terms:
                if _normalize(original) in matched.lower():
                    matches.append(
                        Match(
                            term=original,
                            segment_index=idx,
                            start=seg.start,
                            end=seg.end,
                            snippet=snippet,
                            full_segment_text=text,
                        )
                    )
                    break
    return matches
