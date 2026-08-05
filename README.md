<p align="center">
  <img src="src/assets/favicon.svg" alt="Meet Ninja" width="80" />
</p>

<h1 align="center">Meet Ninja</h1>

<p align="center">
  <strong>Graba o carga una reunion y obten transcripcion, resumen, minuta y busqueda por palabras clave, todo con IA y 100% local.</strong>
</p>

<p align="center">
  <a href="#caracteristicas">Caracteristicas</a> &middot;
  <a href="#instalacion">Instalacion</a> &middot;
  <a href="#modos">Modos de entrega</a> &middot;
  <a href="#tecnologias">Tecnologias</a> &middot;
  <a href="#privacidad">Privacidad</a> &middot;
  <a href="#licencia">Licencia</a>
</p>

---

## Caracteristicas

- **Grabar en vivo** desde el microfono, o **cargar un archivo** (wav, mp3, m4a, ogg, flac, webm).
- **Transcripcion local** con [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Sin subir nada a la nube.
- **3 modos de resumen**, cada uno con un prompt y salida optimizados:
  - **Reunion** → minuta con asistentes, temas, decisiones, tareas con responsable y fecha, fechas clave, resumen ejecutivo.
  - **Estudio** → conceptos clave, definiciones, resumen por bloques, preguntas probables.
  - **Conversacion** → hablantes estimados, tono, momentos clave, temas.
- **Transcripcion literal** siempre disponible: cada segmento con su timestamp.
- **Busqueda de palabras clave** estilo diccionario:
  - 1 o varios terminos (separados por coma, Enter o `;`).
  - Modo ANY (cualquiera matchea) o ALL (todos en el mismo segmento).
  - Acento-insensitive y case-insensitive (busca "delito" y encuentra "DELITO", "delitos").
  - Resaltado en la transcripcion y navegacion con flechas entre matches.
  - Pensado para casos como: policia buscando delitos en una escucha, abogado buscando terminos juridicos, etc.
- **Motor de resumen inteligente**: usa Ollama local si esta corriendo, con fallback extractivo automatico (siempre devuelve algo util).
- **Exportar** resultados a `.txt`, `.md` (transcripcion + resumenes por modo + resultados de busqueda).
- **Auto-update** desde GitHub Releases (electron-updater).
- **Multiplataforma**: Windows, macOS, Linux.

## Modos de entrega

Cada modo adapta el prompt y la estructura de salida al contexto. Por ejemplo:

| Modo | Que espera | Que devuelve |
|---|---|---|
| Reunion | Una reunion de trabajo con varios asistentes. | Minuta estructurada, con tareas y fechas si se mencionan. |
| Estudio | Una clase grabada, conferencia, podcast educativo. | Conceptos, definiciones, preguntas probables de examen. |
| Conversacion | Una conversacion libre, entrevista, escucha telefonica. | Mapa de hablantes, tono, momentos clave, temas. |

Y siempre, ademas del modo que elijas, tenes:

- **Pestaña de Transcripcion literal**: el texto palabra por palabra, con timestamp, click para ir a cada momento.
- **Panel de Busqueda**: barra lateral con terminos, resultados resaltados, navegacion.

## Capturas

(Proximamente: cuando el proyecto tenga UI estable.)

## Instalacion

### Windows (recomendado para usuarios finales)

1. Descarga el ultimo `.exe` desde [Releases](https://github.com/jaguayoara/meet-ninja/releases).
2. Instala o descomprime.
3. Doble clic en **Meet Ninja**.
4. La primera vez, la app te pedira instalar el backend Python (un solo click).

> La app necesita **Python 3.10+** instalado en el sistema. Si no lo tenes, descargalo desde [python.org](https://www.python.org/downloads/windows/) y marca "Add Python to PATH".

### Para desarrollo

Requisitos:
- Node.js 20+ y npm
- Python 3.10+
- ffmpeg (la mayoria de los sistemas lo trae; en Windows podes instalarlo con `winget install Gyan.FFmpeg`)

```powershell
# Clonar
git clone https://github.com/jaguayoara/meet-ninja.git
cd meet-ninja

# Instalar deps de Node
npm install

# Instalar deps de Python (crea venv automatico)
npm run setup:python

# Arrancar en modo dev (Vite + Electron + Python backend)
npm run dev
```

La primera vez que transcribas, `faster-whisper` descarga el modelo (default: `small`, ~460 MB) y lo guarda en `python_backend/models/`. Solo se hace una vez.

### Compilar el .exe portable

```powershell
npm run package:win
```

Resultado en `release/`. Comprimi esa carpeta en un `.zip` para distribuir.

Para macOS / Linux, desde cada plataforma:

```bash
npm run package:mac
npm run package:linux
```

## Uso

1. **Iniciar** la app. La primera vez tarda unos segundos en arrancar el backend.
2. **Grabar** desde el microfono, o **arrastrar** un archivo de audio.
3. **Elegir modelo de Whisper** (small recomendado) y presionar **Transcribir**.
4. Mientras transcribis, podes ir viendo los segmentos. La transcripcion tarda aprox 3-5x la duracion del audio (con `small` en CPU moderna).
5. Cambiar a la pestaña del modo que quieras (Reunion, Estudio, Conversacion) y presionar **Generar resumen**.
6. Usar el panel de **Buscar** para encontrar terminos especificos en la transcripcion.
7. **Exportar** lo que necesites (transcripcion y resumenes a `.txt`/`.md`).

## Privacidad

- **Cero servidores**: ni la app ni la IA envian datos a internet. Todo corre en tu PC.
- **Sin cuentas, sin registro, sin telemetría**.
- **Auditable**: el codigo es 100% abierto. Podes verificar que el audio no sale de tu equipo.
- **Archivos temporales**: los audios subidos se eliminan inmediatamente despues de transcribir.
- **Modelos locales**: faster-whisper y Ollama corren en tu CPU/GPU, no en la nube.

## Ollama (opcional, recomendado)

Para obtener los mejores resúmenes, instala [Ollama](https://ollama.com) y descarga un modelo:

```bash
# Instalar Ollama desde https://ollama.com/download
ollama pull llama3.1:8b
```

Meet Ninja detecta Ollama automaticamente y lo usa. Si Ollama no esta disponible, la app usa resumen extractivo (sin LLM) y sigue funcionando.

## Tecnologias

**Frontend (Electron + React + TS):**
- [Electron 32](https://www.electronjs.org/) — ventana nativa
- [Vite 5](https://vitejs.dev/) + [React 18](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/)
- [Zustand](https://github.com/pmndrs/zustand) — estado
- [electron-updater](https://www.electron.build/auto-update) — auto-update desde GitHub

**Backend Python embebido (FastAPI):**
- [FastAPI](https://fastapi.tiangolo.com/) + [uvicorn](https://www.uvicorn.org/)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — transcripcion (modelo CTranslate2, int8 en CPU)
- [Ollama](https://ollama.com) — LLM local opcional
- [httpx](https://www.python-httpx.org/) — cliente HTTP async

## Estructura del proyecto

```
meet-ninja/
├── electron/                 # Main process + preload
│   ├── main.ts               # ventana, spawn Python, IPC, auto-update
│   └── preload.ts            # bridge seguro (contextBridge)
├── src/                      # Frontend React
│   ├── components/
│   │   ├── Recorder.tsx      # MediaRecorder (mic)
│   │   ├── FileDrop.tsx      # drag & drop
│   │   ├── TranscriptionView.tsx
│   │   ├── ModePanel.tsx     # 3 modos reutilizables
│   │   └── SearchPanel.tsx
│   ├── store/
│   │   └── useAppStore.ts    # estado Zustand
│   ├── lib/
│   │   ├── api.ts            # cliente HTTP al backend
│   │   └── format.ts
│   ├── styles/global.css
│   └── main.tsx + App.tsx
├── python_backend/
│   ├── main.py               # FastAPI app
│   ├── transcriber.py        # wrapper faster-whisper
│   ├── summarizer.py         # prompts por modo + ollama + extractivo
│   ├── searcher.py           # busqueda acento-insensitive
│   └── requirements.txt
├── scripts/
│   ├── setup-python.ps1      # crea venv + instala deps
│   ├── gen_icons.py          # genera iconos
│   └── dev.mjs               # dev orchestrator
├── build/                    # iconos para electron-builder
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Licencia

MIT — ver [LICENSE](LICENSE).

## Autor

**Jorge Aguayo** ([@jaguayoara](https://github.com/jaguayoara))

Si Meet Ninja te sirve para una reunion, una clase o para encontrar ese termino clave en una escucha, una estrella en el repo o un issue con feedback se agradece mucho.
