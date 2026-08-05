/**
 * Sistema simple de i18n para Meet Ninja.
 *
 * Soporta: espanol (default), ingles, portugues (brasil).
 * Persiste la preferencia en localStorage.
 *
 * Para agregar un nuevo idioma: agregar clave 'pt' (o el codigo) abajo
 * con la misma estructura, y agregarlo al type Lang.
 */

export type Lang = 'es' | 'en' | 'pt';

export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: 'es', label: 'Espanol', native: 'Espanol' },
  { code: 'en', label: 'English',  native: 'English' },
  { code: 'pt', label: 'Portugues', native: 'Portugues' },
];

export const DEFAULT_LANG: Lang = 'es';

const STORAGE_KEY = 'meetninja.lang';

export function getStoredLang(): Lang {
  if (typeof localStorage === 'undefined') return DEFAULT_LANG;
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'es' || v === 'en' || v === 'pt') return v;
  return DEFAULT_LANG;
}

export function setStoredLang(lang: Lang): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, lang);
  }
}

// Idiomas disponibles para traducir la transcripcion.
// El "auto" detecta el idioma de origen.
export const TRANSLATE_TARGETS: { code: string; label: string }[] = [
  { code: 'es',    label: 'Espanol' },
  { code: 'en',    label: 'English' },
  { code: 'pt',    label: 'Portugues (Brasil)' },
  { code: 'pt-PT', label: 'Portugues (Portugal)' },
  { code: 'fr',    label: 'Frances' },
  { code: 'de',    label: 'Aleman' },
  { code: 'it',    label: 'Italiano' },
  { code: 'zh',    label: 'Chino' },
  { code: 'ja',    label: 'Japones' },
];

type Dict = Record<string, string>;

