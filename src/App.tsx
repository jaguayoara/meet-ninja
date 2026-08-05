/**
 * Meet Ninja - Shell principal.
 *
 * Estructura:
 *  - Header: estado del backend, version, controles globales, ir a menu.
 *  - Si hay sesion activa: SessionView (Recorder + FileDrop + controles +
 *    tabs Transcripcion / Reunion / Estudio / Conversacion).
 *  - Si NO hay sesion activa: SessionMenu (lista de sesiones + nueva).
 *  - ChatBubble flotante: solo si hay transcripcion en la sesion activa.
 */
import { useEffect, useState } from 'react';
import { Recorder } from './components/Recorder';
import { FileDrop } from './components/FileDrop';
import { TranscriptionView } from './components/TranscriptionView';
import { ModePanel } from './components/ModePanel';
import { TranslatePanel } from './components/TranslatePanel';
import { SessionMenu } from './components/SessionMenu';
import { ChatBubble } from './components/ChatBubble';
import {
  useAppStore,
  useCurrentSession,
  hydrateAudioFromIDB,
  type TabId,
} from './store/useAppStore';
import { health as healthApi, transcribe as transcribeApi } from './lib/api';
import { downloadText, humanSize } from './lib/format';
import { useTranslation } from './i18n/useTranslation';
import { LANGS, type Lang } from './i18n/translations';

const TABS: { id: TabId; key: string; icon: string }[] = [
  { id: 'transcripcion', key: 'tab.transcripcion', icon: '📝' },
  { id: 'reunion',       key: 'tab.reunion',       icon: '🗂️' },
  { id: 'estudio',       key: 'tab.estudio',       icon: '📚' },
  { id: 'conversacion',  key: 'tab.conversacion',  icon: '🗨️' },
];

