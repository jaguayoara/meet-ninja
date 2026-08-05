/**
 * Componente de grabacion de audio con MediaRecorder.
 *
 * Soporta 3 fuentes:
 *   - 'mic'    : solo microfono (getUserMedia)
 *   - 'system' : solo audio del sistema (desktopCapturer + chromeMediaSource)
 *   - 'both'   : microfono + audio del sistema mezclados via Web Audio API
 *
 * Mientras graba, muestra un visualizador de nivel en vivo (AnalyserNode
 * + canvas + requestAnimationFrame) para que se note que esta captando audio.
 *
 * La grabacion se guarda como Blob (webm/opus) y se manda al backend.
 * Si el usuario quiere, puede cargar un archivo en vez de grabar.
 *
 * NOTA: en Electron, getDisplayMedia NO esta disponible. Hay que usar
 * `desktopCapturer` del main process para listar fuentes, y luego
 * `navigator.mediaDevices.getUserMedia` con `chromeMediaSource: 'desktop'`
 * para obtener el MediaStream real.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { formatTime } from '../lib/format';
import { useTranslation } from '../i18n/useTranslation';

type Source = 'mic' | 'system' | 'both';

const VIZ_BAR_COUNT = 24;
const VIZ_CSS_WIDTH = 220;
const VIZ_CSS_HEIGHT = 44;

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

  // Visualizador: AudioContext + AnalyserNode + raf + canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vizAudioCtxRef = useRef<AudioContext | null>(null);
  const vizRafRef = useRef<number | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('mic');
  // Picker de fuente: aparece cuando hay varias opciones de screen/window.
  const [picker, setPicker] = useState<{ id: string; name: string }[] | null>(null);
  const pickerResolveRef = useRef<((id: string | null) => void) | null>(null);

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
    stopVisualizer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Engancha un AnalyserNode al stream y dibuja barras de nivel en el
   * canvas. Usa su propio AudioContext (no interfiere con el del mix).
   */
  function startVisualizer(stream: MediaStream) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const audioCtx = new AudioContext();
    vizAudioCtxRef.current = audioCtx;
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    sourceNode.connect(analyser);
    // NOTA: NO conectamos el analyser al destination - no queremos
    // que el audio se escuche por los parlantes, solo analizarlo.

    const buf = new Uint8Array(analyser.frequencyBinCount); // 32 bins

    const dpr = window.devicePixelRatio || 1;
    const w = VIZ_CSS_WIDTH * dpr;
    const h = VIZ_CSS_HEIGHT * dpr;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx2d.scale(dpr, dpr);
    const cw = VIZ_CSS_WIDTH;
    const ch = VIZ_CSS_HEIGHT;

    // Colores leidos del CSS custom property del primary.
    const colorBase = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim() || '#7c3aed';
    const colorTop = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary-hover')
      .trim() || '#a78bfa';

    const draw = () => {
      analyser.getByteFrequencyData(buf);

      ctx2d.clearRect(0, 0, cw, ch);

      const slot = cw / VIZ_BAR_COUNT;
      const barW = slot * 0.6;
      const gap = slot * 0.4;

      for (let i = 0; i < VIZ_BAR_COUNT; i++) {
        // Muestrear bins de la mitad baja (donde esta la voz) con leve skew.
        const t = i / (VIZ_BAR_COUNT - 1);
        const idx = Math.min(
          buf.length - 1,
          Math.floor(Math.pow(t, 0.85) * (buf.length * 0.6))
        );
        const v = buf[idx] / 255;
        const barH = Math.max(2, v * (ch - 4));
        const x = i * slot + gap / 2;
        const y = ch - barH;

        const grad = ctx2d.createLinearGradient(0, ch, 0, 0);
        grad.addColorStop(0, colorBase);
        grad.addColorStop(1, colorTop);
        ctx2d.fillStyle = grad;

        const r = Math.min(barW / 2, 3);
        ctx2d.beginPath();
        ctx2d.moveTo(x + r, y);
        ctx2d.arcTo(x + barW, y, x + barW, y + r, r);
        ctx2d.arcTo(x + barW, ch, x + barW - r, ch, r);
        ctx2d.arcTo(x, ch, x, ch - r, r);
        ctx2d.arcTo(x, y, x + r, y, r);
        ctx2d.closePath();
        ctx2d.fill();
      }

      vizRafRef.current = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopVisualizer() {
    if (vizRafRef.current != null) {
      cancelAnimationFrame(vizRafRef.current);
      vizRafRef.current = null;
    }
    if (vizAudioCtxRef.current) {
      vizAudioCtxRef.current.close().catch(() => {
        // ignore
      });
      vizAudioCtxRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx2d = canvas.getContext('2d');
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /**
   * Pide al usuario elegir una fuente de sistema (screen o window).
   * Auto-elige si solo hay una. Devuelve sourceId o null si cancela.
   */
  async function pickSourceId(): Promise<string | null> {
    if (!window.meetninja?.getDesktopSources) {
      throw new Error(t('recorder.electronOnly'));
    }
    const sources = await window.meetninja.getDesktopSources();
    if (sources.length === 0) {
      throw new Error(t('recorder.noSources'));
    }
    if (sources.length === 1) return sources[0].id;
    return new Promise<string | null>((resolve) => {
      pickerResolveRef.current = resolve;
      setPicker(sources);
    });
  }

  function resolvePicker(id: string | null) {
    const fn = pickerResolveRef.current;
    pickerResolveRef.current = null;
    setPicker(null);
    if (fn) fn(id);
  }

  /**
   * Abre un stream de audio del sistema via Electron desktopCapturer
   * (NO getDisplayMedia, que no funciona dentro de Electron).
   */
  async function openSystemStream(): Promise<MediaStream> {
    const sourceId = await pickSourceId();
    if (!sourceId) throw new Error(t('recorder.cancelled'));

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
      throw new Error(t('recorder.systemNoAudio'));
    }
    return stream;
  }

  async function getStream(src: Source): Promise<MediaStream> {
    if (src === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      return stream;
    }

    if (src === 'system') {
      const stream = await openSystemStream();
      systemStreamRef.current = stream;
      return stream;
    }

    // src === 'both': pedimos ambos y los mezclamos via Web Audio API.
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = mic;
    let sys: MediaStream;
    try {
      sys = await openSystemStream();
      systemStreamRef.current = sys;
    } catch (e) {
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

      // Visualizador en vivo: AnalyserNode + canvas.
      // Lo arranco despues de tener el stream y antes del MediaRecorder
      // para que la primera lectura tenga data util.
      startVisualizer(stream);

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
          <>
            <button className="btn btn-danger" onClick={stop} type="button">
              <span className="rec-square rec-square-pulse" /> {t('recorder.stop')} ({formatTime(elapsed)})
            </button>
            <div className="recorder-viz-wrap" aria-label={t('recorder.vizAria')}>
              <span className="rec-pulse" aria-hidden="true" />
              <canvas
                ref={canvasRef}
                className="recorder-viz"
                width={VIZ_CSS_WIDTH * 2}
                height={VIZ_CSS_HEIGHT * 2}
              />
            </div>
          </>
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

      {picker && (
        <div className="picker-backdrop" onClick={() => resolvePicker(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <h3 className="picker-title">{t('recorder.pickSource')}</h3>
            <p className="picker-hint">{t('recorder.pickSourceHint')}</p>
            <ul className="picker-list">
              {picker.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="picker-item"
                    onClick={() => resolvePicker(s.id)}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="picker-actions">
              <button type="button" className="btn btn-ghost" onClick={() => resolvePicker(null)}>
                {t('recorder.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
