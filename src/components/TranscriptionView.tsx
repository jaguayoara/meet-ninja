/**
 * Vista principal de la transcripcion literal.
 * - Lista cada segmento con su timestamp.
 * - Resalta los matches de busqueda (highlights).
 * - Click en timestamp = scroll al audio (futuro).
 * - Soporta navegacion de matches con flechas.
 */
import { useEffect, useRef } from 'react';
import { useAppStore, useCurrentSession } from '../store/useAppStore';
import { formatTime } from '../lib/format';

export function TranscriptionView() {
  const session = useCurrentSession();
  const transcription = session?.transcription ?? null;
  const search = session?.search ?? { terms: '', parsedTerms: [], mode: 'any' as const, results: [], loading: false, error: null, activeMatchIdx: 0 };
  const setActiveMatch = useAppStore((s) => s.setActiveMatch);
  const activeMatchIdx = search.activeMatchIdx;

  const containerRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Cuando cambia activeMatchIdx, scrollear a ese segmento
  useEffect(() => {
    if (search.results.length === 0) return;
    const m = search.results[activeMatchIdx];
    if (!m) return;
    const el = segRefs.current.get(m.segment_index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeMatchIdx, search.results]);

  if (!transcription) {
    return (
      <div className="empty-state">
        <p>Aun no hay transcripcion.</p>
        <p className="hint">Graba o carga un audio, y presiona <strong>Transcribir</strong>.</p>
      </div>
    );
  }

  // marcar que segmentos tienen match
  const matchesBySeg = new Map<number, number[]>();
  search.results.forEach((m, i) => {
    if (!matchesBySeg.has(m.segment_index)) matchesBySeg.set(m.segment_index, []);
    matchesBySeg.get(m.segment_index)!.push(i);
  });

  return (
    <div className="tx-view" ref={containerRef}>
      <div className="tx-meta">
        <span>
          Idioma detectado: <strong>{transcription.language}</strong> (
          {(transcription.language_probability * 100).toFixed(0)}%)
        </span>
        <span>
          Modelo: <strong>{transcription.model}</strong>
        </span>
        <span>
          Duracion: <strong>{formatTime(transcription.duration)}</strong>
        </span>
        <span>
          Segmentos: <strong>{transcription.segments.length}</strong>
        </span>
        {search.results.length > 0 && (
          <span className="tx-meta-search">
            {activeMatchIdx + 1} / {search.results.length} matches
            <button
              className="btn btn-ghost btn-sm"
              disabled={activeMatchIdx === 0}
              onClick={() => setActiveMatch(Math.max(0, activeMatchIdx - 1))}
            >
              ↑
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={activeMatchIdx >= search.results.length - 1}
              onClick={() => setActiveMatch(Math.min(search.results.length - 1, activeMatchIdx + 1))}
            >
              ↓
            </button>
          </span>
        )}
      </div>
      <div className="tx-segments">
        {transcription.segments.map((seg, i) => {
          const hasMatch = matchesBySeg.has(i);
          const activeMatch = hasMatch && matchesBySeg.get(i)!.includes(activeMatchIdx);
          return (
            <div
              key={i}
              ref={(el) => {
                if (el) segRefs.current.set(i, el);
                else segRefs.current.delete(i);
              }}
              className={`tx-seg ${hasMatch ? 'has-match' : ''} ${activeMatch ? 'active-match' : ''}`}
            >
              <div className="tx-seg-time">
                <button
                  className="tx-time-btn"
                  onClick={() => {
                    // TODO: implementar seek del audio cuando tengamos reproductor
                    // por ahora solo marca el segmento
                    setActiveMatch(matchesBySeg.get(i)?.[0] ?? 0);
                  }}
                  title="Ir a este momento"
                >
                  {formatTime(seg.start)}
                </button>
              </div>
              <div className="tx-seg-text">
                <HighlightedText text={seg.text} matchTerms={search.parsedTerms} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Resalta los terminos buscados dentro de un texto (acento-insensitive).
 * Si no hay terminos, devuelve el texto plano.
 */
function HighlightedText({ text, matchTerms }: { text: string; matchTerms: string[]; mode?: 'any' | 'all' }) {
  if (!matchTerms.length) return <>{text}</>;
  // construir regex con los terminos limpios
  const escaped = matchTerms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return <>{text}</>;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  // separar en partes
  const parts: Array<{ txt: string; isMatch: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // en JS RegExp sin /g/d sin /y se necesita reset
  const re2 = new RegExp(re.source, 'gi');
  while ((m = re2.exec(text)) !== null) {
    if (m.index > last) parts.push({ txt: text.slice(last, m.index), isMatch: false });
    parts.push({ txt: m[0], isMatch: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re2.lastIndex++; // safety
  }
  if (last < text.length) parts.push({ txt: text.slice(last), isMatch: false });
  return (
    <>
      {parts.map((p, i) =>
        p.isMatch ? (
          <mark key={i} className="hl">
            {p.txt}
          </mark>
        ) : (
          <span key={i}>{p.txt}</span>
        ),
      )}
    </>
  );
}
