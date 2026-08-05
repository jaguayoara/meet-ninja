/**
 * Cliente HTTP para el backend Python local.
 * Apunta a la URL que el preload nos devolvio (electron-updater / IPC).
 *
 * En dev, el backend se arranca via `npm run dev` que ejecuta uvicorn
 * en 127.0.0.1:8765. En prod, Electron lo spawnea al iniciar.
 */

let baseUrl: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (baseUrl) return baseUrl;
  // En Electron, el preload expone getPythonUrl.
  if (typeof window !== 'undefined' && window.meetninja) {
    baseUrl = await window.meetninja.getPythonUrl();
  } else {
    // Dev fuera de Electron (vite serve solo).
    baseUrl = 'http://127.0.0.1:8765';
  }
  return baseUrl;
}

export type Segment = { start: number; end: number; text: string };

export type TranscriptionResult = {
  language: string;
  language_probability: number;
  duration: number;
  text: string;
  segments: Segment[];
  model: string;
};

export type HealthResponse = {
  ok: boolean;
  whisper: { default_model: string; available_models: string[] };
  ollama: { available: boolean; url: string; model: string; max_model_b: number; allow_oversize: boolean };
  ffmpeg: string | null;
  python: string;
};

export type SearchMatch = {
  term: string;
  segment_index: number;
  start: number;
  end: number;
  snippet: string;
  full_segment_text: string;
};

export async function health(): Promise<HealthResponse> {
  const r = await fetch(`${await getBaseUrl()}/health`);
  if (!r.ok) throw new Error(`health failed: ${r.status}`);
  return r.json();
}

export async function transcribe(opts: {
  file: Blob | File;
  model?: string;
  language?: string;
  onProgress?: (msg: string) => void;
}): Promise<TranscriptionResult> {
  const fd = new FormData();
  fd.append('file', opts.file, 'audio.webm');
  if (opts.model) fd.append('model', opts.model);
  if (opts.language) fd.append('language', opts.language);

  opts.onProgress?.('Subiendo audio...');

  const r = await fetch(`${await getBaseUrl()}/transcribe`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j.detail || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  opts.onProgress?.('Procesando transcripcion...');
  return r.json();
}

export async function summarize(text: string, mode: string): Promise<unknown> {
  const r = await fetch(`${await getBaseUrl()}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j.detail || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function search(opts: {
  segments: Segment[];
  terms: string[];
  mode?: 'any' | 'all';
  contextChars?: number;
}): Promise<{ ok: boolean; count: number; matches: SearchMatch[] }> {
  const r = await fetch(`${await getBaseUrl()}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments: opts.segments,
      terms: opts.terms,
      mode: opts.mode || 'any',
      context_chars: opts.contextChars ?? 80,
    }),
  });
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  return r.json();
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export async function chat(opts: {
  transcript: string;
  question: string;
  history?: ChatMessage[];
}): Promise<{ ok: boolean; answer: string }> {
  const r = await fetch(`${await getBaseUrl()}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: opts.transcript,
      question: opts.question,
      history: opts.history || [],
    }),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j.detail || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return r.json();
}
