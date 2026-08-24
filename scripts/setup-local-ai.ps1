<#
.SYNOPSIS
  Installs the local language model that gives the villagers their voices.

.DESCRIPTION
  The game needs a language model to speak for two hundred villagers. This
  fetches one and the runtime that serves it, and puts both inside this
  project's own folder, where start.cmd will find them.

  Two downloads, done once:

    llama.cpp   about 640 MB   the server that runs the model, with CUDA
                               (about 18 MB for the CPU-only build)
    Gemma 3n    about 4.0 GB   the model itself

  Both are resumable. If the download is interrupted, run this again and it
  picks up where it stopped rather than starting over.

  Neither file is in the repository, because a four-gigabyte model has no
  business in version control.

  If you have no graphics card, or would rather not download several gigabytes,
  you do not need this at all: the game can use Google Gemini's free tier
  instead. Start it with .\start.cmd and choose Settings -> Google Gemini.

.PARAMETER Cpu
  Install the CPU-only runtime rather than the CUDA one. Much slower - expect
  a handful of tokens a second instead of thirty - but it asks nothing of your
  graphics card. Chosen automatically when no NVIDIA card is detected.

.PARAMETER Force
  Download again even if the files are already present.

.EXAMPLE
  .\scripts\setup-local-ai.ps1
#>

