<#
.SYNOPSIS
  Starts The Common Confessor: the local model, the game server, and a browser.

.DESCRIPTION
  Measured lessons this script encodes:

  * Full GPU offload matters more than anything else. On this machine the same
    model runs at ~8.6 tok/s with partial offload and ~36 tok/s fully offloaded,
    which is the difference between a 60-second reply and a 3-second one.
  * A leaked runner from an earlier session keeps its GPU allocation forever and
    silently forces the next model onto the CPU. We sweep before launching.
  * Free VRAM is the constraint that decides all of the above, so we report it
    and fall back to partial offload rather than failing to start.

.PARAMETER Port
  Game port. Defaults to 8086, or the first free port after it.

.PARAMETER ContextSize
  Model context window. 8192 is the default; 16384 costs more VRAM.

.PARAMETER GpuLayers
  Layers to offload. Defaults to automatic based on free VRAM.

.PARAMETER NoBrowser
  Do not open a browser window.
#>
[CmdletBinding()]
param(
  [int]$Port = 0,
  [ValidateSet(4096, 8192, 16384)][int]$ContextSize = 0,
  [int]$GpuLayers = 0,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$confessorRoot = Get-ConfessorRoot
$aiPort = Get-AiPort

if ($Port -le 0) { $Port = if ($env:PORT) { [int]$env:PORT } else { 8086 } }
if ($ContextSize -le 0) {
  $ContextSize = if ($env:LOCAL_AI_CONTEXT_SIZE) { [int]$env:LOCAL_AI_CONTEXT_SIZE } else { 8192 }
}

$modelPath = Get-ModelPath
$serverExe = Get-ServerExePath

Write-Host ""
Write-Host "The Common Confessor" -ForegroundColor Cyan
Write-Host "--------------------"

if (-not $serverExe -or -not $modelPath) {
  throw @"
The local model is not installed yet.

Run this once to fetch it (about 4 GB, and it can be resumed):

    .\scripts\setup-local-ai.ps1

If you would rather not download a model at all, the game can use Google
Gemini's free tier instead: start it with .\start.cmd, then choose
Settings -> Google Gemini and paste an API key.
"@
}

# 1. Clear anything this project leaked previously. Other projects are untouched.
$alreadyRunning = (Test-GameReady -Port $Port) -and (Test-AiReady)
if ($alreadyRunning) {
  Write-Host "Already running at http://127.0.0.1:$Port" -ForegroundColor Green
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" | Out-Null }
  exit 0
}

$stale = @(Get-OurModelProcesses) + @(Get-OurGameServerProcesses)
if ($stale.Count -gt 0) {
  Write-Host "Clearing $($stale.Count) leftover process(es) from a previous session..."
  Stop-ConfessorProcesses | Out-Null
}

# 2. Choose an offload level that actually fits.
$freeVram = Get-FreeVramMb
if ($GpuLayers -le 0) {
  if ($null -eq $freeVram) {
    $GpuLayers = 99
  } elseif ($freeVram -ge 4600) {
    $GpuLayers = 99
  } elseif ($freeVram -ge 3200) {
    $GpuLayers = 24
  } else {
    $GpuLayers = 12
  }
}
if ($null -ne $freeVram) {
  $vramNote = if ($GpuLayers -ge 99) { "full GPU offload" } else { "partial offload ($GpuLayers layers)" }
  Write-Host "GPU: ${freeVram} MB free -> $vramNote"
  if ($freeVram -lt 4600) {
    Write-Host "  Replies will be slower. Closing Chrome/Edge/other GPU apps frees the most memory." -ForegroundColor Yellow
  }
}

# 3. Start the model.
Write-Host "Starting the local model on port $aiPort (context $ContextSize)..."
$aiArgs = @(
  "--model", "`"$modelPath`"",
  "--host", "127.0.0.1",
  "--port", "$aiPort",
  "--ctx-size", "$ContextSize",
  "--parallel", "1",
  "--threads", "8",
  "--threads-batch", "12",
  "--gpu-layers", "$GpuLayers",
  "--flash-attn", "auto",
  "--cors-origins", "http://127.0.0.1:$Port",
  "--jinja",
  "--no-webui"
)
$aiProcess = Start-Process -FilePath $serverExe -ArgumentList $aiArgs -WorkingDirectory (Split-Path -Parent $serverExe) -WindowStyle Minimized -PassThru

$deadline = (Get-Date).AddMinutes(5)
while (-not (Test-AiReady)) {
  if ($aiProcess.HasExited) { throw "The local model exited during startup (exit code $($aiProcess.ExitCode))." }
  if ((Get-Date) -ge $deadline) {
    Stop-ProcessTree -ProcessId $aiProcess.Id
    throw "The local model did not become ready within five minutes."
  }
  Start-Sleep -Seconds 3
}
Write-Host "  model ready (pid $($aiProcess.Id))" -ForegroundColor Green

# 4. Pick a free game port and start the server.
while ($true) {
  $inUse = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $inUse) { break }
  Write-Host "  port $Port is busy, trying $($Port + 1)"
  $Port += 1
}

$env:PORT = "$Port"
Write-Host "Starting the game server on port $Port..."
$serverScript = Join-Path $PSScriptRoot "server.mjs"
$gameProcess = Start-Process -FilePath "node" -ArgumentList @("`"$serverScript`"") -WorkingDirectory $confessorRoot -WindowStyle Minimized -PassThru

$deadline = (Get-Date).AddSeconds(45)
while (-not (Test-GameReady -Port $Port)) {
  if ($gameProcess.HasExited) { throw "The game server exited during startup (exit code $($gameProcess.ExitCode))." }
  if ((Get-Date) -ge $deadline) { throw "The game server did not respond on port $Port." }
  Start-Sleep -Seconds 1
}
Write-Host "  game server ready (pid $($gameProcess.Id))" -ForegroundColor Green

Write-Host ""
Write-Host "Ready: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Stop it with stop.cmd (or scripts\stop.ps1)."
Write-Host ""

if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" | Out-Null }
