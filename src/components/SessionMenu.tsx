/**
 * Pantalla principal cuando no hay sesion activa (o para gestionar
 * multiples sesiones).
 *
 * Muestra:
 *  - Header con estado del backend
 *  - Lista de sesiones existentes (cards) con: nombre, fecha, duracion,
 *    idioma detectado, cantidad de segmentos, status (transcrito / pendiente)
 *  - Boton principal "Nueva sesion"
 *  - Acciones por sesion: abrir, renombrar, borrar
 */
import { useState } from 'react';
import { useAppStore, type Session } from '../store/useAppStore';
import { useTranslation } from '../i18n/useTranslation';
import { humanSize } from '../lib/format';

function formatDate(ts: number, lang: 'es' | 'en' | 'pt'): string {
  try {
    return new Date(ts).toLocaleString(
      lang === 'es' ? 'es-CL' : lang === 'pt' ? 'pt-BR' : 'en-US',
      { dateStyle: 'short', timeStyle: 'short' },
    );
  } catch {
    return new Date(ts).toISOString();
  }
}

function SessionCard({
  session,
  onOpen,
  onRename,
  onDelete,
}: {
  session: Session;
  onOpen: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const { t, lang } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);

  const hasTrans = !!session.transcription;
  const segCount = session.transcription?.segments.length ?? 0;
  const langProb = session.transcription?.language;
  const langProbPct = session.transcription
    ? Math.round(session.transcription.language_probability * 100)
    : 0;
  const wordCount = session.transcription?.text.trim().split(/\s+/).filter(Boolean).length ?? 0;

  return (
    <div className="session-card" onClick={editing ? undefined : onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !editing) onOpen(); }}>
      <div className="session-card-head">
        {editing ? (
          <input
            className="session-rename-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (draft.trim()) onRename(draft.trim());
                setEditing(false);
              } else if (e.key === 'Escape') {
                setDraft(session.name);
                setEditing(false);
              }
            }}
            onBlur={() => {
              if (draft.trim() && draft.trim() !== session.name) onRename(draft.trim());
              setEditing(false);
            }}
          />
        ) : (
          <h3 className="session-card-title">{session.name}</h3>
        )}
        <div className="session-card-actions" onClick={(e) => e.stopPropagation()}>
          {!editing && (
            <button
              type="button"
              className="icon-btn"
              title={t('sessionMenu.rename')}
              onClick={() => { setDraft(session.name); setEditing(true); }}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            title={t('sessionMenu.delete')}
            onClick={() => {
              if (confirm(t('sessionMenu.confirmDelete', { name: session.name }))) {
                onDelete();
              }
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="session-card-meta">
        <span className="session-meta-item">
          {formatDate(session.updatedAt, lang)}
        </span>
        {session.audioFileName && (
          <span className="session-meta-item" title={session.audioFileName}>
            🎵 {session.audioFileName.length > 30
              ? session.audioFileName.slice(0, 27) + '…'
              : session.audioFileName}
          </span>
        )}
        {session.audioBlob && (
          <span className="session-meta-item">
            {humanSize(session.audioBlob.size)}
            {session.audioDuration > 0 && ` · ${session.audioDuration.toFixed(1)}s`}
          </span>
        )}
        {!session.audioBlob && session.audioFileName && (
          <span className="session-meta-item session-meta-warn">
            ⚠ {t('sessionMenu.audioMissing')}
          </span>
        )}
      </div>

      <div className="session-card-stats">
        {hasTrans ? (
          <>
            <span className="session-stat session-stat-ok">
              ✓ {t('sessionMenu.transcribed')}
            </span>
            <span className="session-stat">
              {segCount} {t('sessionMenu.segments')}
            </span>
            <span className="session-stat">
              {wordCount} {t('sessionMenu.words')}
            </span>
            {langProb && (
              <span className="session-stat" title={`${langProb} (${langProbPct}%)`}>
                🌐 {langProb.toUpperCase()}
              </span>
            )}
            <span className="session-stat">
              💬 {session.chatMessages.length}
            </span>
          </>
        ) : session.audioBlob ? (
          <span className="session-stat session-stat-pending">
            ⏳ {t('sessionMenu.pendingTranscribe')}
          </span>
        ) : session.audioFileName ? (
          <span className="session-stat session-stat-warn">
            ⚠ {t('sessionMenu.audioMissing')}
          </span>
        ) : (
          <span className="session-stat session-stat-empty">
            ○ {t('sessionMenu.empty')}
          </span>
        )}
      </div>
    </div>
  );
}

export function SessionMenu() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const sessionOrder = useAppStore((s) => s.sessionOrder);
  const createSession = useAppStore((s) => s.createSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const renameSession = useAppStore((s) => s.renameSession);

  const list = sessionOrder
    .map((id) => sessions[id])
    .filter((s): s is Session => !!s);

  return (
    <div className="session-menu">
      <div className="session-menu-header">
        <h1 className="session-menu-title">{t('sessionMenu.title')}</h1>
        <p className="session-menu-subtitle">{t('sessionMenu.subtitle')}</p>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-lg session-new-btn"
        onClick={() => createSession()}
      >
        ＋ {t('sessionMenu.newSession')}
      </button>

      {list.length === 0 ? (
        <div className="session-empty">
          <p>{t('sessionMenu.emptyState')}</p>
        </div>
      ) : (
        <div className="session-grid">
          {list.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onOpen={() => setCurrentSession(s.id)}
              onRename={(name) => renameSession(s.id, name)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
