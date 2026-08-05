/**
 * Estado global con Zustand.
 *
 * Maneja multiples sesiones concurrentes. Cada sesion guarda:
 *   - Audio (blob + nombre + duracion)
 *   - Transcripcion + estado de progreso
 *   - Summaries por modo
 *   - Search y Chat
 *   - Modelo whisper elegido
 *
 * Estado global (no por sesion):
 *   - Backend health (whisper, ollama, llm local)
 *   - Idioma de UI
 *   - Lista de sesiones y sesion activa
 *   - Estado del ChatBubble flotante
 *
 * Persistencia:
 *   - Metadata + transcripcion + summaries + chat en localStorage
 *   - Blobs de audio SOLO en memoria (se pierden al cerrar la app;
 *     el usuario puede re-grabar o re-cargar el archivo).
 */
import { create } from 'zustand';
import type { Segment, TranscriptionResult } from '../lib/api';
import { saveAudio, loadAudio, deleteAudio } from '../lib/idb';

export type Mode = 'reunion' | 'estudio' | 'conversacion';
export type TabId = 'transcripcion' | 'reunion' | 'estudio' | 'conversacion';
export type Lang = 'es' | 'en' | 'pt';

export type SummarizeResult = {
  mode: Mode;
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
};

export type SearchState = {
  terms: string;
  parsedTerms: string[];
  mode: 'any' | 'all';
  results: Array<{ term: string; segment_index: number; start: number; end: number; snippet: string }>;
  loading: boolean;
  error: string | null;
  activeMatchIdx: number;
};

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

export type Session = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  audioBlob: Blob | null;
  audioFileName: string | null;
  audioDuration: number;
  isRecording: boolean;
  transcription: TranscriptionResult | null;
  isTranscribing: boolean;
  transcriptionError: string | null;
  progressMsg: string;
  whisperModel: string;
  activeTab: TabId;
  summaries: Record<Mode, SummarizeResult>;
  search: SearchState;
  chatMessages: ChatMsg[];
  chatLoading: boolean;
  chatError: string | null;
};

const STORAGE_KEY = 'meetninja.sessions.v1';
const LANG_KEY = 'meetninja.lang';
const LEGACY_CURRENT_KEY = 'meetninja.currentSession.v1';
const THEME_KEY = 'meetninja.theme';

export type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Fallback: respetar el sistema operativo.
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

const emptySummary = (mode: Mode): SummarizeResult => ({
  mode,
  data: null,
  loading: false,
  error: null,
});

const initialSearch: SearchState = {
  terms: '',
  parsedTerms: [],
  mode: 'any',
  results: [],
  loading: false,
  error: null,
  activeMatchIdx: 0,
};

function makeSession(partial: Partial<Session> = {}, whisperModel = 'small'): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: 'Nueva sesion',
    createdAt: now,
    updatedAt: now,
    audioBlob: null,
    audioFileName: null,
    audioDuration: 0,
    isRecording: false,
    transcription: null,
    isTranscribing: false,
    transcriptionError: null,
    progressMsg: '',
    whisperModel,
    activeTab: 'transcripcion',
    summaries: {
      reunion: emptySummary('reunion'),
      estudio: emptySummary('estudio'),
      conversacion: emptySummary('conversacion'),
    },
    search: { ...initialSearch },
    chatMessages: [],
    chatLoading: false,
    chatError: null,
    ...partial,
  };
}

/** Serializa una sesion para localStorage (sin el audioBlob). */
function serializeSession(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    audioFileName: s.audioFileName,
    audioDuration: s.audioDuration,
    hasAudio: s.audioBlob != null,
    transcription: s.transcription,
    isTranscribing: false,
    transcriptionError: s.transcriptionError,
    progressMsg: '',
    whisperModel: s.whisperModel,
    activeTab: s.activeTab,
    summaries: s.summaries,
    search: s.search,
    chatMessages: s.chatMessages,
    chatLoading: false,
    chatError: s.chatError,
  };
}

