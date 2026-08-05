/**
 * Hook useLiveSession
 *
 * Maneja una sesion live de transcripcion + traduccion.
 *
 * Responsabilidades:
 *  - Abrir el WebSocket con el backend (/live/ws).
 *  - Capturar audio segun la fuente (mic / system / both) y resamplear a 16kHz.
 *  - Acumular samples en chunks de 2s y mandarlos al backend como PCM Int16.
 *  - Recibir eventos del backend y exponerlos via callbacks.
 *  - Cerrar limpio al detener.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl } from './api';

export type LiveStatus = 'idle' | 'connecting' | 'active' | 'error' | 'closed';
export type LiveSource = 'mic' | 'system' | 'both';

export type LiveEvent =
  | { type: 'transcript'; text: string; language: string; chunk_index: number }
  | { type: 'translation'; text: string; target_lang: string }
  | { type: 'ready' }
  | { type: 'closed' }
  | { type: 'error'; message: string };

export type LiveOptions = {
  source: LiveSource;             // 'mic' | 'system' | 'both'
  sourceLang: string;             // 'auto' o 'es', 'en', etc
  targetLang: string;             // 'es', 'en', 'pt', etc
  whisperModel?: string;          // default 'small'
  onTranscript?: (e: { text: string; language: string; chunk_index: number }) => void;
  onTranslation?: (e: { text: string; target_lang: string }) => void;
  onError?: (msg: string) => void;
};

async function openStream(source: LiveSource): Promise<MediaStream> {
  if (source === 'mic') {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
  if (source === 'system') {
    if (!window.meetninja?.getDesktopSources) {
      throw new Error('Solo funciona dentro de la app de Electron');
    }
    const sources = await window.meetninja.getDesktopSources();
    if (sources.length === 0) throw new Error('No hay ventanas/pantallas para capturar');
    // Sintetica: la primera screen se ofrece como "Todas las pantallas".
    const firstScreen = sources.find((s) => s.id.startsWith('screen:'));
    let sourceId: string;
    if (sources.length === 1 || (sources.length > 1 && firstScreen && sources[0].id === firstScreen.id && sources.length === 2)) {
      sourceId = firstScreen ? firstScreen.id : sources[0].id;
    } else {
      // Para live usamos la primera screen directamente (sin picker)
      // porque el picker bloquearia el flujo en tiempo real.
      // Si el user quiere una ventana especifica, que la elija via menu antes.
      sourceId = firstScreen ? firstScreen.id : sources[0].id;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      } as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1,
          maxHeight: 1,
        },
      } as MediaTrackConstraints,
    });
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach((t) => t.stop());
    stream.removeTrack(videoTracks[0]);
    if (stream.getAudioTracks().length === 0) {
      throw new Error('La fuente no tiene pista de audio. Proba otra ventana o tilda "compartir audio".');
    }
    return stream;
  }
  // both: mic + system mezclados via Web Audio API
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  let sysStream: MediaStream;
  try {
    sysStream = await openStream('system');
  } catch (e) {
    mic.getTracks().forEach((t) => t.stop());
    throw e;
  }
  // Mezcla via MediaStream (esto se hace fuera, el caller lo conecta al AudioContext)
  // Para mantener la firma simple, devolvemos un stream combinado via AudioContext.
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(mic);
  const sysSrc = ctx.createMediaStreamSource(sysStream);
  micSrc.connect(dest);
  sysSrc.connect(dest);
  return dest.stream;
}

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

    // 1) Capturar stream segun la fuente elegida
    let stream: MediaStream;
    try {
      stream = await openStream(opts.source);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m);
      setStatus('error');
      opts.onError?.(m);
      return;
    }

    // 2) Abrir WebSocket con el backend
    const baseUrl = await getBaseUrl();
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

    // 3) Pipeline de audio
    try {
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      let buffer: number[] = [];
      const CHUNK_SAMPLES = 16000 * 2; // 2 segundos
      processor.onaudioprocess = (e) => {
        const inData = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < inData.length; i++) buffer.push(inData[i]);
        if (buffer.length >= CHUNK_SAMPLES) {
          const chunk = new Float32Array(buffer.slice(0, CHUNK_SAMPLES));
          buffer = buffer.slice(CHUNK_SAMPLES);
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

    // 4) Tambien grabar el audio para tenerlo al final
    try {
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
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
