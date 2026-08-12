# 🥷 Meet Ninja v0.1.0 — Primer release público

> Transcripción y resumen de reuniones con IA, 100% local y open source.

## 📥 Descarga

- **Portable (Windows)**: `Meet-Ninja-portable-0.1.0.zip` (1.58 GB) — descomprimir y ejecutar `Meet Ninja.exe`
- **NSIS Installer**: no disponible en este release (requiere build con Developer Mode o admin)

> ⚠️ Windows SmartScreen va a mostrar warning al abrir el .exe (no tenemos cert de firma). Click **Más información** → **Ejecutar de todas formas**.

## ✨ Features

### Core
- 🎙️ **Grabación de audio** desde micrófono, audio del sistema, o ambos (con visualizador VU en vivo)
- 📝 **Transcripción** con faster-whisper (modelo `small`, CPU-only, 460 MB)
- 🧠 **3 modos de resumen** con LLM local (Qwen2.5-1.5B-Instruct Q4_K_M):
  - 🗂️ **Reunión** — minuta formal (asistentes, agenda, decisiones, tareas)
  - 📚 **Estudio** — conceptos clave, definiciones, bloques temáticos
  - 🗨️ **Conversación** — registro conversacional fiel
- 🔍 **Búsqueda de palabras clave** tipo diccionario (modo ANY/ALL, acento+case-insensitive)
- 💬 **Chat con la transcripción** (RAG) — preguntale al LLM sobre la reunión, con idioma configurable
- 🌐 **Traducción** a múltiples idiomas
- 🪟 **Multi-sesión** — maneja varias reuniones en paralelo desde el menú principal
- 💾 **Persistencia local** — sesiones en localStorage, audio en IndexedDB
- 📦 **Export/Import** de sesiones en formato `.meetninja.json` (incluye audio)

### UX
- 🌗 **Modo claro/oscuro** con persistencia
- 🌐 **i18n** Español (default) / English / Português
- 🎨 **Dark mode toggle**, **GitHub button** en el header
- 🔄 **Auto-update** desde GitHub Releases (electron-updater)

## 🛠️ Stack técnico

- **Frontend**: Electron 32 + Vite 5 + React 18 + TypeScript + Zustand
- **Backend**: Python 3.11 + FastAPI + faster-whisper + llama.cpp (llama-server)
- **Build**: electron-builder 25 + electron-updater 6
- **Sin dependencias cloud** — todo corre en tu PC, sin telemetría

## 💻 Requisitos

- Windows 10/11 (x64)
- 8 GB RAM mínimo (16 GB recomendado)
- 2.5 GB de disco
- Sin GPU dedicada (CPU-only)

## 🐛 Issues conocidos

- **No hay firma de código** → SmartScreen warning (click "Ejecutar de todas formas")
- **SmartScreen** puede bloquear la primera ejecución
- **Auto-updater** puede mostrar warning en consola si no hay releases (desaparece después del primer release)

## 📝 Licencia

MIT © 2026 Jorge Aguayo