const es: Dict = {
  // header
  'app.title': 'Meet Ninja',
  'header.newSession': 'Nueva sesion',
  'header.backendOk': 'Backend OK',
  'header.ollamaYes': 'Ollama: {model} (<={cap}B)',
  'header.ollamaNo': 'Ollama: no',
  'header.ollamaTitle': 'Ollama: {model}',

  // sidebar / cards
  'card.1.audio': '1. Audio',
  'card.2.transcribe': '2. Transcribir',
  'card.3.search': '3. Buscar palabras clave',
  'card.4.chat': '4. Conversar',
  'card.5.translate': '5. Traducir',
  'card.6.export': '6. Exportar',

  // recorder
  'recorder.record': 'Grabar',
  'recorder.stop': 'Detener',
  'recorder.loadFile': 'Cargar archivo de audio',
  'recorder.hint': 'Soportado: .wav, .mp3, .m4a, .ogg, .flac, .webm. Todo se procesa en este PC; nada sale a internet.',
  'recorder.micError': 'No se pudo acceder al microfono',
  'recorder.readError': 'No se pudo leer el archivo. Proba arrastrandolo a la zona de drop.',
  'recorder.source': 'Fuente de audio',
  'recorder.sourceMic': 'Microfono',
  'recorder.sourceSystem': 'Audio del sistema',
  'recorder.sourceBoth': 'Ambos',
  'recorder.shareScreenHint': 'Al grabar, el sistema te pedira compartir pantalla. Tilda "Compartir audio de la pestana" o elegi la ventana/pantalla que tenga el audio que queres capturar.',
  'recorder.systemNoAudio': 'No se detecto pista de audio del sistema. Volve a intentar y tilda la opcion de compartir audio.',

  // file drop
  'drop.title': 'Arrastra un audio aqui',
  'drop.sub': 'o haz clic para seleccionar',
  'drop.loaded': 'Cargado',
  'drop.remove': 'Quitar',
  'drop.invalid': 'Formato no soportado',

  // transcribe
  'transcribe.model': 'Modelo de Whisper',
  'transcribe.modelHint': 'small (460 MB) es el balance recomendado. CPU only.',
  'transcribe.btn': 'Transcribir audio',
  'transcribe.progress': 'Transcribiendo... {msg}',

  // search
  'search.title': 'Buscar palabras clave',
  'search.hint': 'Escribi 1 o varios terminos. Separa con coma o Enter. Acento-insensitive.',
  'search.placeholder': 'Ejemplos:\ndelito, droga, hurto\nmenor de edad;amenaza;extorsion',
  'search.any': 'Cualquiera matchea',
  'search.all': 'Todos en el mismo segmento',
  'search.searching': 'Buscando...',
  'search.noMatches': 'Sin coincidencias.',
  'search.matches': '{n} coincidencia | {n} coincidencias',
  'search.export': 'Exportar resultados',

  // chat
  'chat.title': 'Conversar con la transcripcion',
  'chat.hint': 'Preguntale lo que quieras. El LLM responde solo con lo que esta en la transcripcion.',
  'chat.placeholder': 'Escribi tu pregunta y presiona Enter (Shift+Enter para nueva linea)',
  'chat.send': 'Enviar',
  'chat.clear': 'Limpiar',
  'chat.thinking': 'Pensando...',
  'chat.you': 'Vos',
  'chat.llm': 'LLM',
  'chat.examples': 'Ejemplos de preguntas:',
  'chat.empty': 'Aun no hay transcripcion. Transcribi un audio primero.',

  // translate
  'translate.title': 'Traducir transcripcion',
  'translate.hint': 'Traduce la transcripcion a otro idioma usando el LLM local.',
  'translate.target': 'Traducir a',
  'translate.btn': 'Traducir',
  'translate.translating': 'Traduciendo...',
  'translate.result': 'Traduccion',
  'translate.copy': 'Copiar',
  'translate.download': 'Descargar .txt',
  'translate.empty': 'Aun no hay transcripcion para traducir.',

  // export
  'export.txt': 'Transcripcion .txt',
  'export.md': 'Transcripcion .md',
  'export.hint': 'Los resumenes por modo tambien se pueden exportar como .md desde su pestana.',

  // tabs
  'tab.transcripcion': 'Transcripcion',
  'tab.reunion': 'Modo Reunion',
  'tab.estudio': 'Modo Estudio',
  'tab.conversacion': 'Modo Conversacion',

  // transcription view
  'tx.idioma': 'Idioma detectado',
  'tx.modelo': 'Modelo',
  'tx.duracion': 'Duracion',
  'tx.segmentos': 'Segmentos',
  'tx.matches': '{cur} / {total} matches',
  'tx.up': '↑',
  'tx.down': '↓',
  'tx.emptyTitle': 'Aun no hay transcripcion.',
  'tx.emptyHint': 'Graba o carga un audio, y presiona Transcribir.',

  // mode panel
  'mode.regenerate': 'Regenerar',
  'mode.generate': 'Generar resumen',
  'mode.transcribFirst': 'Primero transcribi un audio para poder generar el resumen.',
  'mode.notGenerated': 'Aun no se genero un resumen para este modo.',
  'mode.pressGenerate': 'Presiona Generar resumen.',
  'mode.empty': 'El resumen no devolvio contenido.',
  'mode.tituloReunion': 'Modo Reunion - Minuta',
  'mode.tituloEstudio': 'Modo Estudio - Resumen educativo',
  'mode.tituloConversacion': 'Modo Conversacion - Analisis de hablantes',
  'mode.descReunion': 'Detecta asistentes, temas tratados, decisiones, tareas con responsables y fechas mencionadas. Ideal para enviar a quien no asistio.',
  'mode.descEstudio': 'Extrae conceptos clave, definiciones mencionadas, bloques tematicos y preguntas probables de examen.',
  'mode.descConversacion': 'Estima hablantes por turnos, tono general, momentos clave y temas principales. Pensado para analizar dialogos, llamadas o entrevistas.',
  'mode.warning': 'Aviso',
  'mode.metodo': 'Metodo',
  'mode.modelo': 'Modelo',

  // language
  'lang.label': 'Idioma de la UI',
};

