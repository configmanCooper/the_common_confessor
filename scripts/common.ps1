# Shared helpers for The Common Confessor's start and stop scripts.
#
# Safety rule that matters most here: this machine also runs other local-AI
# projects. Every process this file touches is matched by EXECUTABLE PATH
# inside The Common Crown, never by process name, so a runner belonging to
# another game is never killed.

$script:ConfessorRoot = Split-Path -Parent $PSScriptRoot
$script:CommonCrownRoot = Join-Path (Split-Path -Parent $script:ConfessorRoot) "The Common Crown"
$script:AiPort = 8095
$script:ModelFileName = "google_gemma-3n-E4B-it-Q4_K_M.gguf"

function Get-CommonCrownRoot { return $script:CommonCrownRoot }
function Get-ConfessorRoot { return $script:ConfessorRoot }
function Get-AiPort { return $script:AiPort }
function Get-ModelFileName { return $script:ModelFileName }

# Where the model and its runtime live.
#
# This game installs both into its own folder, which is what anyone cloning the
# repository gets from scripts\setup-local-ai.ps1. It was originally written to
# borrow them from a sibling project on this machine, so that location is still
# accepted: an existing install should not have to be downloaded twice, and the
# download is four gigabytes.
function Get-AiRoots {
  $roots = @($script:ConfessorRoot)
  if (Test-Path $script:CommonCrownRoot) { $roots += $script:CommonCrownRoot }
  return $roots
}

function Get-ModelPath {
  foreach ($root in Get-AiRoots) {
    $candidate = Join-Path $root "models\$script:ModelFileName"
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Get-ServerExePath {
  foreach ($root in Get-AiRoots) {
    $candidate = Join-Path $root "tools\llama.cpp\bin\llama-server.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Get-FreeVramMb {
  try {
    $raw = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) { return [int]($raw | Select-Object -First 1).Trim() }
  } catch { }
  return $null
}

# Model runners belonging to THIS project only (path-scoped).
#
# Matched against the exact executable this game would launch, rather than by
# process name. The runtime may be the copy installed beside this game or one
# borrowed from a sibling project, and in either case only a runner started
# from that same file is ours to stop.
function Get-OurModelProcesses {
  $ourExe = Get-ServerExePath
  if (-not $ourExe) { return @() }
  return Get-Process -Name llama-server -ErrorAction SilentlyContinue | Where-Object {
    $path = $null
    try { $path = $_.Path } catch { }
    $path -and $path.Equals($ourExe, [StringComparison]::OrdinalIgnoreCase)
  }
}

# The Node process serving this game, identified by its command line.
function Get-OurGameServerProcesses {
  $marker = (Join-Path $script:ConfessorRoot 'scripts\server.mjs')
  $rows = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
  return $rows | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  # Children first, so a runner cannot be orphaned and keep its GPU allocation.
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) { Stop-ProcessTree -ProcessId ([int]$child.ProcessId) }
  try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { }
}

function Stop-ConfessorProcesses {
  param([switch]$Quiet)
  $stopped = 0
  foreach ($proc in @(Get-OurGameServerProcesses)) {
    if (-not $Quiet) { Write-Host "  stopping game server (pid $($proc.ProcessId))" }
    Stop-ProcessTree -ProcessId ([int]$proc.ProcessId)
    $stopped++
  }
  foreach ($proc in @(Get-OurModelProcesses)) {
    if (-not $Quiet) { Write-Host "  stopping local model (pid $($proc.Id))" }
    Stop-ProcessTree -ProcessId ([int]$proc.Id)
    $stopped++
  }
  if ($stopped -gt 0) { Start-Sleep -Seconds 2 }
  return $stopped
}

function Test-AiReady {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$($script:AiPort)/health" -TimeoutSec 2
    return ($health.status -eq 'ok')
  } catch { return $false }
}

function Test-GameReady {
  param([Parameter(Mandatory = $true)][int]$Port)
  try {
    $probe = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
    return ($probe.Content -match '<title>The Common Confessor</title>')
  } catch { return $false }
}
