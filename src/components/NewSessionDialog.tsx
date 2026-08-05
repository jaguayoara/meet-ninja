/**
 * Dialog modal para crear una nueva sesion.
 *
 * Pide un nombre antes de crearla. Si el usuario cancela o presiona Escape,
 * no se crea. Enter submitea. El input tiene autofocus.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/useTranslation';

export function NewSessionDialog({
  open,
  onConfirm,
  onCancel,
  defaultName,
}: {
  open: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  defaultName?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName || '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cada vez que se abre, reseteamos el input y hacemos focus.
  useEffect(() => {
    if (open) {
      setName(defaultName || '');
      // Foco en el siguiente tick para que el autofocus del browser no compita.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, defaultName]);

  if (!open) return null;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="picker-backdrop" onClick={onCancel}>
      <div
        className="picker new-session-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
      >
        <h3 id="new-session-title" className="picker-title">
          {t('sessionMenu.newSessionTitle')}
        </h3>
        <p className="picker-hint">{t('sessionMenu.newSessionHint')}</p>
        <input
          ref={inputRef}
          className="new-session-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={t('sessionMenu.newSessionPlaceholder')}
          maxLength={80}
        />
        <div className="picker-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('recorder.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!name.trim()}
          >
            {t('sessionMenu.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
