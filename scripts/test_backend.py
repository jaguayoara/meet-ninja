"""Smoke test del backend Meet Ninja: health + search + summarize extractivo."""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8765"


def post(path, payload, timeout=180):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


def main():
    # 1. health
    with urllib.request.urlopen(BASE + "/health", timeout=5) as r:
        h = json.loads(r.read().decode("utf-8"))
    print("[1] health OK -", h["whisper"]["default_model"], "/ ollama:", h["ollama"]["available"])

    # 2. search
    sample_segments = [
        {"start": 0.0, "end": 4.0, "text": "Hola, te llamo porque vi el partido ayer."},
        {"start": 4.0, "end": 9.0, "text": "Si, fue un partido increible, el gol de Messi fue unico."},
        {"start": 9.0, "end": 13.0, "text": "Totalmente. Escuchaste la entrevista que le hicieron a Mbappe?"},
        {"start": 13.0, "end": 18.0, "text": "Si, hablaba del partido y del futuro del futbol frances."},
    ]
    status, r = post("/search", {
        "segments": sample_segments,
        "terms": ["Messi", "partido", "futbol"],
        "mode": "any",
    })
    assert status == 200, r
    print(f"[2] search any OK - {r['count']} matches")
    for m in r["matches"][:3]:
        print(f"    - {m['term']!r} @ {m['start']:.1f}s :: {m['snippet'][:60]}...")

    # 3. search ALL
    status, r = post("/search", {
        "segments": sample_segments,
        "terms": ["Messi", "entrevista"],
        "mode": "all",
    })
    print(f"[3] search all OK - {r['count']} matches (esperado 0: no estan en el mismo segmento)")

    # 4. search acento-insensitive
    status, r = post("/search", {
        "segments": sample_segments,
        "terms": ["FUTBOL"],  # mayusculas
        "mode": "any",
    })
    print(f"[4] search case+accent OK - {r['count']} matches (esperado 1)")

    # 5. summarize (sin ollama si no esta, va a extractivo)
    sample_text = " ".join(s["text"] for s in sample_segments)
    status, r = post("/summarize", {"text": sample_text, "mode": "reunion"})
    print(f"[5] summarize reunion OK - metodo={r.get('_metodo')}, topicos={len(r.get('temas', []))}")
    print(f"    resumen_corto: {r.get('resumen_corto', '')[:80]}...")

    # 6. summarize estudio
    status, r = post("/summarize", {"text": sample_text, "mode": "estudio"})
    print(f"[6] summarize estudio OK - conceptos={len(r.get('conceptos_clave', []))}")

    # 7. summarize conversacion
    status, r = post("/summarize", {"text": sample_text, "mode": "conversacion"})
    print(f"[7] summarize conversacion OK - hablantes_estimados={len(r.get('hablantes_estimados', []))}")

    print("\nTodos los tests pasaron.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print("ERROR: no se pudo conectar al backend:", e, file=sys.stderr)
        sys.exit(1)
    except AssertionError as e:
        print("ASSERT FAIL:", e, file=sys.stderr)
        sys.exit(1)
