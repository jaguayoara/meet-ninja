"""
Meet Ninja - LLM local embebido usando el binario de llama.cpp.

Para no depender de Ollama ni de servicios externos. El binario se descarga
la primera vez desde los GitHub releases de llama.cpp (~17 MB) y el modelo
GGUF la primera vez desde HuggingFace (~1 GB para Qwen2.5-1.5B Q4_K_M).

Todo queda cacheado en python_backend/bin/ y python_backend/models/llm/
respectivamente, asi que solo se baja una vez.

Requisitos: nada. Solo Python stdlib + el binario.
"""
from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import subprocess
import threading
import time
import zipfile
from pathlib import Path
from typing import Optional

log = logging.getLogger("meetninja.llm")

# --------------------------------------------------------------------
# Configuracion
# --------------------------------------------------------------------

# Binario de llama.cpp. Se descarga la primera vez.
LLAMA_REPO = "ggml-org/llama.cpp"
# Pinned a un tag estable. Si lo subimos, revisar compat.
LLAMA_VERSION = "b10285"
LLAMA_BIN_DIR = Path(__file__).resolve().parent / "bin"

# Modelo por defecto: Qwen2.5-1.5B-Instruct Q4_K_M (~1 GB, multilingue, rapido en CPU)
# Otras opciones razonables:
#   - "Qwen/Qwen2.5-1.5B-Instruct-GGUF" (default, 1.5B)
#   - "Qwen/Qwen2.5-3B-Instruct-GGUF"     (3B, mejor pero +RAM)
#   - "microsoft/Phi-3.5-mini-instruct-GGUF" (3.8B, muy bueno)
DEFAULT_MODEL_REPO = "Qwen/Qwen2.5-1.5B-Instruct-GGUF"
DEFAULT_MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf"

# Override por env var
MODEL_REPO = os.environ.get("MEETNINJA_LLM_MODEL_REPO", DEFAULT_MODEL_REPO)
MODEL_FILE = os.environ.get("MEETNINJA_LLM_MODEL_FILE", DEFAULT_MODEL_FILE)

# Cap de RAM para el modelo (en MB). Por default 2 GB - suficiente para
# Qwen 1.5B Q4. Para modelos mas grandes, subir via env var.
N_GPU_LAYERS = int(os.environ.get("MEETNINJA_LLM_GPU_LAYERS", "0"))  # 0 = CPU only
N_THREADS = int(os.environ.get("MEETNINJA_LLM_THREADS", str(max(1, (os.cpu_count() or 4) - 1))))
N_CTX = int(os.environ.get("MEETNINJA_LLM_CTX", "4096"))  # ventana de contexto

# Path donde se guarda el modelo GGUF
MODELS_DIR = Path(__file__).resolve().parent / "models" / "llm"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------
# Descarga del binario de llama.cpp
# --------------------------------------------------------------------

