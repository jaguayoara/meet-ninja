/**
 * Componente de grabacion de audio con MediaRecorder.
 *
 * Usa el microfono del sistema. La grabacion se guarda como Blob
 * (webm/opus) y se manda al backend. Si el usuario quiere, puede
 * cargar un archivo en vez de grabar.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { formatTime } from '../lib/format';
import { useTranslation } from '../i18n/useTranslation';

export function Recorder() {
  const { t } = useTranslation();
  const setAudio = useAppStore((s) => s.setAudio);
  const setRecording = useAppStore((s) => s.setRecording);
  const isRecording = useAppStore((s) => s.isRecording);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAll() {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        setAudio(blob, `grabacion-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, elapsed);
        stopAll();
        setRecording(false);
      };

      rec.start(1000);
      setRecording(true);
      setElapsed(0);
      const t0 = Date.now();
      tickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - t0) / 1000);
      }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo acceder al microfono';
      setError(msg);
      stopAll();
      setRecording(false);
    }
  }

  function stop() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }

  async function handleOpen() {
    if (!window.meetninja) {
      setError('Abre la app desde Electron para cargar archivos del disco.');
      return;
    }
    const path = await window.meetninja.openAudioDialog();
    if (!path) return;
    // El main process lee el archivo y devuelve base64.
    if (window.meetninja) {
      try {
        const data = await window.meetninja.readAudioFile(path);
        const binary = atob(data.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mime });
        setAudio(blob, data.name);
      } catch (e) {
        setError(t('recorder.readError'));
      }
    } else {
      setError(t('recorder.readError'));
    }
  }

  return (
    <div className="recorder">
      <div className="recorder-row">
        {!isRecording ? (
          <button className="btn btn-primary" onClick={start} type="button">
            <span className="rec-dot" /> {t('recorder.record')}
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stop} type="button">
            <span className="rec-square" /> {t('recorder.stop')} ({formatTime(elapsed)})
          </button>
        )}
        <span className="recorder-sep">o</span>
        <button className="btn btn-ghost" onClick={handleOpen} type="button">
          {t('recorder.loadFile')}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <p className="recorder-hint">
        {t('recorder.hint')}
      </p>
    </div>
  );
}
