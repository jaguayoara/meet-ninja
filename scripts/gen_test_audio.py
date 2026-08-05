"""Genera un audio de prueba con ffmpeg."""
import os
import shutil
import subprocess
import sys

ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    print("ffmpeg no esta en PATH", file=sys.stderr)
    sys.exit(1)

out = os.path.abspath("test_audio.wav")
# 5 segundos de tono 440Hz a 16kHz mono. No es habla pero sirve para
# validar el pipeline de upload + transcripcion.
cmd = [
    ffmpeg, "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=440:duration=5",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    out,
]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print("ffmpeg fallo:", r.stderr, file=sys.stderr)
    sys.exit(1)
print(f"OK: {out} ({os.path.getsize(out)} bytes)")
