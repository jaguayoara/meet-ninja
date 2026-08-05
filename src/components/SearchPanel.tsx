/**
 * Panel de busqueda de palabras clave.
 *
 * Caso de uso original: "un policia buscando delitos en una escucha".
 * - Input acepta 1 o varios terminos, separados por coma, salto de linea o ';'.
 * - Modo ANY/ALL: 'cualquiera matchea' o 'todos deben aparecer en el mismo segmento'.
 * - Dispara busqueda automaticamente (debounced).
 * - Muestra contador de matches y permite navegar con flechas.
 * - Acento-insensitive y case-insensitive.
 */
import { useEffect } from 'react';
import { useAppStore, useCurrentSession } from '../store/useAppStore';
import { search as searchApi } from '../lib/api';
import { downloadText } from '../lib/format';
import { useTranslation } from '../i18n/useTranslation';

export function SearchPanel() {
  const { t, tp } = useTranslation();
  const session = useCurrentSession();
  const transcription = session?.transcription ?? null;
  const search = session?.search ?? { terms: '', parsedTerms: [], mode: 'any' as const, results: [], loading: false, error: null, activeMatchIdx: 0 };
  const setSearchTerms = useAppStore((s) => s.setSearchTerms);
  const setSearchMode = useAppStore((s) => s.setSearchMode);
  const setSearchResults = useAppStore((s) => s.setSearchResults);
  const setSearchLoading = useAppStore((s) => s.setSearchLoading);
  const setActiveMatch = useAppStore((s) => s.setActiveMatch);

  // Buscar con debounce cuando cambian los terminos / modo
  useEffect(() => {
    if (!transcription) {
      setSearchResults([], null);
      return;
    }
    if (search.parsedTerms.length === 0) {
      setSearchResults([], null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await searchApi({
          segments: transcription.segments,
          terms: search.parsedTerms,
          mode: search.mode,
        });
        if (!cancelled) {
          setSearchResults(r.matches, null);
          // saltar a tab de transcripcion para ver los matches
          if (r.matches.length > 0) {
            useAppStore.getState().setActiveTab('transcripcion');
            setActiveMatch(0);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setSearchResults([], e instanceof Error ? e.message : String(e));
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.parsedTerms.join('|'), search.mode, transcription?.text]);

  function exportMatches() {
    if (search.results.length === 0) return;
    const lines: string[] = [];
    lines.push(`# Meet Ninja - Resultados de busqueda`);
    lines.push(`Terminos: ${search.parsedTerms.join(', ')}`);
    lines.push(`Modo: ${search.mode === 'all' ? 'TODOS deben aparecer' : 'CUALQUIERA matchea'}`);
    lines.push(`Total: ${search.results.length}`);
    lines.push('');
    search.results.forEach((m, i) => {
      const t = formatTime(m.start);
      lines.push(`## ${i + 1}. "${m.term}" @ ${t}`);
      lines.push('');
      lines.push(`> ${m.snippet}`);
      lines.push('');
    });
    downloadText(lines.join('\n'), 'meetninja-busqueda.md', 'text/markdown;charset=utf-8');
  }

  return (
    <div className="search-panel">
      <div className="search-header">
        <h3>{t('search.title')}</h3>
        <p className="search-hint">{t('search.hint')}</p>
      </div>
      <div className="search-controls">
        <textarea
          className="search-input"
          placeholder={t('search.placeholder')}
          value={search.terms}
          onChange={(e) => setSearchTerms(e.target.value)}
          rows={3}
        />
        <div className="search-modes">
          <label className="radio">
            <input
              type="radio"
              name="search-mode"
              checked={search.mode === 'any'}
              onChange={() => setSearchMode('any')}
            />
            <span>{t('search.any')}</span>
          </label>
          <label className="radio">
            <input
              type="radio"
              name="search-mode"
              checked={search.mode === 'all'}
              onChange={() => setSearchMode('all')}
            />
            <span>{t('search.all')}</span>
          </label>
        </div>
      </div>

      {!transcription && (
        <p className="hint">{t('chat.empty')}</p>
      )}

      {search.loading && <p className="hint">{t('search.searching')}</p>}
      {search.error && <div className="alert alert-error">{t('error.prefix')} {search.error}</div>}

      {transcription && search.parsedTerms.length > 0 && !search.loading && (
        <div className="search-summary">
          {search.results.length === 0 ? (
            <p className="muted">{t('search.noMatches')}</p>
          ) : (
            <>
              <p>{tp('search.matches', search.results.length)}</p>
              <button className="btn btn-ghost btn-sm" onClick={exportMatches} type="button">
                {t('search.export')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