const en: Dict = {
  'app.title': 'Meet Ninja',
  'header.newSession': 'New session',
  'header.backendOk': 'Backend OK',
  'header.ollamaYes': 'Ollama: {model} (<={cap}B)',
  'header.ollamaNo': 'Ollama: no',
  'header.ollamaTitle': 'Ollama: {model}',

  'card.1.audio': '1. Audio',
  'card.2.transcribe': '2. Transcribe',
  'card.3.search': '3. Search keywords',
  'card.4.chat': '4. Chat',
  'card.5.translate': '5. Translate',
  'card.6.export': '6. Export',

  'recorder.record': 'Record',
  'recorder.stop': 'Stop',
  'recorder.loadFile': 'Load audio file',
  'recorder.hint': 'Supported: .wav, .mp3, .m4a, .ogg, .flac, .webm. Everything is processed on this PC; nothing leaves your computer.',
  'recorder.micError': 'Could not access microphone',
  'recorder.readError': 'Could not read the file. Try dragging it to the drop zone.',
  'recorder.source': 'Audio source',
  'recorder.sourceMic': 'Microphone',
  'recorder.sourceSystem': 'System audio',
  'recorder.sourceBoth': 'Both',
  'recorder.shareScreenHint': 'When recording, the system will ask you to share a screen. Tick "Share tab audio" or pick the window/screen that has the audio you want to capture.',
  'recorder.systemNoAudio': 'No system audio track was found. Please try again and tick the option to share audio.',

  'drop.title': 'Drag audio here',
  'drop.sub': 'or click to select',
  'drop.loaded': 'Loaded',
  'drop.remove': 'Remove',
  'drop.invalid': 'Unsupported format',

  'transcribe.model': 'Whisper model',
  'transcribe.modelHint': 'small (460 MB) is the recommended balance. CPU only.',
  'transcribe.btn': 'Transcribe audio',
  'transcribe.progress': 'Transcribing... {msg}',

  'search.title': 'Search keywords',
  'search.hint': 'Type 1 or more terms. Separate with comma or Enter. Accent-insensitive.',
  'search.placeholder': 'Examples:\ndelito, droga, hurto\nmenor de edad;amenaza;extorsion',
  'search.any': 'Any match',
  'search.all': 'All in the same segment',
  'search.searching': 'Searching...',
  'search.noMatches': 'No matches.',
  'search.matches': '{n} match | {n} matches',
  'search.export': 'Export results',

  'chat.title': 'Chat with the transcript',
  'chat.hint': 'Ask anything. The LLM only answers based on the transcript.',
  'chat.placeholder': 'Type your question and press Enter (Shift+Enter for new line)',
  'chat.send': 'Send',
  'chat.clear': 'Clear',
  'chat.thinking': 'Thinking...',
  'chat.you': 'You',
  'chat.llm': 'LLM',
  'chat.examples': 'Example questions:',
  'chat.empty': 'No transcript yet. Transcribe an audio first.',

  'translate.title': 'Translate transcript',
  'translate.hint': 'Translate the transcript to another language using the local LLM.',
  'translate.target': 'Translate to',
  'translate.btn': 'Translate',
  'translate.translating': 'Translating...',
  'translate.result': 'Translation',
  'translate.copy': 'Copy',
  'translate.download': 'Download .txt',
  'translate.empty': 'No transcript to translate yet.',

  'export.txt': 'Transcript .txt',
  'export.md': 'Transcript .md',
  'export.hint': 'Per-mode summaries can also be exported as .md from their tab.',

  'tab.transcripcion': 'Transcript',
  'tab.reunion': 'Meeting mode',
  'tab.estudio': 'Study mode',
  'tab.conversacion': 'Conversation mode',

  'tx.idioma': 'Detected language',
  'tx.modelo': 'Model',
  'tx.duracion': 'Duration',
  'tx.segmentos': 'Segments',
  'tx.matches': '{cur} / {total} matches',
  'tx.up': '↑',
  'tx.down': '↓',
  'tx.emptyTitle': 'No transcript yet.',
  'tx.emptyHint': 'Record or load an audio, then press Transcribe.',

  'mode.regenerate': 'Regenerate',
  'mode.generate': 'Generate summary',
  'mode.transcribFirst': 'Transcribe an audio first to generate a summary.',
  'mode.notGenerated': 'No summary generated for this mode yet.',
  'mode.pressGenerate': 'Press Generate summary.',
  'mode.empty': 'The summary returned no content.',
  'mode.tituloReunion': 'Meeting mode - Minutes',
  'mode.tituloEstudio': 'Study mode - Educational summary',
  'mode.tituloConversacion': 'Conversation mode - Speaker analysis',
  'mode.descReunion': 'Detects attendees, topics, decisions, tasks with owners and dates, key dates, executive summary.',
  'mode.descEstudio': 'Extracts key concepts, definitions, block summaries, probable exam questions.',
  'mode.descConversacion': 'Estimates speakers by turns, general tone, key moments, main topics. Useful for analyzing dialogues, calls or interviews.',
  'mode.warning': 'Warning',
  'mode.metodo': 'Method',
  'mode.modelo': 'Model',

  'lang.label': 'UI language',
};

