# v0.2.0 — La app ahora es realmente "zero prerequisites"

Este release arregla **tres bugs encadenados** que hacían que Meet Ninja no
funcionara fuera de mi PC de desarrollo. Encontrados y reportados por usuarios
al intentar instalar en otros equipos.

## 🐛 Bugs corregidos

### 1. La app pedía Python instalado

**Síntoma:** al instalar en otro equipo, la app no arrancaba y pedía Python.

**Causa:** el filtro de `electron-builder` excluía casi todo el venv. De los
317 MB del venv solo se empaquetaban 32 MB (los `.py` sueltos): faltaban
`Scripts\python.exe` y `pyvenv.cfg`. `getPythonPath()` no los encontraba,
caía al fallback y lanzaba `python` del `PATH` — que no existe en un PC limpio.

**Fix:** se embebe un **CPython portable y relocatable** en
`python_backend/.py/` (433 MB), generado con `scripts/build-portable-python.ps1`.

### 2. El venv no era portable (bug latente)

Aun copiando el venv completo no habría funcionado: su `pyvenv.cfg` contiene

```
home = C:\Users\jagua\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none
```

una ruta que **solo existe en mi máquina**. En cualquier otro equipo el venv
busca el Python base en esa ruta y falla.

**Por qué CPython portable y no venv:** los venvs anclan la ruta del intérprete
base; un CPython relocatable (python-build-standalone) resuelve su stdlib
relativo al ejecutable, así que funciona desde cualquier carpeta y sin permisos
de admin.

### 3. El LLM local nunca habría arrancado

**Causa:** el filtro empaqutaba solo `bin/llama-server.exe`, que pesa **0 MB**
porque es un stub. Faltaban las 51 DLLs que realmente hacen el trabajo:
`llama-server-impl.dll` (9.5 MB), `llama-common.dll` (7.6 MB), `llama.dll`,
los 14 `ggml-cpu-*.dll` (selección de ISA por CPU) y `libomp140.x86_64.dll`
(runtime OpenMP de MSVC).

**Fix:** se incluye `bin/**` completo.

## 🛠️ Otros cambios

- `getPythonPath()` prioriza el Python portable embebido y solo cae al venv
  clásico (builds antiguos) o al Python del sistema como último recurso.
- El mensaje de error del backend ahora explica qué revisar (extracción
  incompleta, antivirus, carpeta de solo lectura) en vez de pedir ejecutar un
  script de desarrollo que no aplica a la app instalada.
- `scripts/build-portable-python.ps1`: build reproducible del Python portable,
  con tag pineado (`20260929`) para que el artefacto sea determinista.
- `.gitignore`: excluye `python_backend/.py/` y `.pybuild/` (433 MB).

## ⚠️ Si venías de v0.1.0/v0.1.1

**Borrá la instalación vieja.** El portable ahora incluye el runtime de Python
(~430 MB más), así que el .zip pesa bastante más.

## 📥 Descarga

- `Meet-Ninja-portable-0.2.0.zip` — descomprimir en una carpeta **sin permisos
  de administrador** (ej: `C:\Meet Ninja`) y ejecutar `Meet Ninja.exe`.
- El instalador NSIS no está en este release (ver notas del mantenedor).

## ✅ Verificación

Probado extrayendo el `.zip` en una ruta distinta a la de compilación
(`C:\mn-relocate-test\`) para simular otro equipo: el Python portable arranca,
importa sus dependencias y levanta el backend sin Python instalado.
