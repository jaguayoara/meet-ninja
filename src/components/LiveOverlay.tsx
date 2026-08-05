/**
 * Overlay de subtitulos en vivo estilo pelicula.
 *
 * - Posicion fija abajo-centro de la ventana.
 * - Muestra el ultimo transcript y la traduccion abajo (mas pequena).
 * - Animacion de entrada/salida para cada linea.
 * - Se puede mover/esconder con un control minimo.
 */
export type LiveLine = {
  text: string;
  ts: number;
  kind: 'transcript' | 'translation';
};

export function LiveOverlay({
  transcripts,
  translations,
  visible,
}: {
  transcripts: LiveLine[];
  translations: LiveLine[];
  visible: boolean;
}) {
  if (!visible) return null;
  const lastT = transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;
  const lastTr = translations.length > 0 ? translations[translations.length - 1] : null;

  return (
    <div className="live-overlay" aria-live="polite">
      {lastT && (
        <div key={`t-${lastT.ts}`} className="live-line live-line-transcript">
          {lastT.text}
        </div>
      )}
      {lastTr && (
        <div key={`tr-${lastTr.ts}`} className="live-line live-line-translation">
          {lastTr.text}
        </div>
      )}
    </div>
  );
}
