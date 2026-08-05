/**
 * Componente de grabacion de audio con MediaRecorder.
 *
 * Soporta 3 fuentes:
 *   - 'mic'    : solo microfono (getUserMedia)
 *   - 'system' : solo audio del sistema (getDisplayMedia, descarta video)
 *   - 'both'   : microfono + audio del sistema mezclados via Web Audio API
 *
 * La grabacion se guarda como Blob (webm/opus) y se manda al backend.
 * Si el usuario quiere, puede cargar un archivo en vez de grabar.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { formatTime } from '../lib/format';
import { useTranslation } from '../i18n/useTranslation';

type Source = 'mic' | 'system' | 'both';

export function Recorder() {
  const { t } = useTranslation();
  const setAudio = useAppStore((s) => s.setAudio);
  const setRecording = useAppStore((s) => s.setRecording);
  const isRecording = useAppStore((s) => s.isRecording);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Stream que se pasa a MediaRecorder (puede ser el mic, el system, o el mezclado)
  const streamRef = useRef<MediaStream | null>(null);
  // Streams originales pedidos (mic y/o system). Se cierran en stopAll.
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  // AudioContext + nodos para mezclar (solo en modo 'both')
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<number | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('mic');

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
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {
        // ignore
      });
      audioCtxRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }

  async function getStream(src: Source): Promise<MediaStream> {
    if (src === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      return stream;
    }

    if (src === 'system') {
      // getDisplayMedia requiere video:true; descartamos la pista de video.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach((t) => t.stop());
      stream.removeTrack(videoTracks[0]);
      // Si el usuario no tildo "compartir audio", no hay pista de audio.
      if (stream.getAudioTracks().length === 0) {
        throw new Error(t('recorder.systemNoAudio'));
      }
      systemStreamRef.current = stream;
      return stream;
    }

    // src === 'both': pedimos ambos y los mezclamos via Web Audio API.
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = mic;
    let sys: MediaStream;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const videoTracks = display.getVideoTracks();
      videoTracks.forEach((t) => t.stop());
      display.removeTrack(videoTracks[0]);
      if (display.getAudioTracks().length === 0) {
        // Liberar el mic que ya pedimos si no hay audio del sistema.
        mic.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        throw new Error(t('recorder.systemNoAudio'));
      }
      sys = display;
      systemStreamRef.current = sys;
    } catch (e) {
      // Si falla el system audio, liberar el mic antes de propagar el error.
      mic.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      throw e;
    }

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    const micSource = audioCtx.createMediaStreamSource(mic);
    const sysSource = audioCtx.createMediaStreamSource(sys);
    micSource.connect(dest);
    sysSource.connect(dest);
    return dest.stream;
  }

  async function start(src: Source = source) {
    setError(null);
    try {
      const stream = await getStream(src);
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
      const msg = e instanceof Error ? e.message : t('recorder.micError');
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
          <>
            <div className="recorder-source" role="radiogroup" aria-label={t('recorder.source')}>
              <button
                type="button"
                role="radio"
                aria-checked={source === 'mic'}
                className={'chip' + (source === 'mic' ? ' chip-active' : '')}
                onClick={() => setSource('mic')}
              >
                {t('recorder.sourceMic')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={source === 'system'}
                className={'chip' + (source === 'system' ? ' chip-active' : '')}
                onClick={() => setSource('system')}
              >
                {t('recorder.sourceSystem')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={source === 'both'}
                className={'chip' + (source === 'both' ? ' chip-active' : '')}
                onClick={() => setSource('both')}
              >
                {t('recorder.sourceBoth')}
              </button>
            </div>
            <button className="btn btn-primary" onClick={() => start(source)} type="button">
              <span className="rec-dot" /> {t('recorder.record')}
            </button>
          </>
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
      {(source === 'system' || source === 'both') && !isRecording && (
        <p className="recorder-hint recorder-hint-info">
          {t('recorder.shareScreenHint')}
        </p>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      <p className="recorder-hint">{t('recorder.hint')}</p>
    </div>
  );
}
