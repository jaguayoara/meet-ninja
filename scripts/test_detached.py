"""Test con creationflags DETACHED_PROCESS."""
import subprocess
import time
import sys

bin_path = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin\llama-cli.exe"
model = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
prompt_file = r"C:\Users\jagua\Desktop\MeetNinja\test_prompt.txt"

print("antes de popen", flush=True)
t0 = time.time()
p = subprocess.Popen(
    [bin_path, "-m", model, "-f", prompt_file, "-n", "10", "--temp", "0.2",
     "-c", "4096", "-t", "4", "-ngl", "0", "--no-display-prompt", "--no-conversation"],
    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    cwd=r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin",
    creationflags=0x00000008 | 0x00000010,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
)
print(f"t={time.time()-t0:.1f}: PID {p.pid}, esperando communicate...", flush=True)
out, err = p.communicate(timeout=60)
print(f"t={time.time()-t0:.1f}: exit={p.returncode}, out_len={len(out)}", flush=True)
print(f"OUT: {out[-200:].decode('utf-8', errors='replace')}", flush=True)
if err:
    print(f"ERR: {err[-200:].decode('utf-8', errors='replace')}", flush=True)
