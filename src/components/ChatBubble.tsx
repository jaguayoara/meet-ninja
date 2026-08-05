/**
 * ChatBubble - panel flotante estilo Instagram Web.
 *
 * Es un chat de Search + Chat con la transcripcion que aparece como
 * burbuja abajo a la derecha cuando se minimiza. Se puede:
 *  - Expandir / minimizar
 *  - Switchear entre tabs Buscar y Conversar
 *  - Cerrar (vuelve a la burbuja)
 *
 * Solo se monta cuando hay una sesion activa con transcripcion.
 */
import { useAppStore, useCurrentSession } from '../store/useAppStore';
import { SearchPanel } from './SearchPanel';
import { ChatPanel } from './ChatPanel';
import { useTranslation } from '../i18n/useTranslation';

export function ChatBubble() {
  const { t } = useTranslation();
  const session = useCurrentSession();
  const open = useAppStore((s) => s.chatBubbleOpen);
  const tab = useAppStore((s) => s.chatBubbleTab);
  const setOpen = useAppStore((s) => s.setChatBubbleOpen);
  const setTab = useAppStore((s) => s.setChatBubbleTab);

  // Solo mostrar si hay transcripcion en la sesion activa
  if (!session?.transcription) return null;

  // Badge: numero de mensajes de chat o matches de busqueda recientes.
  const badge = tab === 'chat' ? session.chatMessages.length : session.search.results.length;

  if (!open) {
    return (
      <button
        type="button"
        className="chat-bubble-fab"
        onClick={() => setOpen(true)}
        title={t('bubble.open')}
        aria-label={t('bubble.open')}
      >
        <span className="chat-bubble-fab-icon" aria-hidden="true">💬</span>
        {badge > 0 && <span className="chat-bubble-fab-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  }

  return (
    <div className="chat-bubble" role="dialog" aria-label={t('bubble.title')}>
      <div className="chat-bubble-header">
        <div className="chat-bubble-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={'chat-bubble-tab' + (tab === 'chat' ? ' is-active' : '')}
            onClick={() => setTab('chat')}
          >
            💬 {t('bubble.tabChat')}
            {session.chatMessages.length > 0 && (
              <span className="chat-bubble-tab-count">{session.chatMessages.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'search'}
            className={'chat-bubble-tab' + (tab === 'search' ? ' is-active' : '')}
            onClick={() => setTab('search')}
          >
            🔍 {t('bubble.tabSearch')}
            {session.search.results.length > 0 && (
              <span className="chat-bubble-tab-count">{session.search.results.length}</span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="chat-bubble-close"
          onClick={() => setOpen(false)}
          aria-label={t('bubble.minimize')}
          title={t('bubble.minimize')}
        >
          ✕
        </button>
      </div>
      <div className="chat-bubble-body">
        {tab === 'chat' ? <ChatPanel /> : <SearchPanel />}
      </div>
    </div>
  );
}
