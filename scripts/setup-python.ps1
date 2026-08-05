# Setup del backend Python de Meet Ninja.
# Crea un venv en python_backend\.venv e instala las dependencias.
# Solo Windows / PowerShell.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot\..

$venvDir = Join-Path 'python_backend' '.venv'
$pythonExe = Join-Path $venvDir 'Scripts\python.exe'
$requirements = Join-Path 'python_backend' 'requirements.txt'

if (-not (Test-Path $pythonExe)) {
    Write-Host "Creando venv en $venvDir..." -ForegroundColor Cyan
    python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo crear el venv. Verifica que Python 3.10+ este instalado y en PATH."
    }
} else {
    Write-Host "venv ya existe en $venvDir" -ForegroundColor DarkGray
}

Write-Host "Instalando dependencias..." -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade fallo" }
& $pythonExe -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { throw "pip install fallo" }

Write-Host "`nListo. Para arrancar el backend:" -ForegroundColor Green
Write-Host "  & '$pythonExe' python_backend\main.py`n"
