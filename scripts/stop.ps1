<#
.SYNOPSIS
  Stops The Common Confessor's game server and local model, and reports the
  GPU memory reclaimed.

.DESCRIPTION
  Closing the console window does not always tear down the model runner, and an
  orphaned runner keeps its GPU allocation until it is killed — which silently
  pushes the next session onto the CPU. Run this to reclaim it.

  Only processes belonging to this project are touched. Local-AI runners from
  other projects on this machine are matched out by executable path and left
  alone.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$before = Get-FreeVramMb

Write-Host ""
Write-Host "Stopping The Common Confessor" -ForegroundColor Cyan
Write-Host "-----------------------------"

$stopped = Stop-ConfessorProcesses

if ($stopped -eq 0) {
  Write-Host "Nothing was running." -ForegroundColor Yellow
} else {
  Write-Host "Stopped $stopped process(es)." -ForegroundColor Green
}

$leftovers = @(Get-OurModelProcesses) + @(Get-OurGameServerProcesses)
if ($leftovers.Count -gt 0) {
  Write-Host "WARNING: $($leftovers.Count) process(es) did not exit." -ForegroundColor Red
} else {
  $after = Get-FreeVramMb
  if ($null -ne $after) {
    $reclaimed = if ($null -ne $before) { $after - $before } else { 0 }
    if ($reclaimed -gt 0) {
      Write-Host "GPU: ${after} MB free (reclaimed ${reclaimed} MB)."
    } else {
      Write-Host "GPU: ${after} MB free."
    }
  }
}

$others = Get-Process -Name llama-server, ollama -ErrorAction SilentlyContinue
if ($others) {
  Write-Host ""
  Write-Host "Note: other local-AI processes are still running and were left alone:" -ForegroundColor DarkGray
  foreach ($proc in $others) {
    $path = $null
    try { $path = $proc.Path } catch { }
    Write-Host "  pid $($proc.Id)  $($proc.ProcessName)  $path" -ForegroundColor DarkGray
  }
}

Write-Host ""
