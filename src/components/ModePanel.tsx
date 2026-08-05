/**
 * Panel de resumen segun el modo. Reutilizable para los 3 modos
 * (reunion, estudio, conversacion). Renderiza el JSON estructurado
 * con fallbacks amigables si el resumen esta vacio o fallo.
 */
import { useAppStore, type Mode } from '../store/useAppStore';
import { summarize } from '../lib/api';
import { downloadText } from '../lib/format';

const TITLES: Record<Mode, string> = {
  reunion: 'Modo Reunion — Minuta',
  estudio: 'Modo Estudio — Resumen educativo',
  conversacion: 'Modo Conversacion — Analisis de hablantes',
};

const DESCRIPTIONS: Record<Mode, string> = {
  reunion:
    'Detecta asistentes, temas tratados, decisiones, tareas con responsables y fechas mencionadas. Ideal para enviar a quien no asistio.',
  estudio:
    'Extrae conceptos clave, definiciones mencionadas, bloques tematicos y preguntas probables de examen.',
  conversacion:
    'Estima hablantes por turnos, tono general, momentos clave y temas principales. Pensado para analizar dialogos, llamadas o entrevistas.',
};

export function ModePanel({ mode }: { mode: Mode }) {
  const transcription = useAppStore((s) => s.transcription);
  const summary = useAppStore((s) => s.summaries[mode]);
  const setSummary = useAppStore((s) => s.setSummary);

  async function run() {
    if (!transcription) return;
    setSummary(mode, { loading: true, error: null });
    try {
      const data = (await summarize(transcription.text, mode)) as Record<string, unknown>;
      setSummary(mode, { loading: false, data, error: null });
    } catch (e) {
      setSummary(mode, { loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function exportMd() {
    if (!summary.data) return;
    const lines: string[] = [];
    lines.push(`# ${TITLES[mode]}`);
    lines.push('');
    lines.push(`_Generado por Meet Ninja (metodo: ${(summary.data._metodo as string) || 'desconocido'})_`);
    lines.push('');
    for (const [k, v] of Object.entries(summary.data)) {
      if (k.startsWith('_')) continue;
      lines.push(`## ${k}`);
      lines.push('');
      lines.push(renderMdValue(v));
      lines.push('');
    }
    downloadText(lines.join('\n'), `meetninja-${mode}.md`, 'text/markdown;charset=utf-8');
  }

  return (
    <div className="mode-panel">
      <div className="mode-header">
        <div>
          <h2 className="mode-title">{TITLES[mode]}</h2>
          <p className="mode-desc">{DESCRIPTIONS[mode]}</p>
        </div>
        <div className="mode-actions">
          {summary.data && (
            <button className="btn btn-ghost" onClick={exportMd} type="button">
              Exportar .md
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={run}
            disabled={!transcription || summary.loading}
            type="button"
          >
            {summary.loading ? 'Resumiendo...' : summary.data ? 'Regenerar' : 'Generar resumen'}
          </button>
        </div>
      </div>

      {summary.error && <div className="alert alert-error">Error: {summary.error}</div>}

      {summary.data && Boolean((summary.data as Record<string, unknown>)._warning) && (
        <div className="alert alert-warn">
          <strong>Aviso:</strong> {String((summary.data as Record<string, unknown>)._warning)}
        </div>
      )}

      {!transcription && (
        <div className="empty-state">
          <p>Primero transcribí un audio para poder generar el resumen.</p>
        </div>
      )}

      {transcription && !summary.data && !summary.loading && !summary.error && (
        <div className="empty-state">
          <p>Aun no se genero un resumen para este modo.</p>
          <p className="hint">Presiona <strong>Generar resumen</strong>.</p>
        </div>
      )}

      {summary.data && (
        <div className="mode-result">
          <div className="mode-result-meta">
            Metodo: <strong>{(summary.data._metodo as string) || 'desconocido'}</strong>
            {(summary.data._modelo as string) && (
              <>
                {' '}· Modelo: <strong>{summary.data._modelo as string}</strong>
              </>
            )}
          </div>
          <JsonView data={summary.data} />
        </div>
      )}
    </div>
  );
}

function renderMdValue(v: unknown): string {
  if (v == null) return '_vacio_';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n');
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `- **${k}**: ${typeof val === 'string' ? val : JSON.stringify(val)}`)
      .join('\n');
  }
  return String(v);
}

function JsonView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) {
    return <p className="hint">El resumen no devolvio contenido.</p>;
  }
  return (
    <div className="kv">
      {entries.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <div className="kv-key">{humanKey(k)}</div>
          <div className="kv-val">
            <ValueRender value={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

function humanKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function ValueRender({ value }: { value: unknown }) {
  if (value == null || value === '') {
    return <span className="muted">—</span>;
  }
  if (typeof value === 'string') {
    return <p className="str">{value}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">(vacio)</span>;
    return (
      <ul className="arr">
        {value.map((x, i) => (
          <li key={i}>
            <ValueRender value={x} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className="obj">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div className="obj-row" key={k}>
            <span className="obj-key">{humanKey(k)}:</span> <ValueRender value={v} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}