function deserializeSession(o: Record<string, unknown>): Session {
  return makeSession({
    id: o.id as string,
    name: (o.name as string) || 'Nueva sesion',
    createdAt: (o.createdAt as number) || Date.now(),
    updatedAt: (o.updatedAt as number) || Date.now(),
    audioBlob: null, // Blobs no persisten
    audioFileName: (o.audioFileName as string | null) ?? null,
    audioDuration: (o.audioDuration as number) || 0,
    transcription: (o.transcription as TranscriptionResult | null) ?? null,
    isTranscribing: false,
    transcriptionError: (o.transcriptionError as string | null) ?? null,
    progressMsg: '',
    whisperModel: (o.whisperModel as string) || 'small',
    activeTab: (o.activeTab as TabId) || 'transcripcion',
    summaries: (o.summaries as Session['summaries']) || {
      reunion: emptySummary('reunion'),
      estudio: emptySummary('estudio'),
      conversacion: emptySummary('conversacion'),
    },
    search: (o.search as SearchState) || { ...initialSearch },
    chatMessages: (o.chatMessages as ChatMsg[]) || [],
    chatLoading: false,
    chatError: (o.chatError as string | null) ?? null,
  });
}

function loadFromStorage(): { sessions: Session[] } {
  if (typeof localStorage === 'undefined') return { sessions: [] };
  // Limpieza one-shot: borrar el currentSession viejo para que la app
  // siempre arranque en el menu de sesiones, no en la ultima sesion abierta.
  try { localStorage.removeItem(LEGACY_CURRENT_KEY); } catch { /* noop */ }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [] };
    const arr = JSON.parse(raw) as Record<string, unknown>[];
    const sessions = arr.map(deserializeSession);
    return { sessions };
  } catch {
    return { sessions: [] };
  }
}

/**
 * Despues de cargar el state desde localStorage, hidrata los Blobs de
 * audio desde IndexedDB. Asincrona, se dispara una sola vez al montar.
 */
async function hydrateAudio(sessions: Session[]): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  await Promise.all(
    sessions.map(async (s) => {
      const stored = await loadAudio(s.id);
      if (stored) out[s.id] = stored.blob;
    }),
  );
  return out;
}

function saveToStorage(sessions: Session[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    const arr = sessions.map(serializeSession);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage lleno o no disponible, ignorar
  }
}

