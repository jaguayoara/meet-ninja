<#
.SYNOPSIS
    Construye el CPython portable que se embebe en la app (python_backend\.py).

.DESCRIPTION
    Meet Ninja se distribuye como "zero prerequisites": no pide Python instalado.
    Para lograrlo embebemos un CPython relocatable de python-build-standalone
    (astral-sh) en vez de un venv, porque los venvs NO son portables: su
    pyvenv.cfg apunta a la ruta absoluta del Python base de la maquina que los
    creo, asi que fallan en cualquier otro equipo.

    Usa un tag pineado (PYTHON_TAG) para que el build sea reproducible.
    Las dependencias se instalan con pip directamente sobre ese Python
    (sin venv), por lo que no queda ninguna referencia a rutas absolutas.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\build-portable-python.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-portable-python.ps1 -Force
#>
[CmdletBinding()]
param(
    # Fuerza a reconstruir aunque python_backend\.py ya exista.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot '..')

# Tag pineado de python-build-standalone para builds reproducibles.
$PythonTag = '20260929'
$PythonVersion = '3.11.16'
$PythonAsset = "cpython-$PythonVersion+$PythonTag-x86_64-pc-windows-msvc-install_only.tar.gz"

$work = Join-Path (Get-Location) '.pybuild'
$tarGz = Join-Path $work 'cpython.tar.gz'
$tar = Join-Path $work 'cpython.tar'
$dest = Join-Path (Get-Location) 'python_backend\.py\python'
$req = Join-Path (Get-Location) 'python_backend\requirements.txt'

$sevenZip = Join-Path (Get-Location) 'node_modules\7zip-bin\win\x64\7za.exe'
if (-not (Test-Path $sevenZip)) {
    throw "No se encontro 7za.exe. Ejecuta 'npm install' primero."
}

if ((Test-Path $dest) -and -not $Force) {
    Write-Host "python_backend\.py ya existe. Usa -Force para reconstruir." -ForegroundColor DarkGray
    exit 0
}

New-Item -ItemType Directory -Path $work -Force | Out-Null

# 1) Descargar el tarball
if (-not (Test-Path $tarGz)) {
    $url = "https://github.com/astral-sh/python-build-standalone/releases/download/$PythonTag/$([uri]::EscapeDataString($PythonAsset))"
    Write-Host "Descargando CPython portable ($PythonAsset)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $tarGz -UseBasicParsing -TimeoutSec 600
}

# 2) Descomprimir tar.gz -> tar -> python/
Write-Host "Extrayendo..." -ForegroundColor Cyan
& $sevenZip x -y -bd $tarGz "-o$work" | Out-Null
& $sevenZip x -y -bd $tar (Join-Path $work 'python/*') | Out-Null

$pythonExe = Join-Path $dest 'python.exe'
if (-not (Test-Path $pythonExe)) {
    throw "No se encontro python.exe en $dest"
}

# 3) Instalar dependencias (sin venv -> totalmente relocatable)
Write-Host "Instalando dependencias en el Python portable..." -ForegroundColor Cyan
& $pythonExe -m pip install --no-warn-script-location --upgrade pip | Out-Null
& $pythonExe -m pip install --no-warn-script-location -r $req
if ($LASTEXITCODE -ne 0) { throw "pip install fallo" }

# 4) Limpiar caches que solo hacen espacio
& $pythonExe -m pip cache purge | Out-Null
Get-ChildItem $dest -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

$sizeMb = [math]::Round(((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "`nListo: python_backend\.py\ ($sizeMb MB)" -ForegroundColor Green
Write-Host "Verificacion rapida:" -ForegroundColor DarkGray
Write-Host "  & '$pythonExe' -c 'import fastapi, faster_whisper; print(1)'" -ForegroundColor DarkGray
