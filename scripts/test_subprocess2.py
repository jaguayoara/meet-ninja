"""Test con lectura manual de streams."""
import subprocess
import time
import os
import sys

bin_path = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin\llama-cli.exe"
model = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
prompt_file = r"C:\Users\jagua\Desktop\MeetNinja\test_prompt.txt"

print(f"t={time.time():.1f}: Lanzando", flush=True)
t0 = time.time()
# DEVNULL en stdout para no bloquear
p = subprocess.Popen(
    [bin_path, "-m", model, "-f", prompt_file, "-n", "10", "--temp", "0.2",
     "-c", "4096", "-t", "4", "-ngl", "0", "--no-display-prompt", "--no-conversation"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    cwd=r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin",
    bufsize=0,
)
print(f"t={time.time()-t0:.1f}: PID={p.pid}", flush=True)

# leer manualmente
output = b""
start = time.time()
while True:
    if time.time() - start > 90:
        print(f"t={time.time()-t0:.1f}: TIMEOUT, matando", flush=True)
        p.kill()
        break
    chunk = p.stdout.read(1024) if p.stdout else b""
    if chunk:
        output += chunk
        print(f"t={time.time()-t0:.1f}: leido chunk de {len(chunk)} bytes", flush=True)
    if p.poll() is not None:
        # leo el resto
        rest = p.stdout.read() if p.stdout else b""
        output += rest
        print(f"t={time.time()-t0:.1f}: poll termino, exit={p.returncode}, leidos {len(rest)} mas", flush=True)
        break
    time.sleep(0.1)

print(f"t={time.time()-t0:.1f}: total leido: {len(output)} bytes", flush=True)
print(f"OUTPUT: {output[-300:]!r}", flush=True)