def _get_platform_asset() -> tuple[str, str]:
    """Devuelve (asset_name, exe_name) segun el OS y arch."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system != "windows":
        raise RuntimeError(
            f"Por ahora solo Windows esta soportado para el LLM local. "
            f"Tu sistema: {system} {machine}. "
            f"En Linux/macOS, instala Ollama (https://ollama.com) o "
            f"compila llama.cpp desde fuente."
        )
    # Windows x64 (la mayoria de oficinas)
    if machine in ("amd64", "x86_64"):
        asset = f"llama-{LLAMA_VERSION}-bin-win-cpu-x64.zip"
        exe = "llama-server.exe"  # usamos el server, no el cli
    elif machine == "arm64":
        asset = f"llama-{LLAMA_VERSION}-bin-win-cpu-arm64.zip"
        exe = "llama-server.exe"
    else:
        raise RuntimeError(f"Arquitectura no soportada: {machine}")
    return asset, exe


def _bin_path() -> Path:
    """Path al ejecutable de llama-server."""
    _, exe = _get_platform_asset()
    p = LLAMA_BIN_DIR / exe
    return p


def ensure_binary() -> Path:
    """
    Asegura que el binario de llama.cpp este descargado. Devuelve el path
    al ejecutable. Si ya esta, no hace nada.
    """
    binp = _bin_path()
    # el launcher .exe es chico (~9KB) porque carga DLLs al lado.
    # verificamos que existan el .exe y al menos una DLL clave.
    dll_check = LLAMA_BIN_DIR / "llama.dll"
    if binp.exists() and dll_check.exists():
        return binp

    asset, exe = _get_platform_asset()
    LLAMA_BIN_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = LLAMA_BIN_DIR / asset

    url = f"https://github.com/{LLAMA_REPO}/releases/download/{LLAMA_VERSION}/{asset}"
    log.info("Descargando binario llama.cpp: %s", url)
    print(f"[llm] Descargando binario llama.cpp (~17 MB)...")
    t0 = time.time()
    try:
        import urllib.request
        urllib.request.urlretrieve(url, str(zip_path))
    except Exception as e:
        raise RuntimeError(f"No se pudo descargar el binario: {e}")

    log.info("Descarga completa en %.1fs. Extrayendo...", time.time() - t0)
    print(f"[llm] Extrayendo binario...")
    # extraer a una subcarpeta temporal para no contaminar LLAMA_BIN_DIR
    tmp_extract = LLAMA_BIN_DIR / "_tmp_extract"
    if tmp_extract.exists():
        shutil.rmtree(tmp_extract, ignore_errors=True)
    tmp_extract.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        zf.extractall(str(tmp_extract))
    # borrar el zip
    try:
        zip_path.unlink()
    except OSError:
        pass

    # mover todos los archivos extraidos a LLAMA_BIN_DIR (puede ser que
    # el zip tenga una subcarpeta)
    moved = 0
    for src in tmp_extract.rglob("*"):
        if src.is_file():
            dst = LLAMA_BIN_DIR / src.name
            if dst.exists():
                dst.unlink()
            shutil.move(str(src), str(dst))
            moved += 1
    shutil.rmtree(tmp_extract, ignore_errors=True)

    if not binp.exists():
        raise RuntimeError(f"No se encontro {exe} despues de extraer {asset}")
    log.info("Binario listo (%d archivos): %s", moved, binp)
    return binp


# --------------------------------------------------------------------
# Descarga del modelo GGUF
# --------------------------------------------------------------------

def _model_path() -> Path:
    return MODELS_DIR / MODEL_FILE


def ensure_model() -> Path:
    """
    Asegura que el modelo GGUF este descargado. Devuelve el path.
    Si ya esta, no hace nada.
    """
    mp = _model_path()
    if mp.exists() and mp.stat().st_size > 100_000_000:  # > 100 MB
        return mp

    print(f"[llm] Descargando modelo {MODEL_REPO}/{MODEL_FILE} (~1 GB)...")
    print(f"[llm] Esto se hace una sola vez. Quedara en {mp}")
    log.info("Descargando modelo GGUF: %s/%s", MODEL_REPO, MODEL_FILE)
    t0 = time.time()
    try:
        from huggingface_hub import hf_hub_download
        downloaded = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=MODEL_FILE,
            local_dir=str(MODELS_DIR),
        )
        log.info("Modelo descargado en %.1fs: %s", time.time() - t0, downloaded)
        return Path(downloaded)
    except Exception as e:
        raise RuntimeError(
            f"No se pudo descargar el modelo: {e}\n"
            f"Verifica tu conexion o configura MEETNINJA_LLM_MODEL_REPO / "
            f"MEETNINJA_LLM_MODEL_FILE con otro modelo GGUF compatible."
        )


# --------------------------------------------------------------------
# Wrapper del LLM (singleton)
# --------------------------------------------------------------------

class LocalLLM:
    """
    Wrapper alrededor de llama-server.exe. Arranca un servidor HTTP local
    (en localhost:puerto) que expone una API compatible con OpenAI.
    La primera vez tarda en arrancar (cargar el modelo en RAM). Despues las
    llamadas son rapidas.

    El servidor queda corriendo en background hasta que se mata el proceso
    Python o se llama a stop().
    """

    # Puerto fijo, no configurable por el usuario
    DEFAULT_PORT = 8766

    def __init__(self):
        self._bin: Optional[Path] = None
        self._model: Optional[Path] = None
        self._proc: Optional[subprocess.Popen] = None
        self._port: int = self.DEFAULT_PORT
        self._lock = threading.Lock()
        self._client = None  # httpx.Client lazy

    def _ensure_ready(self) -> None:
        """Asegura que el binario y el modelo esten, y que el server este corriendo."""
        if self._proc is not None and self._proc.poll() is None:
            return  # ya esta corriendo
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return
            if self._bin is None:
                self._bin = ensure_binary()
                self._model = ensure_model()
            self._start_server()

    def _start_server(self) -> None:
        """Arranca llama-server en background y espera a que responda."""
        port = self._port
        cmd = [
            str(self._bin),
            "-m", str(self._model),
            "--host", "127.0.0.1",
            "--port", str(port),
            "-c", str(N_CTX),
            "-t", str(N_THREADS),
            "-ngl", str(N_GPU_LAYERS),
        ]
        log.info("Arrancando llama-server en 127.0.0.1:%d (cargando modelo, puede tardar ~30s)", port)
        print(f"[llm] Arrancando servidor local (cargando modelo, ~30s primera vez)...")
        import sys
        kwargs = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.PIPE,
            "cwd": str(LLAMA_BIN_DIR),
            "env": {**os.environ, "LLAMA_LOG_DISABLE": "1"},
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        self._proc = subprocess.Popen(cmd, **kwargs)

        # esperar a que el server responda
        import httpx
        base = f"http://127.0.0.1:{port}"
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                r = httpx.get(f"{base}/health", timeout=2)
                if r.status_code == 200:
                    log.info("llama-server listo en %.1fs", time.time() - t0)
                    return
            except Exception:
                pass
            # chequear si el proceso murio
            if self._proc.poll() is not None:
                err = self._proc.stderr.read().decode("utf-8", errors="replace") if self._proc.stderr else ""
                raise RuntimeError(f"llama-server murio al arrancar: {err[:300]}")
            time.sleep(0.5)
        # timeout
        self.stop()
        raise RuntimeError("llama-server no arranco en 90s")

    def stop(self) -> None:
        """Detiene el server si esta corriendo."""
        if self._proc is not None:
            try:
                self._proc.terminate()
                try:
                    self._proc.wait(timeout=5)
                except Exception:
                    self._proc.kill()
            except Exception:
                pass
            self._proc = None

    def is_ready(self) -> bool:
        """Chequeo rapido sin descargar nada."""
        bin_ok = _bin_path().exists() and (LLAMA_BIN_DIR / "llama.dll").exists()
        return bin_ok and _model_path().exists()

    def _client_lazy(self):
        if self._client is None:
            import httpx
            self._client = httpx.Client(timeout=180.0)
        return self._client

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        timeout: int = 180,
    ) -> str:
        """
        Genera una respuesta al prompt usando la API /v1/chat/completions
        de llama-server (compatible con OpenAI). Devuelve el texto.
        """
        self._ensure_ready()
        client = self._client_lazy()

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        log.info("LLM local: generate (max_tokens=%d, timeout=%ds)", max_tokens, timeout)
        t0 = time.time()
        try:
            r = client.post(
                f"http://127.0.0.1:{self._port}/v1/chat/completions",
                json={
                    "model": "local",
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                },
                timeout=timeout,
            )
        except Exception as e:
            raise RuntimeError(f"LLM local fallo: {e}")

        if r.status_code != 200:
            raise RuntimeError(f"LLM local HTTP {r.status_code}: {r.text[:300]}")

        data = r.json()
        try:
            response = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise RuntimeError(f"LLM local: respuesta inesperada: {data}")

        response = response.strip()
        log.info("LLM local: %d chars en %.1fs", len(response), time.time() - t0)
        return response


# Singleton
_default: Optional[LocalLLM] = None
_default_lock = threading.Lock()


def get_llm() -> LocalLLM:
    global _default
    with _default_lock:
        if _default is None:
            _default = LocalLLM()
        return _default


# --------------------------------------------------------------------
# API publica
# --------------------------------------------------------------------

def is_available() -> bool:
    """True si el binario y el modelo ya estan descargados (sin descargarlos)."""
    bin_ok = _bin_path().exists() and (LLAMA_BIN_DIR / "llama.dll").exists()
    return bin_ok and _model_path().exists()


def status() -> dict:
    """Info para el /health de la API."""
    return {
        "enabled": True,
        "ready": is_available(),
        "model_repo": MODEL_REPO,
        "model_file": MODEL_FILE,
        "model_path": str(_model_path()) if is_available() else None,
        "bin_path": str(_bin_path()) if _bin_path().exists() else None,
        "n_threads": N_THREADS,
        "n_ctx": N_CTX,
    }
