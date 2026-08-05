"""Test super simple: solo lanzar y esperar."""
import subprocess
import time
import os

bin_path = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin\llama-cli.exe"
model = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
prompt_file = r"C:\Users\jagua\Desktop\MeetNinja\test_prompt.txt"

print(f"t={time.time():.1f}: Lanzando", flush=True)
t0 = time.time()
# Ningun pipe, todo a NUL
p = subprocess.Popen(
    [bin_path, "-m", model, "-f", prompt_file, "-n", "10", "--temp", "0.2",
     "-c", "4096", "-t", "4", "-ngl", "0", "--no-display-prompt", "--no-conversation"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    cwd=r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin",
)
print(f"t={time.time()-t0:.1f}: PID={p.pid}, esperando...", flush=True)
rc = p.wait()
print(f"t={time.time()-t0:.1f}: termino, exit={rc}", flush=True)
