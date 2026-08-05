"""
Meet Ninja - Transcripcion con faster-whisper.

Soporta modelos: tiny, base, small, medium, large-v3.
Device: cpu (las compus de oficina no tienen GPU dedicada).
Compute type: int8 (rapido en CPU, suficiente calidad).
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator, Optional

log = logging.getLogger("meetninja.transcriber")

# Modelos validos. 'tiny' es el mas chico (~75MB), 'large-v3' el mas grande (~3GB).
VALID_MODELS = ("tiny", "base", "small", "medium", "large-v3")

# Modelo por defecto. Configurable en la UI.
DEFAULT_MODEL = "small"

# Cache de modelos whisper. Se descargan aqui la primera vez.
MODELS_DIR = Path(__file__).resolve().parent / "models"


@dataclass
class Segment:
    start: float
    end: float
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TranscriptionResult:
    language: str
    language_probability: float
    duration: float
    text: str
    segments: list[Segment]
    model: str

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "language_probability": self.language_probability,
            "duration": self.duration,
            "text": self.text,
            "segments": [s.to_dict() for s in self.segments],
            "model": self.model,
        }


class Transcriber:
    """
    Wrapper de faster-whisper. Carga el modelo lazy (la primera vez que se usa)
    y lo cachea en memoria para llamadas siguientes.
    """

    def __init__(self, model_name: str = DEFAULT_MODEL, device: str = "cpu"):
        if model_name not in VALID_MODELS:
            raise ValueError(
                f"Modelo invalido: {model_name}. Validos: {VALID_MODELS}"
            )
        self.model_name = model_name
        self.device = device
        self._model = None
        self._lock = threading.Lock()
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

    def _load(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            log.info("Cargando modelo faster-whisper '%s'...", self.model_name)
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type="int8",
                download_root=str(MODELS_DIR),
            )
            log.info("Modelo '%s' cargado OK", self.model_name)

    def transcribe(
        self,
        audio_path: str | Path,
        language: str = "es",
        beam_size: int = 5,
        vad_filter: bool = True,
    ) -> TranscriptionResult:
        """
        Transcribe un archivo de audio. Devuelve segmentos con timestamps
        y el texto completo.

        - language: codigo BCP-47 ('es', 'en', 'pt', etc.). Si es None,
          faster-whisper detecta automaticamente.
        - beam_size: 5 es un buen balance velocidad/calidad. Bajar a 1
          para mas velocidad, subir a 10 para mejor calidad.
        - vad_filter: filtra silencios. Recomendado True.
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"No existe el audio: {audio_path}")
        if audio_path.stat().st_size == 0:
            raise ValueError("Archivo de audio vacio")

        self._load()

        log.info(
            "Transcribiendo '%s' (modelo=%s, idioma=%s)",
            audio_path.name,
            self.model_name,
            language or "auto",
        )

        segments_iter, info = self._model.transcribe(
            str(audio_path),
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter,
            vad_parameters={"min_silence_duration_ms": 500} if vad_filter else None,
        )

        segments: list[Segment] = []
        text_parts: list[str] = []
        for seg in segments_iter:
            s = Segment(start=float(seg.start), end=float(seg.end), text=seg.text.strip())
            segments.append(s)
            text_parts.append(s.text)

        full_text = " ".join(text_parts).strip()
        result = TranscriptionResult(
            language=info.language,
            language_probability=float(info.language_probability),
            duration=float(info.duration),
            text=full_text,
            segments=segments,
            model=self.model_name,
        )
        log.info(
            "Transcripcion OK: idioma=%s (%.2f), duracion=%.1fs, segmentos=%d",
            result.language,
            result.language_probability,
            result.duration,
            len(segments),
        )
        return result

    def transcribe_array(
        self,
        audio: "np.ndarray",
        sample_rate: int = 16000,
        language: str = "es",
        beam_size: int = 1,
        vad_filter: bool = True,
    ) -> TranscriptionResult:
        """
        Transcribe un array de numpy (float32, mono, sample_rate Hz).
        Usado por el pipeline live que recibe audio PCM del frontend
        sin pasar por un archivo en disco.
        """
        import numpy as np
        if audio is None or len(audio) == 0:
            raise ValueError("Audio vacio")
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        self._load()
        log.info(
            "Transcribiendo array: shape=%s, sr=%d, lang=%s",
            audio.shape, sample_rate, language or "auto",
        )

        segments_iter, info = self._model.transcribe(
            audio,
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter,
            vad_parameters={"min_silence_duration_ms": 300} if vad_filter else None,
        )

        segments: list[Segment] = []
        text_parts: list[str] = []
        for seg in segments_iter:
            s = Segment(start=float(seg.start), end=float(seg.end), text=seg.text.strip())
            segments.append(s)
            text_parts.append(s.text)

        full_text = " ".join(text_parts).strip()
        return TranscriptionResult(
            language=info.language,
            language_probability=float(info.language_probability),
            duration=float(info.duration),
            text=full_text,
            segments=segments,
            model=self.model_name,
        )

    def available_models(self) -> list[str]:
        return list(VALID_MODELS)


# Singleton global (un solo modelo cargado a la vez para no quemar RAM).
_default: Optional[Transcriber] = None
_default_lock = threading.Lock()


def get_transcriber(model_name: str = DEFAULT_MODEL) -> Transcriber:
    """
    Devuelve un Transcriber para el modelo pedido. Si cambia el modelo
    respecto al singleton actual, lo reemplaza (libera RAM del anterior).
    """
    global _default
    with _default_lock:
        if _default is None or _default.model_name != model_name:
            _default = Transcriber(model_name=model_name)
        return _default
