/**
 * Estado global con Zustand.
 *
 * Mantiene:
 *  - Audio cargado / grabacion activa.
 *  - Resultado de la transcripcion.
 *  - Estado de UI: tab activo, busqueda, errores.
 *  - Configuracion: modelo whisper, idioma.
 */
import { create } from 'zustand';
import type { Segment, TranscriptionResult } from '../lib/api';

export type Mode = 'reunion' | 'estudio' | 'conversacion';
export type TabId = 'transcripcion' | 'reunion' | 'estudio' | 'conversacion';

export type SummarizeResult = {
  mode: Mode;
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
};

export type SearchState = {
  terms: string;        // string crudo del input
  parsedTerms: string[]; // terminos separados por coma/salto de linea
  mode: 'any' | 'all';
  results: Array<{ term: string; segment_index: number; start: number; end: number; snippet: string }>;
  loading: boolean;
  error: string | null;
  activeMatchIdx: number; // navegacion con flechas
};

type AppState = {
  // backend status
  backendReady: boolean;
  backendError: string | null;
  whisperModel: string;
  whisperAvailable: string[];
  ollamaAvailable: boolean;
  ollamaModel: string;
  ollamaMaxModelB: number;
  ollamaAllowOversize: boolean;

  // audio
  audioBlob: Blob | null;
  audioFileName: string | null;
  audioDuration: number;
  isRecording: boolean;

  // transcripcion
  transcription: TranscriptionResult | null;
  isTranscribing: boolean;
  transcriptionError: string | null;
  progressMsg: string;

  // ui
  activeTab: TabId;

  // resumen por modo
  summaries: Record<Mode, SummarizeResult>;

  // busqueda
  search: SearchState;

  // chat
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  chatLoading: boolean;
  chatError: string | null;

  // setters
  setBackendStatus: (s: Partial<Pick<AppState, 'backendReady' | 'backendError' | 'whisperModel' | 'whisperAvailable' | 'ollamaAvailable' | 'ollamaModel' | 'ollamaMaxModelB' | 'ollamaAllowOversize'>>) => void;
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
  addChatMessage: (msg: { role: 'user' | 'assistant'; content: string }) => void;
  clearChat: () => void;
  setChatLoading: (v: boolean) => void;
  setChatError: (e: string | null) => void;
  reset: () => void;
};

const emptySummary = (): SummarizeResult => ({
  mode: 'reunion',
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

const initialChat = {
  chatMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  chatLoading: false,
  chatError: null as string | null,
};

export const useAppStore = create<AppState>((set) => ({
  backendReady: false,
  backendError: null,
  whisperModel: 'small',
  whisperAvailable: ['tiny', 'base', 'small', 'medium', 'large-v3'],
  ollamaAvailable: false,
  ollamaModel: '',
  ollamaMaxModelB: 4,
  ollamaAllowOversize: false,

  audioBlob: null,
  audioFileName: null,
  audioDuration: 0,
  isRecording: false,

  transcription: null,
  isTranscribing: false,
  transcriptionError: null,
  progressMsg: '',

  activeTab: 'transcripcion',

  summaries: {
    reunion: emptySummary(),
    estudio: emptySummary(),
    conversacion: emptySummary(),
  },

  search: initialSearch,
  ...initialChat,

  setBackendStatus: (s) => set((st) => ({ ...st, ...s })),
  setAudio: (blob, name, duration = 0) =>
    set(() => ({
      audioBlob: blob,
      audioFileName: name,
      audioDuration: duration,
      // resetear transcripcion previa
      transcription: null,
      transcriptionError: null,
      summaries: {
        reunion: emptySummary(),
        estudio: emptySummary(),
        conversacion: emptySummary(),
      },
      search: initialSearch,
      chatMessages: [],
      chatLoading: false,
      chatError: null,
    })),
  setRecording: (v) => set(() => ({ isRecording: v })),
  setWhisperModel: (m) => set(() => ({ whisperModel: m })),
  setTranscription: (r) => set(() => ({ transcription: r })),
  setIsTranscribing: (v) => set(() => ({ isTranscribing: v })),
  setTranscriptionError: (e) => set(() => ({ transcriptionError: e })),
  setProgressMsg: (m) => set(() => ({ progressMsg: m })),
  setActiveTab: (t) => set(() => ({ activeTab: t })),
  setSummary: (mode, partial) =>
    set((st) => ({
      summaries: {
        ...st.summaries,
        [mode]: { ...st.summaries[mode], mode, ...partial },
      },
    })),
  setSearchTerms: (s) => {
    const parsed = s
      .split(/[,\n;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    set((st) => ({
      search: { ...st.search, terms: s, parsedTerms: parsed },
    }));
  },
  setSearchMode: (m) =>
    set((st) => ({ search: { ...st.search, mode: m } })),
  setSearchResults: (results, error = null) =>
    set((st) => ({
      search: { ...st.search, results, error, activeMatchIdx: 0, loading: false },
    })),
  setSearchLoading: (v) =>
    set((st) => ({ search: { ...st.search, loading: v } })),
  setActiveMatch: (i) =>
    set((st) => ({ search: { ...st.search, activeMatchIdx: i } })),
  addChatMessage: (msg) =>
    set((st) => ({ chatMessages: [...st.chatMessages, msg] })),
  clearChat: () =>
    set(() => ({ chatMessages: [], chatError: null })),
  setChatLoading: (v) => set(() => ({ chatLoading: v })),
  setChatError: (e) => set(() => ({ chatError: e })),
  reset: () =>
    set(() => ({
      audioBlob: null,
      audioFileName: null,
      audioDuration: 0,
      isRecording: false,
      transcription: null,
      isTranscribing: false,
      transcriptionError: null,
      progressMsg: '',
      activeTab: 'transcripcion',
      summaries: {
        reunion: emptySummary(),
        estudio: emptySummary(),
        conversacion: emptySummary(),
      },
      search: initialSearch,
      chatMessages: [],
      chatLoading: false,
      chatError: null,
    })),
}));

// Helpers
export function parseSegments(trans: TranscriptionResult | null): Segment[] {
  if (!trans) return [];
  return trans.segments;
}
