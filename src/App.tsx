/**
 * Meet Ninja - Shell principal.
 *
 * Estructura:
 *  - Header: estado del backend, version, controles globales.
 *  - Panel izq: Recorder + FileDrop + controles de transcripcion + Search.
 *  - Panel der: Tabs (Transcripcion / Reunion / Estudio / Conversacion).
 */
import { useEffect, useState } from 'react';
import { Recorder } from './components/Recorder';
import { FileDrop } from './components/FileDrop';
import { TranscriptionView } from './components/TranscriptionView';
import { ModePanel } from './components/ModePanel';
import { SearchPanel } from './components/SearchPanel';
import { ChatPanel } from './components/ChatPanel';
import { TranslatePanel } from './components/TranslatePanel';
import { useAppStore, type TabId } from './store/useAppStore';
import { health as healthApi, transcribe as transcribeApi } from './lib/api';
import { downloadText, humanSize } from './lib/format';
import { useTranslation } from './i18n/useTranslation';
import { LANGS, type Lang } from './i18n/translations';

const TABS: { id: TabId; key: string; icon: string }[] = [
  { id: 'transcripcion', key: 'tab.transcripcion', icon: '📝' },
  { id: 'reunion',       key: 'tab.reunion',       icon: '🗂️' },
  { id: 'estudio',       key: 'tab.estudio',       icon: '📚' },
  { id: 'conversacion',  key: 'tab.conversacion',  icon: '💬' },
];

