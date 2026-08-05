/**
 * Zona de drop de archivos de audio. Drag & drop o click.
 */
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';

const ACCEPTED = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm', 'aac', 'mp4'];

export function FileDrop() {
  const setAudio = useAppStore((s) => s.setAudio);
  const audioFileName = useAppStore((s) => s.audioFileName);
  const reset = useAppStore((s) => s.reset);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setError(`Formato no soportado: .${ext}`);
      return;
    }
    setError(null);
    setAudio(f, f.name);
  }

  return (
    <div
      className={`drop ${hover ? 'is-hover' : ''} ${audioFileName ? 'has-file' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {!audioFileName ? (
        <label className="drop-inner">
          <input
            type="file"
            accept=".wav,.mp3,.m4a,.ogg,.flac,.webm,.aac,.mp4"
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: 'none' }}
          />
          <div className="drop-icon">🎙️</div>
          <div className="drop-title">Arrastra un audio aqui</div>
          <div className="drop-sub">o haz clic para seleccionar</div>
        </label>
      ) : (
        <div className="drop-loaded">
          <div className="drop-loaded-name" title={audioFileName}>
            {audioFileName}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset} type="button">
            Quitar
          </button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
