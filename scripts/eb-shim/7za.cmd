@echo off
REM ---------------------------------------------------------------------------
REM Shim de 7-Zip para electron-builder en Windows sin privilegios de admin.
REM
REM PROBLEMA: app-builder.exe (el binario Go de electron-builder) busca
REM literalmente "7za" en el %PATH% del sistema, NO en node_modules. Al
REM extraer winCodeSign-2.6.0.7z intenta crear dos symlinks POSIX
REM (darwin\10.12\lib\libcrypto.dylib y libssl.dylib). Windows exige el
REM privilegio SeCreateSymbolicLinkPrivilege para eso, 7za aborta con exit
REM code 2 y electron-builder tira todo el build.
REM
REM SOLUCION: este shim:
REM   1. llama al 7za.exe real (indicado en MN_REAL_7ZA)
REM   2. inyecta '-xr!darwin' para nunca materializar la carpeta de macOS
REM   3. normaliza el exit code 2 (warning) a 0, dejando pasar los errores
REM      reales de 7-Zip (exit code 1 = fallo fatal)
REM
REM IMPORTANTE: no usar `setlocal EnableDelayedExpansion` aca. La
REM expansion diferida se come el caracter "!" de "-xr!darwin" y 7za
REM responde "exit status 7" (error de linea de comandos).
REM
REM Solo lo usa app-builder.exe durante la extraccion de artefactos. El 7za
REM que usa electron-builder para comprimir (getPath7za) sigue siendo el
REM binario real de node_modules/7zip-bin.
REM ---------------------------------------------------------------------------

if "%MN_REAL_7ZA%"=="" (
  echo [7za-shim] MN_REAL_7ZA no esta definido. Abortando. 1>&2
  exit /b 1
)

if not exist "%MN_REAL_7ZA%" (
  echo [7za-shim] No existe "%MN_REAL_7ZA%". Ejecuta npm install. 1>&2
  exit /b 1
)

REM %* preserva los argumentos tal cual, incluyendo comillas.
"%MN_REAL_7ZA%" %* -xr!darwin
set "RC=%ERRORLEVEL%"

REM exit 2 = warning no fatal (p. ej. symlinks). Lo toleramos.
REM exit 1 = error fatal, lo propagamos.
if "%RC%"=="2" (
  exit /b 0
)
exit /b %RC%