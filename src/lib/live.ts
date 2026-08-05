/**
 * Hook useLiveSession
 *
 * Maneja una sesion live de transcripcion + traduccion.
 *
 * Responsabilidades:
 *  - Abrir el WebSocket con el backend (/live/ws).
 *  - Recibir audio PCM (Int16, 16kHz mono) del caller y mandarlo como binario.
 *  - Recibir eventos del backend y exponerlos via callbacks.
 *  - Cerrar limpio al detener.
 *
 * Convenciones:
 *  - El audio que le llega tiene que ser PCM Int16 mono 16kHz. Si la fuente
 *    es mic/system a 48kHz, el caller tiene que resamplear antes de mandar.
 *  - Los chunks tienen que ser de ~2-3 segundos (ej 48000 samples = 3s a 16kHz).
 *  - El estado se expone como { status, lastTranscript, lastTranslation,
 *    transcripts, translations, error }.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl } from './api';

export type LiveStatus = 'idle' | 'connecting' | 'active' | 'error' | 'closed';

export type LiveEvent =
  | { type: 'transcript'; text: string; language: string; chunk_index: number }
  | { type: 'translation'; text: string; target_lang: string }
  | { type: 'ready' }
  | { type: 'closed' }
  | { type: 'error'; message: string };

export type LiveOptions = {
  sourceLang: string;        // 'auto' o 'es', 'en', etc
  targetLang: string;        // 'es', 'en', 'pt', etc
  whisperModel?: string;     // default 'small'
  onTranscript?: (e: { text: string; language: string; chunk_index: number }) => void;
  onTranslation?: (e: { text: string; target_lang: string }) => void;
  onError?: (msg: string) => void;
};

export function useLiveSession(opts: LiveOptions) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastTranslation, setLastTranslation] = useState<string | null>(null);
  const transcriptsRef = useRef<string[]>([]);
  const translationsRef = useRef<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionIdRef = useRef<string>('');

  const start = useCallback(async () => {
    if (status === 'active' || status === 'connecting') return;
    setError(null);
    setStatus('connecting');
    transcriptsRef.current = [];
    translationsRef.current = [];
    setLastTranscript(null);
    setLastTranslation(null);

    // 1) Pedir el stream de audio (mic por ahora, luego se podra elegir)
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      setStatus('error');
      opts.onError?.(m);
      return;
    }

    // 2) Abrir WebSocket con el backend
    const baseUrl = await getBaseUrl();
    // baseUrl es http://...:puerto, lo pasamos a ws://
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/live/ws';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    sessionIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'config',
        session_id: sessionIdRef.current,
        source_lang: opts.sourceLang,
        target_lang: opts.targetLang,
        whisper_model: opts.whisperModel || 'small',
      }));
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as LiveEvent;
        if (data.type === 'ready') {
          setStatus('active');
        } else if (data.type === 'transcript') {
          transcriptsRef.current = [...transcriptsRef.current, data.text].slice(-100);
          setLastTranscript(data.text);
          opts.onTranscript?.(data);
        } else if (data.type === 'translation') {
          translationsRef.current = [...translationsRef.current, data.text].slice(-100);
          setLastTranslation(data.text);
          opts.onTranslation?.(data);
        } else if (data.type === 'error') {
          setError(data.message);
          opts.onError?.(data.message);
        } else if (data.type === 'closed') {
          setStatus('closed');
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      setError('Error en WebSocket');
      setStatus('error');
    };

    ws.onclose = () => {
      setStatus((s) => (s === 'closed' ? s : 'closed'));
      stopAudioPipeline();
    };

    // 3) Pipeline de audio: AudioContext a 16kHz, ScriptProcessor que produce
    // PCM Int16 y lo manda al WebSocket.
    try {
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      // ScriptProcessor con buffer de 4096 samples (~256ms a 16kHz).
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      let buffer: number[] = [];
      const CHUNK_SAMPLES = 16000 * 2; // 2 segundos
      processor.onaudioprocess = (e) => {
        const inData = e.inputBuffer.getChannelData(0);
        // Acumular samples
        for (let i = 0; i < inData.length; i++) buffer.push(inData[i]);
        if (buffer.length >= CHUNK_SAMPLES) {
          const chunk = new Float32Array(buffer.slice(0, CHUNK_SAMPLES));
          buffer = buffer.slice(CHUNK_SAMPLES);
          // Convertir float32 [-1, 1] -> int16
          const pcm16 = new Int16Array(chunk.length);
          for (let i = 0; i < chunk.length; i++) {
            const s = Math.max(-1, Math.min(1, chunk[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16.buffer);
          }
        }
      };
      source.connect(processor);
      // Conectar a un gain mudo y al destination para que el processor se ejecute
      // (en algunos navegadores hay que conectar a destination para que onaudioprocess dispare).
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audioCtx.destination);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      setStatus('error');
      opts.onError?.(m);
      return;
    }

    // 4) Tambien grabar el audio para tenerlo al final (MediaRecorder)
    try {
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // Guardamos el blob en el state para que el caller lo levante.
        // Lo emitimos via una callback opcional.
        opts.onTranscript?.({ text: '', language: '', chunk_index: -1 });
        // Para no acoplar al estado, lo guardamos en una ref accesible:
        (window as unknown as { __liveRecording?: Blob }).__liveRecording = blob;
      };
      rec.start(1000);
      recordingRef.current = rec;
    } catch {
      // No critico si falla la grabacion local.
    }
  }, [opts, status]);

  function stopAudioPipeline() {
    if (recordingRef.current && recordingRef.current.state !== 'inactive') {
      try { recordingRef.current.stop(); } catch { /* ignore */ }
    }
    recordingRef.current = null;
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { /* ignore */ }
    }
    processorRef.current = null;
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
    }
    sourceRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
  }

  const stop = useCallback(() => {
    stopAudioPipeline();
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
      } catch { /* ignore */ }
      try { wsRef.current.close(); } catch { /* ignore */ }
    }
    wsRef.current = null;
    setStatus('closed');
  }, []);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      stopAudioPipeline();
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    error,
    lastTranscript,
    lastTranslation,
    transcripts: transcriptsRef.current,
    translations: translationsRef.current,
    start,
    stop,
  };
}
