/**
 * Chat con la transcripcion (RAG basico).
 *
 * El usuario hace preguntas al LLM local, que tiene la transcripcion
 * completa como contexto. Mantiene historial de la conversacion en
 * memoria (no persistido).
 *
 * El LLM responde solo basandose en la transcripcion, con instrucciones
 * explicitas de no usar conocimiento externo.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { chat } from '../lib/api';
import { useTranslation } from '../i18n/useTranslation';

export function ChatPanel() {
  const { t } = useTranslation();
  const transcription = useAppStore((s) => s.transcription);
  const messages = useAppStore((s) => s.chatMessages);
  const loading = useAppStore((s) => s.chatLoading);
  const error = useAppStore((s) => s.chatError);
  const addMessage = useAppStore((s) => s.addChatMessage);
  const clearChat = useAppStore((s) => s.clearChat);
  const setLoading = useAppStore((s) => s.setChatLoading);
  const setError = useAppStore((s) => s.setChatError);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // autoscroll al final cuando hay mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!transcription) {
    return <p className="hint">{t('chat.empty')}</p>;
  }

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setError(null);
    addMessage({ role: 'user', content: q });
    setLoading(true);
    try {
      const r = await chat({
        transcript: transcription!.text,
        question: q,
        history: messages,
      });
      addMessage({ role: 'assistant', content: r.answer });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addMessage({
        role: 'assistant',
        content: `Error: ${msg}. El LLM local quizas este arrancando (primera vez tarda ~30s).`,
      });
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>{t('chat.title')}</h3>
        <p className="chat-hint">{t('chat.hint')}</p>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>{t('chat.examples')}</p>
            <ul>
              <li>¿Quien se encarga de la seccion 2?</li>
              <li>¿Cuando es la proxima reunion?</li>
              <li>¿Que tareas tienen asignadas?</li>
              <li>Resume los puntos principales.</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-${m.role}`}>
            <div className="chat-bubble-label">
              {m.role === 'user' ? t('chat.you') : t('chat.llm')}
            </div>
            <div className="chat-bubble-text">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble chat-assistant chat-loading">
            <div className="chat-bubble-label">{t('chat.llm')}</div>
            <div className="chat-bubble-text">
              <span className="chat-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>
              {t('chat.thinking')}
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder={t('chat.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={loading}
        />
        <div className="chat-buttons">
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={!input.trim() || loading}
            type="button"
          >
            {t('chat.send')}
          </button>
          {messages.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearChat}
              disabled={loading}
              type="button"
            >
              {t('chat.clear')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
