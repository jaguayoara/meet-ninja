/**
 * Panel de traduccion de la transcripcion.
 * El usuario elige el idioma destino y el LLM local traduce.
 * Pensado para: espanol -> ingles, portugues, frances, etc.
 */
import { useState } from 'react';
import { useCurrentSession } from '../store/useAppStore';
import { translate } from '../lib/api';
import { useTranslation } from '../i18n/useTranslation';
import { TRANSLATE_TARGETS } from '../i18n/translations';
import { downloadText } from '../lib/format';

export function TranslatePanel() {
  const session = useCurrentSession();
  const transcription = session?.transcription ?? null;
  const audioFileName = session?.audioFileName ?? null;
  const { t } = useTranslation();

  const [target, setTarget] = useState<string>('en');
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!transcription) {
    return <p className="hint">{t('translate.empty')}</p>;
  }

  async function run() {
    setLoading(true);
    setError(null);
    setOutput('');
    try {
      const r = await translate({ text: transcription!.text, targetLang: target });
      setOutput(r.translated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (output) navigator.clipboard?.writeText(output).catch(() => undefined);
  }

  function download() {
    if (!output) return;
    const ext = (audioFileName || 'transcript').replace(/\.[^.]+$/, '');
    downloadText(output, `${ext}_${target}.txt`);
  }

  return (
    <div className="translate-panel">
      <p className="hint">{t('translate.hint')}</p>
      <div className="translate-controls">
        <label className="field">
          <span>{t('translate.target')}</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={loading}>
            {TRANSLATE_TARGETS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          onClick={run}
          disabled={loading}
          type="button"
        >
          {loading ? t('translate.translating') : t('translate.btn')}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {output && (
        <div className="translate-result">
          <div className="translate-result-header">
            <strong>{t('translate.result')}</strong>
            <div className="translate-buttons">
              <button className="btn btn-ghost btn-sm" onClick={copy} type="button">
                {t('translate.copy')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={download} type="button">
                {t('translate.download')}
              </button>
            </div>
          </div>
          <textarea className="translate-output" value={output} readOnly rows={8} />
        </div>
      )}
    </div>
  );
}
