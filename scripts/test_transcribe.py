"""Test end-to-end: subir un audio y transcribirlo."""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8765"
AUDIO = "test_audio.wav"


def main():
    import os
    if not os.path.exists(AUDIO):
        print(f"No existe {AUDIO}", file=sys.stderr)
        sys.exit(1)

    print(f"Subiendo {AUDIO} ({os.path.getsize(AUDIO)} bytes) con modelo 'tiny'...")
    t0 = time.time()
    with open(AUDIO, "rb") as f:
        data = f.read()

    # multipart manual
    boundary = "----MeetNinjaBoundary1234567890"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{AUDIO}"\r\n'
        f"Content-Type: audio/wav\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        f"{BASE}/transcribe",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            result = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)

    print(f"\nOK en {time.time() - t0:.1f}s")
    print(f"  Idioma detectado: {result['language']} ({result['language_probability']:.2f})")
    print(f"  Modelo: {result['model']}")
    print(f"  Duracion: {result['duration']:.1f}s")
    print(f"  Segmentos: {len(result['segments'])}")
    print(f"  Texto (primeros 200 chars): {result['text'][:200]!r}")
    if result['segments']:
        print(f"  Primer segmento: start={result['segments'][0]['start']:.1f}, text={result['segments'][0]['text'][:80]!r}")


if __name__ == "__main__":
    main()
