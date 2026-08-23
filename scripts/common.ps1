# Shared helpers for The Common Confessor's start and stop scripts.
#
# Safety rule that matters most here: this machine also runs other local-AI
# projects. Every process this file touches is matched by EXECUTABLE PATH
# inside The Common Crown, never by process name, so a runner belonging to
# another game is never killed.

$script:ConfessorRoot = Split-Path -Parent $PSScriptRoot
$script:CommonCrownRoot = Join-Path (Split-Path -Parent $script:ConfessorRoot) "The Common Crown"
$script:AiPort = 8095

function Get-CommonCrownRoot { return $script:CommonCrownRoot }
function Get-ConfessorRoot { return $script:ConfessorRoot }
function Get-AiPort { return $script:AiPort }

function Get-FreeVramMb {
  try {
    $raw = & nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) { return [int]($raw | Select-Object -First 1).Trim() }
  } catch { }
  return $null
}

# Model runners belonging to THIS project only (path-scoped).
function Get-OurModelProcesses {
  $prefix = $script:CommonCrownRoot.TrimEnd('\') + '\'
  return Get-Process -Name llama-server -ErrorAction SilentlyContinue | Where-Object {
    $path = $null
    try { $path = $_.Path } catch { }
    $path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
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