export default function App() {
  const { t } = useTranslation();
  const audioBlob = useAppStore((s) => s.audioBlob);
  const audioFileName = useAppStore((s) => s.audioFileName);
  const audioDuration = useAppStore((s) => s.audioDuration);
  const isRecording = useAppStore((s) => s.isRecording);
  const transcription = useAppStore((s) => s.transcription);
  const isTranscribing = useAppStore((s) => s.isTranscribing);
  const transcriptionError = useAppStore((s) => s.transcriptionError);
  const progressMsg = useAppStore((s) => s.progressMsg);
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const whisperModel = useAppStore((s) => s.whisperModel);
  const whisperAvailable = useAppStore((s) => s.whisperAvailable);
  const ollamaAvailable = useAppStore((s) => s.ollamaAvailable);
  const ollamaModel = useAppStore((s) => s.ollamaModel);
  const ollamaMaxModelB = useAppStore((s) => s.ollamaMaxModelB);
  const backendReady = useAppStore((s) => s.backendReady);
  const backendError = useAppStore((s) => s.backendError);
  const setBackendStatus = useAppStore((s) => s.setBackendStatus);
  const setWhisperModel = useAppStore((s) => s.setWhisperModel);
  const setIsTranscribing = useAppStore((s) => s.setIsTranscribing);
  const setTranscriptionError = useAppStore((s) => s.setTranscriptionError);
  const setProgressMsg = useAppStore((s) => s.setProgressMsg);
  const setTranscription = useAppStore((s) => s.setTranscription);
  const reset = useAppStore((s) => s.reset);

  const [version, setVersion] = useState<string>('');

  // chequear backend al montar
  useEffect(() => {
    let cancelled = false;
    async function check() {
      for (let i = 0; i < 30; i++) {
        try {
          const h = await healthApi();
          if (cancelled) return;
          setBackendStatus({
            backendReady: true,
            backendError: null,
            whisperModel: h.whisper.default_model,
            whisperAvailable: h.whisper.available_models,
            ollamaAvailable: h.ollama.available,
            ollamaModel: h.ollama.model,
            ollamaMaxModelB: h.ollama.max_model_b,
            ollamaAllowOversize: h.ollama.allow_oversize,
          });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) {
        setBackendStatus({
          backendReady: false,
          backendError: 'No se pudo conectar al backend Python. Ejecuta scripts\\setup-python.ps1 y reinicia la app.',
        });
      }
    }
    check();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // version de la app
  useEffect(() => {
    if (window.meetninja) {
      window.meetninja.getVersion().then(setVersion).catch(() => undefined);
    }
  }, []);

  async function handleTranscribe() {
    if (!audioBlob) return;
    setIsTranscribing(true);
    setTranscriptionError(null);
    setProgressMsg('Iniciando...');
    try {
      const r = await transcribeApi({
        file: audioBlob,
        model: whisperModel,
        language: 'es',
        onProgress: (m) => setProgressMsg(m),
      });
      setTranscription(r);
      setProgressMsg('');
      setActiveTab('transcripcion');
    } catch (e) {
      setTranscriptionError(e instanceof Error ? e.message : String(e));
      setProgressMsg('');
    } finally {
      setIsTranscribing(false);
    }
  }

  function exportTranscriptTxt() {
    if (!transcription) return;
    const lines = [
      `Meet Ninja - Transcripcion`,
      `Archivo: ${audioFileName || 'audio'}`,
      `Modelo: ${transcription.model}`,
      `Idioma: ${transcription.language} (${(transcription.language_probability * 100).toFixed(0)}%)`,
      `Duracion: ${transcription.duration.toFixed(1)}s`,
      '',
      ...transcription.segments.map((s) => `[${formatTs(s.start)}] ${s.text}`),
    ];
    downloadText(lines.join('\n'), 'transcripcion.txt', 'text/plain;charset=utf-8');
  }

  function exportTranscriptMd() {
    if (!transcription) return;
    const lines = [
      `# Transcripcion`,
      `- Archivo: ${audioFileName || 'audio'}`,
      `- Modelo: ${transcription.model}`,
      `- Idioma: ${transcription.language} (${(transcription.language_probability * 100).toFixed(0)}%)`,
      `- Duracion: ${transcription.duration.toFixed(1)}s`,
      '',
      ...transcription.segments.map((s) => `**[${formatTs(s.start)}]** ${s.text}`),
    ];
    downloadText(lines.join('\n'), 'transcripcion.md', 'text/markdown;charset=utf-8');
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🥷</span>
          <span className="brand-name">Meet Ninja</span>
          {version && <span className="brand-version">v{version}</span>}
        </div>
        <div className="header-status">
          <LanguageSelector />
          <BackendStatus
            ready={backendReady}
            error={backendError}
            ollamaAvailable={ollamaAvailable}
            ollamaModel={ollamaModel}
            ollamaMaxModelB={ollamaMaxModelB}
          />
          <button className="btn btn-ghost btn-sm" onClick={reset} type="button">
            {t('header.newSession')}
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <section className="card">
            <h3 className="card-title">{t('card.1.audio')}</h3>
            <Recorder />
            <div className="or-sep">o arrastra un archivo</div>
            <FileDrop />
            {audioBlob && (
              <div className="audio-summary">
                <div>
                  <strong>{audioFileName}</strong>
                </div>
                <div className="muted">
                  {humanSize(audioBlob.size)}
                  {audioDuration > 0 && ` · ${audioDuration.toFixed(1)}s`}
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h3 className="card-title">{t('card.2.transcribe')}</h3>
            <div className="transcribe-controls">
              <label className="field">
                <span>{t('transcribe.model')}</span>
                <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                  {whisperAvailable.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <small className="muted">
                  {t('transcribe.modelHint')}
                </small>
              </label>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleTranscribe}
                disabled={!audioBlob || isTranscribing || isRecording || !backendReady}
                type="button"
              >
                {isTranscribing ? t('transcribe.progress', { msg: progressMsg }) : t('transcribe.btn')}
              </button>
              {transcriptionError && <div className="alert alert-error">{transcriptionError}</div>}
            </div>
          </section>

          {transcription && (
            <section className="card">
              <h3 className="card-title">{t('card.3.search')}</h3>
              <SearchPanel />
            </section>
          )}

          {transcription && (
            <section className="card">
              <h3 className="card-title">{t('card.4.chat')}</h3>
              <ChatPanel />
            </section>
          )}

          {transcription && (
            <section className="card">
              <h3 className="card-title">{t('card.5.translate')}</h3>
              <TranslatePanel />
            </section>
          )}

          {transcription && (
            <section className="card">
              <h3 className="card-title">{t('card.6.export')}</h3>
              <div className="export-buttons">
                <button className="btn btn-ghost" onClick={exportTranscriptTxt} type="button">
                  {t('export.txt')}
                </button>
                <button className="btn btn-ghost" onClick={exportTranscriptMd} type="button">
                  {t('export.md')}
                </button>
              </div>
              <p className="hint">{t('export.hint')}</p>
            </section>
          )}
        </aside>

        <main className="main-pane">
          <nav className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
                disabled={!transcription && tab.id !== 'transcripcion'}
              >
                <span className="tab-icon">{tab.icon}</span>
                {t(tab.key)}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {activeTab === 'transcripcion' && <TranscriptionView />}
            {activeTab === 'reunion' && <ModePanel mode="reunion" />}
            {activeTab === 'estudio' && <ModePanel mode="estudio" />}
            {activeTab === 'conversacion' && <ModePanel mode="conversacion" />}
          </div>
        </main>
      </div>
    </div>
  );
}

function BackendStatus({
  ready,
  error,
  ollamaAvailable,
  ollamaModel,
  ollamaMaxModelB,
}: {
  ready: boolean;
  error: string | null;
  ollamaAvailable: boolean;
  ollamaModel: string;
  ollamaMaxModelB: number;
}) {
  const { t } = useTranslation();
  if (!ready) {
    return <span className="status status-error" title={error || ''}>Backend: error</span>;
  }
  return (
    <div className="status-group">
      <span className="status status-ok">{t('header.backendOk')}</span>
      <span
        className={`status ${ollamaAvailable ? 'status-ok' : 'status-warn'}`}
        title={
          ollamaAvailable
            ? `Ollama: ${ollamaModel} (cap ${ollamaMaxModelB}B)`
            : 'Ollama no detectado. Se usara resumen extractivo.'
        }
      >
        {ollamaAvailable
          ? t('header.ollamaYes', { model: ollamaModel, cap: ollamaMaxModelB })
          : t('header.ollamaNo')}
      </span>
    </div>
  );
}

function formatTs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function LanguageSelector() {
  const { lang, setLang, t } = useTranslation();
  return (
    <select
      className="lang-selector"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      title={t('lang.label')}
      aria-label={t('lang.label')}
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native}
        </option>
      ))}
    </select>
  );
}
