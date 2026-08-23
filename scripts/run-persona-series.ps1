# Runs the remaining priest personalities one after another, then a fresh
# benevolent parish to re-baseline the series against the current build.
#
# Sequential on purpose: every run drives the same local model, and two at once
# would only make each other slower and muddy the timings.
#
# A crash in one run must not take the series down with it. Each failure is
# recorded and the next persona starts, so a night of running produces either
# six parishes or a short list of things to fix.

param(
    [int]$Days = 8
)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot\..

$series = @(
    @{ Name = "run2-austere";     Persona = "austere" },
    @{ Name = "run3-political";   Persona = "political" },
    @{ Name = "run4-timid";       Persona = "timid" },
    @{ Name = "run5-pragmatic";   Persona = "pragmatic" },
    @{ Name = "run6-zealous";     Persona = "zealous" },
    @{ Name = "run7-benevolent";  Persona = "benevolent" }
)

$statusPath = "exports\series-status.json"
$results = @()

foreach ($run in $series) {
    $name = $run.Name
    $persona = $run.Persona
    $consolePath = "exports\$name.console.log"
    $started = Get-Date

    $results += [pscustomobject]@{
        name = $name; persona = $persona; status = "running"
        started = $started.ToString("s"); finished = $null; exitCode = $null; minutes = $null
    }
    $results | ConvertTo-Json -Depth 4 | Set-Content $statusPath

    Write-Output "=== $name ($persona) starting $($started.ToString('HH:mm')) ==="
    node scripts\watch-ai-playthrough.mjs --days $Days --model gpt-5.6-sol --persona $persona --name $name --seed "crowmarsh-$name" *>&1 |
        Tee-Object -FilePath $consolePath
    $code = $LASTEXITCODE
    $finished = Get-Date

    $entry = $results | Where-Object { $_.name -eq $name }
    $entry.status = if ($code -eq 0) { "completed" } else { "failed" }
    $entry.finished = $finished.ToString("s")
    $entry.exitCode = $code
    $entry.minutes = [int]($finished - $started).TotalMinutes
    $results | ConvertTo-Json -Depth 4 | Set-Content $statusPath

    Write-Output "=== $name finished: $($entry.status) (exit $code) after $($entry.minutes) min ==="
}

Write-Output "series complete"
$results | ConvertTo-Json -Depth 4 | Set-Content $statusPath