const pt: Dict = {
  'app.title': 'Meet Ninja',
  'header.newSession': 'Nova sessao',
  'header.backendOk': 'Backend OK',
  'header.ollamaYes': 'Ollama: {model} (<={cap}B)',
  'header.ollamaNo': 'Ollama: nao',
  'header.ollamaTitle': 'Ollama: {model}',

  'card.1.audio': '1. Audio',
  'card.2.transcribe': '2. Transcrever',
  'card.3.search': '3. Buscar palavras-chave',
  'card.4.chat': '4. Conversar',
  'card.5.translate': '5. Traduzir',
  'card.6.export': '6. Exportar',

  'recorder.record': 'Gravar',
  'recorder.stop': 'Parar',
  'recorder.loadFile': 'Carregar arquivo de audio',
  'recorder.hint': 'Suportado: .wav, .mp3, .m4a, .ogg, .flac, .webm. Tudo processado neste PC; nada sai do seu computador.',
  'recorder.micError': 'Nao foi possivel acessar o microfone',
  'recorder.readError': 'Nao foi possivel ler o arquivo. Tente arrastar para a zona de drop.',
  'recorder.source': 'Fonte de audio',
  'recorder.sourceMic': 'Microfone',
  'recorder.sourceSystem': 'Audio do sistema',
  'recorder.sourceBoth': 'Ambos',
  'recorder.shareScreenHint': 'Ao gravar, o sistema pedira para compartilhar tela. Marque "Compartilhar audio da aba" ou escolha a janela/tela com o audio que voce quer capturar.',
  'recorder.systemNoAudio': 'Nenhuma faixa de audio do sistema foi encontrada. Tente novamente e marque a opcao de compartilhar audio.',

  'drop.title': 'Arraste um audio aqui',
  'drop.sub': 'ou clique para selecionar',
  'drop.loaded': 'Carregado',
  'drop.remove': 'Remover',
  'drop.invalid': 'Formato nao suportado',

  'transcribe.model': 'Modelo do Whisper',
  'transcribe.modelHint': 'small (460 MB) e o equilibrio recomendado. Apenas CPU.',
  'transcribe.btn': 'Transcrever audio',
  'transcribe.progress': 'Transcrevendo... {msg}',

  'search.title': 'Buscar palavras-chave',
  'search.hint': 'Digite 1 ou mais termos. Separe com virgula ou Enter. Sem acento.',
  'search.placeholder': 'Exemplos:\ndelito, droga, furto\nmenor de idade;ameaca;extorsao',
  'search.any': 'Qualquer um',
  'search.all': 'Todos no mesmo segmento',
  'search.searching': 'Buscando...',
  'search.noMatches': 'Sem correspondencias.',
  'search.matches': '{n} correspondencia | {n} correspondencias',
  'search.export': 'Exportar resultados',

  'chat.title': 'Conversar com a transcricao',
  'chat.hint': 'Pergunte o que quiser. O LLM responde apenas com base na transcricao.',
  'chat.placeholder': 'Digite sua pergunta e pressione Enter (Shift+Enter para nova linha)',
  'chat.send': 'Enviar',
  'chat.clear': 'Limpar',
  'chat.thinking': 'Pensando...',
  'chat.you': 'Voce',
  'chat.llm': 'LLM',
  'chat.examples': 'Perguntas de exemplo:',
  'chat.empty': 'Sem transcricao ainda. Transcreva um audio primeiro.',

  'translate.title': 'Traduzir transcricao',
  'translate.hint': 'Traduz a transcricao para outro idioma usando o LLM local.',
  'translate.target': 'Traduzir para',
  'translate.btn': 'Traduzir',
  'translate.translating': 'Traduzindo...',
  'translate.result': 'Traducao',
  'translate.copy': 'Copiar',
  'translate.download': 'Baixar .txt',
  'translate.empty': 'Sem transcricao para traduzir ainda.',

  'export.txt': 'Transcricao .txt',
  'export.md': 'Transcricao .md',
  'export.hint': 'Resumos por modo tambem podem ser exportados como .md na aba correspondente.',

  'tab.transcripcion': 'Transcricao',
  'tab.reunion': 'Modo Reuniao',
  'tab.estudio': 'Modo Estudo',
  'tab.conversacion': 'Modo Conversa',

  'tx.idioma': 'Idioma detectado',
  'tx.modelo': 'Modelo',
  'tx.duracion': 'Duracao',
  'tx.segmentos': 'Segmentos',
  'tx.matches': '{cur} / {total} correspondencias',
  'tx.up': '↑',
  'tx.down': '↓',
  'tx.emptyTitle': 'Sem transcricao ainda.',
  'tx.emptyHint': 'Grave ou carregue um audio e pressione Transcrever.',

  'mode.regenerate': 'Regenerar',
  'mode.generate': 'Gerar resumo',
  'mode.transcribFirst': 'Transcreva um audio primeiro para gerar o resumo.',
  'mode.notGenerated': 'Nenhum resumo gerado para este modo ainda.',
  'mode.pressGenerate': 'Pressione Gerar resumo.',
  'mode.empty': 'O resumo nao retornou conteudo.',
  'mode.tituloReunion': 'Modo Reuniao - Ata',
  'mode.tituloEstudio': 'Modo Estudo - Resumo educacional',
  'mode.tituloConversacion': 'Modo Conversa - Analise de falantes',
  'mode.descReunion': 'Detecta participantes, topicos, decisoes, tarefas com responsaveis e datas mencionadas, datas chave, resumo executivo.',
  'mode.descEstudio': 'Extrai conceitos-chave, definicoes, resumos por bloco, perguntas provaveis de prova.',
  'mode.descConversacion': 'Estima falantes por turnos, tom geral, momentos-chave, topicos principais.',
  'mode.warning': 'Aviso',
  'mode.metodo': 'Metodo',
  'mode.modelo': 'Modelo',

  'lang.label': 'Idioma da interface',
};

const dicts: Record<Lang, Dict> = { es, en, pt };

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const dict = dicts[lang] || dicts[DEFAULT_LANG];
  let s = dict[key] ?? dicts[DEFAULT_LANG][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/**
 * Helper para plurales simples: 'search.matches': '{n} match | {n} matches'
 * Devuelve la version singular o plural segun n.
 */
export function tp(lang: Lang, key: string, n: number, params?: Record<string, string | number>): string {
  const full = t(lang, key, { ...params, n });
  const parts = full.split('|').map(p => p.trim());
  if (n === 1) return parts[0];
  return parts[1] || parts[0];
}