type AppState = {
  // ---- backend (global) ----
  backendReady: boolean;
  backendError: string | null;
  whisperModel: string;
  whisperAvailable: string[];
  ollamaAvailable: boolean;
  ollamaModel: string;
  ollamaMaxModelB: number;
  ollamaAllowOversize: boolean;

  // ---- sessions ----
  sessions: Record<string, Session>;
  sessionOrder: string[];
  currentSessionId: string | null;

  // ---- chat bubble UI ----
  chatBubbleOpen: boolean;
  chatBubbleTab: 'search' | 'chat';

  // ---- ui lang ----
  uiLang: Lang;

  // ---- theme ----
  theme: Theme;

  // ---- actions: backend ----
  setBackendStatus: (s: Partial<Pick<AppState,
    'backendReady' | 'backendError' | 'whisperModel' | 'whisperAvailable' |
    'ollamaAvailable' | 'ollamaModel' | 'ollamaMaxModelB' | 'ollamaAllowOversize'
  >>) => void;

  // ---- actions: sessions ----
  createSession: (name?: string) => string;
  deleteSession: (id: string) => void;
  setCurrentSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  resetCurrent: () => void;
  importSession: (data: ImportableSession) => Promise<string>;
  exportCurrent: () => Promise<ImportableSession | null>;

  // ---- actions: current session data (operan sobre la sesion activa) ----
  setAudio: (blob: Blob | null, name: string | null, duration?: number) => void;
  setRecording: (v: boolean) => void;
  setWhisperModel: (m: string) => void;
  setTranscription: (r: TranscriptionResult | null) => void;
  setIsTranscribing: (v: boolean) => void;
  setTranscriptionError: (e: string | null) => void;
  setProgressMsg: (m: string) => void;
  setActiveTab: (t: TabId) => void;
  setSummary: (mode: Mode, partial: Partial<SummarizeResult>) => void;
  setSearchTerms: (s: string) => void;
  setSearchMode: (m: 'any' | 'all') => void;
  setSearchResults: (results: SearchState['results'], error?: string | null) => void;
  setSearchLoading: (v: boolean) => void;
  setActiveMatch: (i: number) => void;
  addChatMessage: (msg: ChatMsg) => void;
  clearChat: () => void;
  setChatLoading: (v: boolean) => void;
  setChatError: (e: string | null) => void;

  // ---- actions: chat bubble UI ----
  setChatBubbleOpen: (v: boolean) => void;
  toggleChatBubble: () => void;
  setChatBubbleTab: (t: 'search' | 'chat') => void;

  // ---- actions: ui lang ----
  setUiLang: (lang: Lang) => void;

  // ---- actions: theme ----
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

// --------------------------- helpers ---------------------------

/** Estructura de un archivo .meetninja.json exportado. */
export type ImportableSession = {
  __format: 'meetninja-session';
  __version: 1;
  meta: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
  };
  session: Omit<Session, 'audioBlob'>;
  audioBase64: string | null; // data:audio/webm;base64,... o null si no hay
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const m = /data:([^;]+);base64/.exec(meta);
  const mime = m ? m[1] : 'application/octet-stream';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// --------------------------- store ---------------------------

function mutateCurrent(
  state: AppState,
  fn: (s: Session) => Partial<Session>,
): Partial<AppState> {
  if (!state.currentSessionId) return {};
  const cur = state.sessions[state.currentSessionId];
  if (!cur) return {};
  const updated = { ...cur, ...fn(cur), updatedAt: Date.now() };
  return {
    sessions: { ...state.sessions, [cur.id]: updated },
  };
}

// --------------------------- store ---------------------------

const initial = loadFromStorage();
const initialMap: Record<string, Session> = {};
for (const s of initial.sessions) initialMap[s.id] = s;
const initialOrder = initial.sessions
  .sort((a, b) => b.updatedAt - a.updatedAt)
  .map((s) => s.id);

export const useAppStore = create<AppState>((set, get) => ({
  backendReady: false,
  backendError: null,
  whisperModel: 'small',
  whisperAvailable: ['tiny', 'base', 'small', 'medium', 'large-v3'],
  ollamaAvailable: false,
  ollamaModel: '',
  ollamaMaxModelB: 4,
  ollamaAllowOversize: false,

  sessions: initialMap,
  sessionOrder: initialOrder,
  // Importante: la app SIEMPRE arranca en el menu de sesiones, aunque
  // haya sesiones persistidas. El usuario elige explicitamente cual abrir.
  currentSessionId: null,

  chatBubbleOpen: false,
  chatBubbleTab: 'chat',

  uiLang: (typeof localStorage !== 'undefined' ? (localStorage.getItem(LANG_KEY) as Lang | null) : null) || 'es',

  theme: getInitialTheme(),

  setBackendStatus: (s) => set((st) => ({ ...st, ...s })),

  createSession: (name) => {
    const s = makeSession({ name: name || 'Nueva sesion' });
    set((st) => {
      const sessions = { ...st.sessions, [s.id]: s };
      const order = [s.id, ...st.sessionOrder];
      saveToStorage(Object.values(sessions));
      return {
        sessions,
        sessionOrder: order,
        currentSessionId: s.id,
        chatBubbleOpen: false,
      };
    });
    return s.id;
  },

  deleteSession: (id) => {
    deleteAudio(id);
    set((st) => {
      const { [id]: _, ...rest } = st.sessions;
      const order = st.sessionOrder.filter((x) => x !== id);
      const nextCurrent =
        st.currentSessionId === id
          ? (order[0] ?? null)
          : st.currentSessionId;
      saveToStorage(Object.values(rest));
      return {
        sessions: rest,
        sessionOrder: order,
        currentSessionId: nextCurrent,
      };
    });
  },

  setCurrentSession: (id) => {
    set((st) => {
      // id vacio o null = volver al menu de sesiones
      if (!id) {
        saveToStorage(Object.values(st.sessions));
        return { currentSessionId: null, chatBubbleOpen: false };
      }
      if (!st.sessions[id]) return st;
      saveToStorage(Object.values(st.sessions));
      return { currentSessionId: id, chatBubbleOpen: false };
    });
  },

  renameSession: (id, name) =>
    set((st) => {
      const cur = st.sessions[id];
      if (!cur) return st;
      const updated = { ...cur, name, updatedAt: Date.now() };
      const sessions = { ...st.sessions, [id]: updated };
      saveToStorage(Object.values(sessions));
      return { sessions };
    }),

  resetCurrent: () => {
    const id = get().currentSessionId;
    if (id) deleteAudio(id);
    set((st) => {
      if (!st.currentSessionId) return st;
      const cur = st.sessions[st.currentSessionId];
      if (!cur) return st;
      const reset = makeSession(
        { whisperModel: cur.whisperModel, name: cur.name },
        cur.whisperModel,
      );
      // Mantener id y timestamps.
      const updated: Session = { ...reset, id: cur.id, createdAt: cur.createdAt };
      const sessions = { ...st.sessions, [cur.id]: updated };
      saveToStorage(Object.values(sessions));
      return { sessions };
    });
  },

  // ---- current session setters ----
  setAudio: (blob, name, duration = 0) => {
    const id = get().currentSessionId;
    if (id && blob) {
      // Persistir el blob en IndexedDB (fire-and-forget, no bloquea el state).
      saveAudio(id, blob).catch(() => undefined);
    }
    set((st) => {
      const next = mutateCurrent(st, () => ({
        audioBlob: blob,
        audioFileName: name,
        audioDuration: duration,
        transcription: null,
        transcriptionError: null,
        summaries: {
          reunion: emptySummary('reunion'),
          estudio: emptySummary('estudio'),
          conversacion: emptySummary('conversacion'),
        },
        search: { ...initialSearch },
        chatMessages: [],
        chatLoading: false,
        chatError: null,
      }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    });
  },

  setRecording: (v) => set((st) => mutateCurrent(st, () => ({ isRecording: v }))),

  setWhisperModel: (m) =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ whisperModel: m }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  setTranscription: (r) =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ transcription: r }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  setIsTranscribing: (v) => set((st) => mutateCurrent(st, () => ({ isTranscribing: v }))),
  setTranscriptionError: (e) =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ transcriptionError: e }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),
  setProgressMsg: (m) => set((st) => mutateCurrent(st, () => ({ progressMsg: m }))),
  setActiveTab: (t) =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ activeTab: t }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  setSummary: (mode, partial) =>
    set((st) => {
      const next = mutateCurrent(st, (s) => ({
        summaries: {
          ...s.summaries,
          [mode]: { ...s.summaries[mode], mode, ...partial },
        },
      }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  setSearchTerms: (s) =>
    set((st) => {
      const parsed = s
        .split(/[,\n;]/)
        .map((t) => t.trim())
        .filter(Boolean);
      return mutateCurrent(st, (cur) => ({
        search: { ...cur.search, terms: s, parsedTerms: parsed },
      }));
    }),

  setSearchMode: (m) =>
    set((st) => mutateCurrent(st, (cur) => ({
      search: { ...cur.search, mode: m },
    }))),

  setSearchResults: (results, error = null) =>
    set((st) => mutateCurrent(st, (cur) => ({
      search: { ...cur.search, results, error, activeMatchIdx: 0, loading: false },
    }))),

  setSearchLoading: (v) =>
    set((st) => mutateCurrent(st, (cur) => ({
      search: { ...cur.search, loading: v },
    }))),

  setActiveMatch: (i) =>
    set((st) => mutateCurrent(st, (cur) => ({
      search: { ...cur.search, activeMatchIdx: i },
    }))),

  addChatMessage: (msg) =>
    set((st) => {
      const next = mutateCurrent(st, (cur) => ({
        chatMessages: [...cur.chatMessages, msg],
      }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  clearChat: () =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ chatMessages: [], chatError: null }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  setChatLoading: (v) => set((st) => mutateCurrent(st, () => ({ chatLoading: v }))),
  setChatError: (e) =>
    set((st) => {
      const next = mutateCurrent(st, () => ({ chatError: e }));
      saveToStorage(Object.values({ ...st.sessions, ...next.sessions }));
      return next;
    }),

  // ---- chat bubble ----
  setChatBubbleOpen: (v) => set(() => ({ chatBubbleOpen: v })),
  toggleChatBubble: () => set((st) => ({ chatBubbleOpen: !st.chatBubbleOpen })),
  setChatBubbleTab: (t) => set(() => ({ chatBubbleTab: t })),

  // ---- ui lang ----
  setUiLang: (lang) => {
    set(() => ({ uiLang: lang }));
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* noop */ }
    }
  },

  // ---- theme ----
  setTheme: (theme) => {
    set(() => ({ theme }));
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* noop */ }
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  },
  toggleTheme: () => {
    const cur = get().theme;
    const next: Theme = cur === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  // ---- import / export ----
  exportCurrent: async () => {
    const st = get();
    if (!st.currentSessionId) return null;
    const cur = st.sessions[st.currentSessionId];
    if (!cur) return null;
    const audioBase64 = cur.audioBlob ? await blobToBase64(cur.audioBlob) : null;
    const { audioBlob: _omit, ...rest } = cur;
    return {
      __format: 'meetninja-session',
      __version: 1,
      meta: {
        id: cur.id,
        name: cur.name,
        createdAt: cur.createdAt,
        updatedAt: cur.updatedAt,
      },
      session: rest,
      audioBase64,
    };
  },

  importSession: async (data) => {
    if (data.__format !== 'meetninja-session') {
      throw new Error('Formato de archivo no valido');
    }
    // Reconstruir el Blob a partir del data URL.
    let audioBlob: Blob | null = null;
    if (data.audioBase64) {
      try {
        audioBlob = base64ToBlob(data.audioBase64);
      } catch {
        audioBlob = null;
      }
    }
    // Mezclar el session importado con defaults por si faltan campos.
    const imported: Session = makeSession({
      ...data.session,
      id: data.meta.id,
      name: data.meta.name,
      createdAt: data.meta.createdAt,
      updatedAt: data.meta.updatedAt,
      audioBlob,
    });
    // Si el id ya existe, generar uno nuevo (no pisamos sesiones existentes).
    const st = get();
    if (st.sessions[imported.id]) {
      imported.id = crypto.randomUUID();
    }
    if (audioBlob) {
      await saveAudio(imported.id, audioBlob);
    }
    set((s) => {
      const sessions = { ...s.sessions, [imported.id]: imported };
      const order = [imported.id, ...s.sessionOrder];
      saveToStorage(Object.values(sessions));
      return {
        sessions,
        sessionOrder: order,
        currentSessionId: imported.id,
        chatBubbleOpen: false,
      };
    });
    return imported.id;
  },
}));

// ---- selectors helpers ----
export function useCurrentSession(): Session | null {
  return useAppStore((s) =>
    s.currentSessionId ? s.sessions[s.currentSessionId] : null,
  );
}

/**
 * Restaura los Blobs de audio desde IndexedDB para todas las sesiones
 * que estan en el state. Llamar una sola vez al arrancar la app.
 */
export async function hydrateAudioFromIDB(): Promise<void> {
  const st = useAppStore.getState();
  const ids = Object.keys(st.sessions);
  if (ids.length === 0) return;
  const map = await hydrateAudio(Object.values(st.sessions));
  const entries = Object.entries(map);
  if (entries.length === 0) return;
  useAppStore.setState((s) => {
    const sessions = { ...s.sessions };
    for (const [id, blob] of entries) {
      if (sessions[id]) {
        sessions[id] = { ...sessions[id], audioBlob: blob };
      }
    }
    return { sessions };
  });
}

// ---- helpers ----
export function parseSegments(trans: TranscriptionResult | null): Segment[] {
  if (!trans) return [];
  return trans.segments;
}


