$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$commonCrownRoot = Join-Path (Split-Path -Parent $projectRoot) "The Common Crown"
$gamePort = if ($env:PORT) { [int]$env:PORT } else { 8086 }
$aiContextSize = if ($env:LOCAL_AI_CONTEXT_SIZE) { [int]$env:LOCAL_AI_CONTEXT_SIZE } else { 8192 }

while ($true) {
  try {
    $probe = Invoke-WebRequest "http://127.0.0.1:$gamePort/" -UseBasicParsing -TimeoutSec 1
    if ($probe.Content -match "<title>The Common Confessor</title>") {
      Write-Host "The Common Confessor is already running at http://127.0.0.1:$gamePort"
      exit 0
    }
    $gamePort += 1
  } catch {
    break
  }
}

try {
  $health = Invoke-RestMethod "http://127.0.0.1:8095/health" -TimeoutSec 2
  if ($health.status -ne "ok") { throw "Local model unavailable" }
} catch {
  $startAi = Join-Path $commonCrownRoot "scripts\start-local-ai.ps1"
  if (-not (Test-Path $startAi)) {
    throw "The Common Crown local AI was not found at '$commonCrownRoot'."
  }
  Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $startAi,
    "-GamePort", $gamePort,
    "-ContextSize", $aiContextSize
  ) -WorkingDirectory $commonCrownRoot
  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep -Seconds 3
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:8095/health" -TimeoutSec 2
      if ($health.status -eq "ok") { break }
    } catch {
      if ((Get-Date) -ge $deadline) {
        throw "The Common Crown Gemma model did not become ready within five minutes."
      }
    }
  } while ($true)
}

$env:PORT = $gamePort
Write-Host "The Common Confessor and The Common Crown's Gemma model are ready."
Write-Host "Open http://127.0.0.1:$gamePort"
node (Join-Path $PSScriptRoot "server.mjs")