export default function App() {
  const { t } = useTranslation();
  const session = useCurrentSession();

  const [version, setVersion] = useState<string>('');

  // chequear backend al montar
  useEffect(() => {
    let cancelled = false;
    // Hidratar audios desde IndexedDB al inicio (no bloquea el render).
    hydrateAudioFromIDB().catch(() => undefined);
    async function check() {
      for (let i = 0; i < 30; i++) {
        try {
          const h = await healthApi();
          if (cancelled) return;
          useAppStore.getState().setBackendStatus({
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
        useAppStore.getState().setBackendStatus({
          backendReady: false,
          backendError: 'No se pudo conectar al backend Python. Ejecuta scripts\\setup-python.ps1 y reinicia la app.',
        });
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // version de la app
  useEffect(() => {
    if (window.meetninja) {
      window.meetninja.getVersion().then(setVersion).catch(() => undefined);
    }
  }, []);

  const backendError = useAppStore((s) => s.backendError);
  const backendReady = useAppStore((s) => s.backendReady);
  const ollamaAvailable = useAppStore((s) => s.ollamaAvailable);
  const ollamaModel = useAppStore((s) => s.ollamaModel);
  const ollamaMaxModelB = useAppStore((s) => s.ollamaMaxModelB);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);

  // Aplicar theme al <html> y mantenerlo sincronizado si cambia el store
  // (por ejemplo, desde el ThemeToggle o desde DevTools).
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <button
            type="button"
            className="brand-home"
            onClick={() => setCurrentSession('')}
            title={t('header.goMenu')}
            aria-label={t('header.goMenu')}
          >
            <span className="brand-mark">🥷</span>
            <span className="brand-name">Meet Ninja</span>
            {version && <span className="brand-version">v{version}</span>}
          </button>
        </div>
        <div className="header-status">
          <LanguageSelector />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
          <GitHubButton />
          <BackendStatus
            ready={backendReady}
            error={backendError}
            ollamaAvailable={ollamaAvailable}
            ollamaModel={ollamaModel}
            ollamaMaxModelB={ollamaMaxModelB}
          />
        </div>
      </header>

      {!session ? (
        <SessionMenu />
      ) : (
        <SessionView key={session.id} sessionId={session.id} />
      )}

      {session && <ChatBubble />}
    </div>
  );
}

// ================== SessionView ==================
function SessionView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const session = useAppStore((s) => s.sessions[sessionId]);
  const activeTab = useAppStore((s) => s.sessions[sessionId]?.activeTab ?? 'transcripcion');
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const whisperModel = useAppStore((s) => s.sessions[sessionId]?.whisperModel ?? 'small');
  const whisperAvailable = useAppStore((s) => s.whisperAvailable);
  const backendReady = useAppStore((s) => s.backendReady);
  const isTranscribing = useAppStore((s) => !!s.sessions[sessionId]?.isTranscribing);
  const isRecording = useAppStore((s) => !!s.sessions[sessionId]?.isRecording);
  const progressMsg = useAppStore((s) => s.sessions[sessionId]?.progressMsg ?? '');
  const transcriptionError = useAppStore((s) => s.sessions[sessionId]?.transcriptionError ?? null);
  const transcription = useAppStore((s) => s.sessions[sessionId]?.transcription ?? null);
  const audioBlob = useAppStore((s) => s.sessions[sessionId]?.audioBlob ?? null);
  const audioFileName = useAppStore((s) => s.sessions[sessionId]?.audioFileName ?? null);
  const audioDuration = useAppStore((s) => s.sessions[sessionId]?.audioDuration ?? 0);
  const uiLang = useAppStore((s) => s.uiLang);

  // setters
  const setWhisperModel = useAppStore((s) => s.setWhisperModel);
  const setIsTranscribing = useAppStore((s) => s.setIsTranscribing);
  const setTranscriptionError = useAppStore((s) => s.setTranscriptionError);
  const setProgressMsg = useAppStore((s) => s.setProgressMsg);
  const setTranscription = useAppStore((s) => s.setTranscription);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setChatBubbleOpen = useAppStore((s) => s.setChatBubbleOpen);
  const chatBubbleOpen = useAppStore((s) => s.chatBubbleOpen);

  if (!session) return null;

  async function handleTranscribe() {
    if (!audioBlob) return;
    setIsTranscribing(true);
    setTranscriptionError(null);
    setProgressMsg('Iniciando...');
    try {
      const r = await transcribeApi({
        file: audioBlob,
        model: whisperModel,
        // Pasamos el idioma activo como hint. Whisper es bueno detectando,
        // pero darle el hint del idioma de la UI mejora la precision cuando
        // el audio es multilingue o tiene acentos marcados.
        language: uiLang,
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
      `Sesion: ${session.name}`,
      `Archivo: ${audioFileName || 'audio'}`,
      `Modelo: ${transcription.model}`,
      `Idioma: ${transcription.language} (${(transcription.language_probability * 100).toFixed(0)}%)`,
      `Duracion: ${transcription.duration.toFixed(1)}s`,
      '',
      ...transcription.segments.map((s) => `[${formatTs(s.start)}] ${s.text}`),
    ];
    downloadText(lines.join('\n'), `${safeName(session.name)}-transcripcion.txt`, 'text/plain;charset=utf-8');
  }

  function exportTranscriptMd() {
    if (!transcription) return;
    const lines = [
      `# Transcripcion - ${session.name}`,
      `- Archivo: ${audioFileName || 'audio'}`,
      `- Modelo: ${transcription.model}`,
      `- Idioma: ${transcription.language} (${(transcription.language_probability * 100).toFixed(0)}%)`,
      `- Duracion: ${transcription.duration.toFixed(1)}s`,
      '',
      ...transcription.segments.map((s) => `**[${formatTs(s.start)}]** ${s.text}`),
    ];
    downloadText(lines.join('\n'), `${safeName(session.name)}-transcripcion.md`, 'text/markdown;charset=utf-8');
  }

  async function handleExportAudio() {
    if (!audioBlob) return;
    // Determinar extension segun el mime del blob.
    const mime = audioBlob.type || 'audio/webm';
    const ext =
      mime.includes('webm') ? 'webm' :
      mime.includes('ogg') ? 'ogg' :
      mime.includes('wav') ? 'wav' :
      mime.includes('mpeg') ? 'mp3' :
      mime.includes('mp4') ? 'm4a' :
      mime.includes('flac') ? 'flac' :
      'webm';
    // Si ya tenemos un nombre con extension, lo reusamos; si no, generamos uno.
    const baseName = audioFileName
      ? audioFileName.replace(/\.[^.]+$/, '')
      : `grabacion-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const fileName = `${safeName(baseName) || 'audio'}.${ext}`;
    // Descargar via Blob URL (mas limpio para binarios que data URL).
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Liberar el object URL despues de un tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app-body">
      <aside className="sidebar">
        <section className="card session-context-card">
          <div className="session-context-row">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCurrentSession('')}
              title={t('header.goMenu')}
            >
              ← {t('header.sessions')}
            </button>
            <h3 className="card-title session-context-name" title={session.name}>
              {session.name}
            </h3>
          </div>
          <h3 className="card-title">{t('card.1.audio')}</h3>
          <Recorder />
          <div className="or-sep">{t('app.orDragFile')}</div>
          <FileDrop />
          {audioBlob && (
            <div className="audio-summary">
              <div className="audio-summary-info">
                <div>
                  <strong>{audioFileName}</strong>
                </div>
                <div className="muted">
                  {humanSize(audioBlob.size)}
                  {audioDuration > 0 && ` · ${audioDuration.toFixed(1)}s`}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleExportAudio}
                title={t('audio.saveAudioTitle')}
              >
                ⤓ {t('audio.saveAudio')}
              </button>
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
          {transcription && (
            <button
              type="button"
              className={'tab tab-bubble-tab' + (chatBubbleOpen ? ' is-active' : '')}
              onClick={() => setChatBubbleOpen(!chatBubbleOpen)}
              title={t('bubble.open')}
            >
              <span className="tab-icon">💬</span>
              {t('bubble.shortTitle')}
              {session.chatMessages.length > 0 && (
                <span className="tab-badge">{session.chatMessages.length}</span>
              )}
            </button>
          )}
          <div className="tabs-spacer" />
          <LanguageSelector />
        </nav>

        <div className="tab-content">
          {activeTab === 'transcripcion' && <TranscriptionView />}
          {activeTab === 'reunion' && <ModePanel mode="reunion" />}
          {activeTab === 'estudio' && <ModePanel mode="estudio" />}
          {activeTab === 'conversacion' && <ModePanel mode="conversacion" />}
        </div>
      </main>
    </div>
  );
}

// ================== helpers ==================
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'sesion';
}

function formatTs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
    return <span className="status status-error" title={error || ''}>{t('app.backendError')}</span>;
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

function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={t('header.toggleTheme')}
      aria-label={t('header.toggleTheme')}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

function GitHubButton() {
  const { t } = useTranslation();
  function open() {
    const url = 'https://github.com/jaguayoara/meet-ninja';
    if (window.meetninja?.openExternal) {
      // En Electron: usar el browser del sistema.
      window.meetninja.openExternal(url);
    } else {
      // Fallback para dev fuera de Electron.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
  return (
    <button
      type="button"
      className="github-btn"
      onClick={open}
      title={t('header.github')}
      aria-label={t('header.github')}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.13c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18.92-.26 1.9-.39 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
      </svg>
    </button>
  );
}
