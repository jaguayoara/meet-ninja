"""Test minimalista de subprocess."""
import subprocess
import time
import os

bin_path = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin\llama-cli.exe"
model = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
prompt_file = r"C:\Users\jagua\Desktop\MeetNinja\test_prompt.txt"

print(f"t={time.time():.1f}: Lanzando", flush=True)
t0 = time.time()
p = subprocess.Popen(
    [bin_path, "-m", model, "-f", prompt_file, "-n", "10", "--temp", "0.2",
     "-c", "4096", "-t", "4", "-ngl", "0", "--no-display-prompt", "--no-conversation"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    cwd=r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin",
)
print(f"t={time.time()-t0:.1f}: PID={p.pid}", flush=True)

# leer hasta EOF
out, err = p.communicate(timeout=120)
print(f"t={time.time()-t0:.1f}: Termino, exit={p.returncode}, out_len={len(out)}, err_len={len(err)}", flush=True)
print(f"OUT: {out[-100:]!r}", flush=True)
print(f"ERR: {err[-100:]!r}", flush=True)
