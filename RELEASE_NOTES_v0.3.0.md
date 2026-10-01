# v0.3.0 — Ya hay instalador .exe (y sigue siendo zero prerequisites)

Este release agrega el **instalador NSIS** que faltaba, y mantiene el portable.
Ambos formatos salen del mismo build verificado.

## 📦 Descargas

| Formato | Archivo | Instalar | Tamaño |
|---|---|---|---|
| **Instalador** (recomendado) | `Meet Ninja Setup 0.3.0.exe` | Sí, con asistente | ~1.7 GB |
| **Portable** | `Meet Ninja-Portable-0.3.0.exe` | No, descomprime y ejecuta | ~1.7 GB |

Los dos incluyen el Python embebido y las DLLs de llama.cpp: **no tenés que
instalar Python, ni Ollama, ni nada.**

El instalador es *per-user* (no pide permisos de administrador), crea acceso
directo en el Escritorio y en el Menú Inicio, y deja que elijas dónde
instalarlo.

## ✨ Novedades

### 1. Instalador NSIS funcional 🎉

Desde v0.1.0 el instalador no se generaba en máquinas sin permisos de
administrador. La causa era un bug del propio tooling, no del proyecto:

`electron-builder` descarga `winCodeSign-2.6.0.7z` para firmar los `.exe`. Ese
archivo trae una carpeta `darwin/` con symlinks POSIX (`libcrypto.dylib`,
`libssl.dylib`). Crear symlinks en Windows exige el privilegio
`SeCreateSymbolicLinkPrivilege`, que sin Developer Mode no está disponible.
El extractor abortaba y se caía todo el build.

El fix vive en `scripts/eb-shim/7za.cmd`: un shim de 7-Zip que se pone al
inicio del `PATH` y le inyecta `-xr!darwin` al extractor, de modo que la
carpeta de macOS nunca se materializa. Además, la app ahora vuelve a pasar
por `rcedit`, así que el `.exe` instalado muestra correctamente icono,
versión y editor.

### 2. Metadata del ejecutable correcta

El `.exe` ahora declara:

- Product: **Meet Ninja**
- Version: **0.3.0**
- Company: **Jorge Aguayo**
- Description: *Meet Ninja - Transcripcion y resumen de reuniones con IA, 100% local*

### 3. Build reproducible en Windows sin admin

`npm run package:win` ahora funciona de punta a punta en un equipo normal,
sin cuentas admin, sin Developer Mode y sin tocar nada fuera del repo. La
cache de electron-builder queda en `.eb-cache/` (ignorada por git).

## 🐛 Bugs corregidos

- **Instalador que nunca se generaba:** resuelto (ver arriba).
- **`signApp()` parcheado como efecto secundario:** el workaround anterior
  apagaba la firma del ejecutable para esquivar el bug. Ahora que la causa
  raíz está resuelta, el parche se quitó y `rcedit` vuelve a aplicar icono y
  versión.
- **`winPackager.js`:** se restauró el código original de `electron-builder`.

## 📋 Requisitos

- Windows 10 o 11, 64 bits
- ~8 GB RAM
- ~4 GB de disco

Nada más.

## ⚠️ Aviso importante sobre las versiones anteriores

`v0.1.0` y `v0.1.1` están rotas y marcadas como tales. **No las descargues.**
La primera versión funcional es **v0.2.0** (solo portable), y **v0.3.0** es la
primera con instalador.

## 🔐 Sobre la firma digital

El instalador **no está firmado digitalmente**. Windows SmartScreen va a
mostrar un aviso de "editor desconocido" la primera vez. Es normal en
proyectos sin certificado comercial: hacé clic en **"Más información" →
"Ejecutar de todas formas"**.

El aviso desaparece solo cuando Windows acumuló suficientes descargas del
archivo. Nada malicioso: el instalador se genera en un pipeline local y no
incluye telemetría ni envía datos a ningún servidor.