[CmdletBinding()]
param(
  [switch]$Cpu,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$projectRoot = Get-ConfessorRoot
$modelFile = Get-ModelFileName
$runtimeRoot = Join-Path $projectRoot "tools\llama.cpp"
$runtimeBin = Join-Path $runtimeRoot "bin"
$modelRoot = Join-Path $projectRoot "models"
$modelPath = Join-Path $modelRoot $modelFile
$serverExe = Join-Path $runtimeBin "llama-server.exe"

# Pinned rather than "latest" on purpose. The model behaves differently across
# llama.cpp releases, and the conversation pipeline was tuned against this one.
$release = "b10182"
$modelUrl = "https://huggingface.co/bartowski/google_gemma-3n-E4B-it-GGUF/resolve/main/$modelFile" + "?download=true"

# The model is a little under four gigabytes. Anything far short of that is a
# truncated download or an error page saved under the wrong name, and
# llama.cpp's failure in that case is obscure enough to be worth catching here
# instead. The bar is deliberately below the true size rather than at it, so a
# good file is never mistaken for a broken one and deleted.
$modelMinimumBytes = 3.5GB

function Write-Step($text) { Write-Host "" ; Write-Host $text -ForegroundColor Cyan }
function Write-Note($text) { Write-Host "  $text" -ForegroundColor DarkGray }

function Test-HasNvidiaGpu {
  try {
    & nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Get-FileSizeText($path) {
  if (-not (Test-Path $path)) { return "missing" }
  $bytes = (Get-Item $path).Length
  if ($bytes -ge 1GB) { return "{0:N1} GB" -f ($bytes / 1GB) }
  return "{0:N0} MB" -f ($bytes / 1MB)
}

# curl.exe ships with Windows 10 and later, resumes partial downloads with -C -,
# and shows a progress meter. Invoke-WebRequest does none of those well for a
# file this size.
function Get-RemoteFile($url, $destination, $description) {
  Write-Host "  fetching $description..."
  $directory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force $directory | Out-Null
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $destination $url
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed for $description (curl exit code $LASTEXITCODE). Run this script again to resume."
  }
}

Write-Host ""
Write-Host "The Common Confessor - local model setup" -ForegroundColor Cyan
Write-Host "----------------------------------------"

$useCuda = -not $Cpu
if ($useCuda -and -not (Test-HasNvidiaGpu)) {
  Write-Note "No NVIDIA card detected; installing the CPU runtime instead."
  Write-Note "The game will work, but the villagers will answer slowly."
  Write-Note "Google Gemini's free tier is the better option on this machine:"
  Write-Note "start the game and choose Settings -> Google Gemini."
  $useCuda = $false
}

if ($useCuda) {
  $runtimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-win-cuda-12.4-x64.zip"
  $cudartUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$release/cudart-llama-bin-win-cuda-12.4-x64.zip"
} else {
  $runtimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-win-cpu-x64.zip"
  $cudartUrl = $null
}

New-Item -ItemType Directory -Force $runtimeBin, $modelRoot | Out-Null

# An install already usable by this game, possibly the shared one beside a
# sibling project. Worth checking before spending four gigabytes on
# a second copy of a file the machine already has.
$existingModel = Get-ModelPath
$existingServer = Get-ServerExePath

if (-not $Force -and $existingModel -and $existingServer) {
  Write-Host ""
  Write-Host "Already installed." -ForegroundColor Green
  Write-Note "runtime: $existingServer"
  Write-Note "model:   $existingModel ($(Get-FileSizeText $existingModel))"
  Write-Host ""
  Write-Host "  Start the game with:  .\start.cmd"
  Write-Host "  Re-download anyway:   .\scripts\setup-local-ai.ps1 -Force"
  Write-Host ""
  return
}

# ---------------------------------------------------------------- runtime ----
Write-Step "1 of 2  The runtime that serves the model"

if ((Test-Path $serverExe) -and -not $Force) {
  Write-Note "already installed: $serverExe"
} else {
  $runtimeZip = Join-Path $runtimeRoot "llama-runtime.zip"
  Get-RemoteFile $runtimeUrl $runtimeZip "llama.cpp $release ($(if ($useCuda) { 'CUDA' } else { 'CPU' }))"
  Expand-Archive -Path $runtimeZip -DestinationPath $runtimeBin -Force
  Remove-Item $runtimeZip -Force -ErrorAction SilentlyContinue

  if ($cudartUrl) {
    $cudartZip = Join-Path $runtimeRoot "llama-cudart.zip"
    Get-RemoteFile $cudartUrl $cudartZip "the CUDA runtime libraries"
    Expand-Archive -Path $cudartZip -DestinationPath $runtimeBin -Force
    Remove-Item $cudartZip -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $serverExe)) {
    throw "llama-server.exe is not where it was expected after unpacking: $serverExe"
  }
  Write-Note "installed: $serverExe"
}

# ------------------------------------------------------------------ model ----
Write-Step "2 of 2  The model itself (Gemma 3n E4B, about 4 GB)"

$modelReady = (Test-Path $modelPath) -and ((Get-Item $modelPath).Length -ge $modelMinimumBytes)

if ($modelReady -and -not $Force) {
  Write-Note "already installed: $modelPath ($(Get-FileSizeText $modelPath))"
} else {
  if ((Test-Path $modelPath) -and -not $Force) {
    Write-Note "resuming a partial download ($(Get-FileSizeText $modelPath) so far)"
  }
  if ($Force -and (Test-Path $modelPath)) { Remove-Item $modelPath -Force }
  Write-Note "this is the long one; it can be stopped and resumed"
  Get-RemoteFile $modelUrl $modelPath "Gemma 3n E4B (Q4_K_M)"

  $size = (Get-Item $modelPath).Length
  if ($size -lt $modelMinimumBytes) {
    Remove-Item $modelPath -Force
    throw "The model downloaded incompletely ($([Math]::Round($size / 1MB)) MB). Run this script again to retry."
  }
  Write-Note "installed: $modelPath ($(Get-FileSizeText $modelPath))"
}

# ------------------------------------------------------------------ check ----
Write-Step "Checking the model will actually load"

$probe = Start-Process -FilePath $serverExe -PassThru -WindowStyle Hidden -ArgumentList @(
  "--model", "`"$modelPath`"",
  "--port", "$(Get-AiPort)",
  "--ctx-size", "512",
  "--gpu-layers", $(if ($useCuda) { "99" } else { "0" })
)

$ready = $false
try {
  for ($i = 0; $i -lt 90; $i++) {
    if ($probe.HasExited) { break }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$(Get-AiPort)/health" -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
  }
} finally {
  if (-not $probe.HasExited) { Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
if ($ready) {
  Write-Host "The parish has a voice." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Start the game with:  .\start.cmd"
  Write-Host "  Stop it again with:   .\stop.cmd"
} else {
  Write-Host "The files are installed, but the model did not answer within three minutes." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Try starting it yourself with .\start.cmd and watch for an error."
  Write-Host "  On a machine without much video memory, try:  .\start.cmd -ContextSize 4096"
  Write-Host "  Or skip the local model entirely: Settings -> Google Gemini."
}
Write-Host ""
