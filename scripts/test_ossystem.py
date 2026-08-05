"""Test via os.system."""
import os
import time
import sys

bin_dir = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\bin"
model = r"C:\Users\jagua\Desktop\MeetNinja\python_backend\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"
prompt_file = r"C:\Users\jagua\Desktop\MeetNinja\test_prompt.txt"

t0 = time.time()
print(f"t={time.time()-t0:.1f}: os.system...", flush=True)
# Usar una lista de argumentos (no shell) pero pasando via cmd
# Lo mas simple: usar subprocess con shell=True
import subprocess
cmd = ["llama-cli.exe", "-m", model, "-f", prompt_file, "-n", "10", "--temp", "0.2",
       "-c", "4096", "-t", "4", "-ngl", "0", "--no-display-prompt", "--no-conversation"]
print(f"t={time.time()-t0:.1f}: cwd={bin_dir}", flush=True)
os.chdir(bin_dir)
print(f"t={time.time()-t0:.1f}: subprocess.run con shell=True", flush=True)
r = subprocess.run(cmd, shell=False, capture_output=False, timeout=120)
print(f"t={time.time()-t0:.1f}: retorno {r.returncode}", flush=True)
