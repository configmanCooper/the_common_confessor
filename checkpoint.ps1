<#
================================================================================
 checkpoint.ps1 — go back to a known-good point in this project's history
================================================================================

 WHAT IT IS FOR
   Every significant piece of work on The Common Confessor is a commit. This
   gives those commits friendly names, so you can look at, compare, or return
   to any of them without remembering a hash.

 HOW TO USE IT

   List every checkpoint, newest first:
       .\checkpoint.ps1 list

   See what a checkpoint contains, without changing anything:
       .\checkpoint.ps1 show closed-cast

   See what has changed since a checkpoint:
       .\checkpoint.ps1 diff closed-cast

   Look at the code as it was, without losing anything (read-only):
       .\checkpoint.ps1 goto closed-cast
   You end up on a detached HEAD. Come back with:
       .\checkpoint.ps1 return

   Start a branch from a checkpoint, to work from there:
       .\checkpoint.ps1 branch closed-cast my-experiment

   Undo everything after a checkpoint, keeping the changes as edits you can
   review, unstage or discard yourself:
       .\checkpoint.ps1 rewind closed-cast

   Throw away everything after a checkpoint permanently. This asks first,
   and it stashes anything uncommitted before it starts:
       .\checkpoint.ps1 reset closed-cast

   Put a checkpoint back on the remote as the current state. This rewrites
   published history and asks twice:
       .\checkpoint.ps1 publish closed-cast

 SAFETY
   Nothing here discards uncommitted work without saying so. Anything that
   could lose work stashes it first under a name you can find with
   `git stash list`, and prints how to get it back.

 ADDING A CHECKPOINT
   Add a line to the CHECKPOINTS table below: a short name, the commit, and a
   sentence saying what that commit achieved. Use the full 40-character hash
   or the short one; both work.
================================================================================
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("list", "show", "diff", "goto", "return", "branch", "rewind", "reset", "publish", "help")]
  [string]$Action = "list",

  [Parameter(Position = 1)]
  [string]$Name,

  [Parameter(Position = 2)]
  [string]$BranchName
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

# A mistyped checkpoint name should read as a sentence, not a stack trace.
function Stop-WithMessage([string]$message) {
  Write-Host ""
  Write-Host $message -ForegroundColor Red
  Write-Host ""
  exit 1
}

# Ordered newest first, which is the order `list` prints them in.
$CHECKPOINTS = [ordered]@{
  "no-phantom-gifts" = @{
    Commit = "a9030ce"
    What   = "A priest who refuses keeps his stores; a gift is read from the clause that offered it; a worry may turn out to be nothing."
  }
  "stale-objectives" = @{
    Commit = "cb142d6"
    What   = "A secret is retired once the visitor says they do not have it, instead of being feared forever."
  }
  "steward-identity" = @{
    Commit = "647d6ab"
    What   = "One man per office, household stores kept out of the villager's mouth, widows recorded as widowed, no villager called The."
  }
  "priest-is-known" = @{
    Commit = "73690c1"
    What   = "Father Benedict is recognised in his own parish instead of being stripped out as a phantom."
  }
  "no-invented-wife" = @{
    Commit = "3d7f1be"
    What   = "A villager is told the truth of their own household, so they cannot be pressed into inventing a wife."
  }
  "echo-loop" = @{
    Commit = "1b80bcd"
    What   = "A phantom no longer becomes permanent the moment the priest repeats the name back."
  }
  "family-plurals" = @{
    Commit = "00e5552"
    What   = "The Winterings may be spoken of as a family without being called an invention."
  }
  "audit-sharpened" = @{
    Commit = "b6a9aa1"
    What   = "The record check stops accusing the parish wrongly over surnames, colons and full stops."
  }
  "consequence-cause" = @{
    Commit = "b4993c5"
    What   = "A follow-up visit carries the promise, the outcome and the person it concerned."
  }
  "playtester-report" = @{
    Commit = "8de53a1"
    What   = "A readable report of everything the playtesting priest found."
  }
  "closed-cast" = @{
    Commit = "07f4c49"
    What   = "The model is handed the complete cast list with sex, age and trade, and answers for anyone the priest names."
  }
  "grounded-dialogue" = @{
    Commit = "3fcc2f6"
    What   = "Nobody is cast in a part they could not play, and scenario templates stop showing through."
  }
  "ai-playtester" = @{
    Commit = "d64ca74"
    What   = "The AiHumanPlaytester persona, which checks every answer against the parish record."
  }
  "grounded-facts" = @{
    Commit = "3bc91b2"
    What   = "No invented debts, no grief for the living, no confessed fever the engine never gave anybody."
  }
  "parish-past" = @{
    Commit = "d9d6ec0"
    What   = "The parish opens with graves, unequal households, and villagers who remember things."
  }
  "villager-names" = @{
    Commit = "b6c741b"
    What   = "Villager names are grounded in the real parish, and church charity is measured."
  }
  "published" = @{
    Commit = "bd9941c"
    What   = "The state of the game when it was first pushed to GitHub."
  }
}

function Write-Heading([string]$text) {
  Write-Host ""
  Write-Host $text -ForegroundColor Cyan
  Write-Host ("-" * $text.Length) -ForegroundColor DarkGray
}

function Resolve-Checkpoint([string]$name) {
  if (-not $name) {
    Stop-WithMessage "This needs a checkpoint name. Run '.\checkpoint.ps1 list' to see them."
  }
  if (-not $CHECKPOINTS.Contains($name)) {
    $close = $CHECKPOINTS.Keys | Where-Object { $_ -like "*$name*" }
    $hint = if ($close) { " Did you mean: $($close -join ', ')?" } else { " Run '.\checkpoint.ps1 list' to see them." }
    Stop-WithMessage "No checkpoint called '$name'.$hint"
  }
  $entry = $CHECKPOINTS[$name]
  # Confirm the commit is actually in this clone before acting on it.
  git rev-parse --verify --quiet "$($entry.Commit)^{commit}" > $null 2>&1
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Checkpoint '$name' points at commit $($entry.Commit), which is not in this repository. Try 'git fetch --all' first."
  }
  return $entry
}

function Get-UncommittedWork {
  $status = git status --porcelain
  return [bool]$status
}

function Save-UncommittedWork([string]$why) {
  if (-not (Get-UncommittedWork)) { return $false }
  $label = "checkpoint-script/$why/$(Get-Date -Format 'yyyy-MM-dd-HHmmss')"
  Write-Host "You have uncommitted changes. Stashing them as '$label' before going on." -ForegroundColor Yellow
  git stash push --include-untracked --message $label | Out-Null
  Write-Host "Get them back with:  git stash pop" -ForegroundColor Yellow
  return $true
}

function Show-CurrentPosition {
  $branch = git rev-parse --abbrev-ref HEAD
  $short = git rev-parse --short HEAD
  $subject = git log -1 --pretty=%s
  Write-Host ""
  Write-Host "You are now at $short on $branch" -ForegroundColor Green
  Write-Host "  $subject" -ForegroundColor DarkGray
}

# Anything that rewrites history must act on the branch it claims to act on.
# `goto` leaves a detached HEAD and `branch` leaves you elsewhere entirely, so
# a reset here would destroy that branch's commits while pushing an untouched
# main - losing work and publishing nothing.
function Assert-OnMain([string]$action) {
  $branch = git rev-parse --abbrev-ref HEAD
  if ($branch -ne "main") {
    Stop-WithMessage @"
'$action' rewrites the history of main, but you are on '$branch'.
Get back to main first:   .\checkpoint.ps1 return
"@
  }
}

switch ($Action) {

  "help" {
    Get-Content -LiteralPath $PSCommandPath -TotalCount 60 |
      Where-Object { $_ -notmatch '^<#|^#>' } |
      ForEach-Object { $_ }
  }

  "list" {
    Write-Heading "Checkpoints, newest first"
    $current = git rev-parse HEAD
    foreach ($name in $CHECKPOINTS.Keys) {
      $entry = $CHECKPOINTS[$name]
      git rev-parse --verify --quiet "$($entry.Commit)^{commit}" > $null 2>&1
      $missing = $LASTEXITCODE -ne 0
      $here = ""
      if (-not $missing) {
        $full = git rev-parse "$($entry.Commit)^{commit}"
        if ($full -eq $current) { $here = "  <- you are here" }
      }
      $marker = if ($missing) { " (not in this clone)" } else { $here }
      Write-Host ("  {0,-20} {1}{2}" -f $name, $entry.Commit, $marker) -ForegroundColor $(if ($here) { "Green" } else { "White" })
      Write-Host ("  {0,-20} {1}" -f "", $entry.What) -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  .\checkpoint.ps1 show <name>     what that commit changed" -ForegroundColor DarkGray
    Write-Host "  .\checkpoint.ps1 goto <name>     look at the code as it was" -ForegroundColor DarkGray
    Write-Host "  .\checkpoint.ps1 return          come back to main" -ForegroundColor DarkGray
    Write-Host ""
  }

  "show" {
    $entry = Resolve-Checkpoint $Name
    Write-Heading "$Name — $($entry.Commit)"
    Write-Host $entry.What -ForegroundColor DarkGray
    Write-Host ""
    git --no-pager show --stat --pretty=fuller $entry.Commit
  }

  "diff" {
    $entry = Resolve-Checkpoint $Name
    Write-Heading "What has changed since '$Name'"
    git --no-pager diff --stat $entry.Commit HEAD
    Write-Host ""
    Write-Host "Full diff:  git diff $($entry.Commit) HEAD" -ForegroundColor DarkGray
  }

  "goto" {
    $entry = Resolve-Checkpoint $Name
    Save-UncommittedWork "goto" | Out-Null
    git checkout --quiet $entry.Commit
    Show-CurrentPosition
    Write-Host ""
    Write-Host "This is a detached HEAD: look all you like, but commits made here are easy to lose." -ForegroundColor Yellow
    Write-Host "Come back with:              .\checkpoint.ps1 return" -ForegroundColor Yellow
    Write-Host "Or keep this point as work:  .\checkpoint.ps1 branch $Name <new-branch-name>" -ForegroundColor Yellow
  }

  "return" {
    Save-UncommittedWork "return" | Out-Null
    git checkout --quiet main
    Show-CurrentPosition
  }

  "branch" {
    $entry = Resolve-Checkpoint $Name
    if (-not $BranchName) {
      Stop-WithMessage "Give the new branch a name:  .\checkpoint.ps1 branch $Name my-experiment"
    }
    Save-UncommittedWork "branch" | Out-Null
    git checkout --quiet -b $BranchName $entry.Commit
    Show-CurrentPosition
    Write-Host ""
    Write-Host "You are on a new branch from '$Name'. Nothing on main has changed." -ForegroundColor Green
  }

  "rewind" {
    $entry = Resolve-Checkpoint $Name
    Write-Heading "Rewinding to '$Name', keeping the changes"
    Write-Host "Everything committed after this point becomes uncommitted edits you can review." -ForegroundColor Yellow
    git reset --mixed $entry.Commit
    Show-CurrentPosition
    Write-Host ""
    Write-Host "Look at what came back with:  git status" -ForegroundColor DarkGray
    Write-Host "Throw it away with:           git checkout -- ." -ForegroundColor DarkGray
  }

  "reset" {
    $entry = Resolve-Checkpoint $Name
    Assert-OnMain "reset"
    Write-Heading "Hard reset to '$Name'"
    Write-Host $entry.What -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "This throws away every commit after $($entry.Commit) on this branch." -ForegroundColor Red
    git --no-pager log --oneline "$($entry.Commit)..HEAD"
    Write-Host ""
    $answer = Read-Host "Type the checkpoint name to confirm"
    if ($answer -ne $Name) {
      Write-Host "Nothing was changed." -ForegroundColor Green
      break
    }
    Save-UncommittedWork "reset" | Out-Null
    git reset --hard $entry.Commit
    Show-CurrentPosition
    Write-Host ""
    Write-Host "The commits are still reachable for a while: git reflog" -ForegroundColor DarkGray
  }

  "publish" {
    $entry = Resolve-Checkpoint $Name
    Assert-OnMain "publish"
    Write-Heading "Publishing '$Name' as the state of origin/main"
    Write-Host "This rewrites published history. Anyone else with a clone will have to recover by hand." -ForegroundColor Red
    Write-Host ""
    git --no-pager log --oneline "$($entry.Commit)..HEAD"
    Write-Host ""
    $answer = Read-Host "Type the checkpoint name to confirm"
    if ($answer -ne $Name) { Write-Host "Nothing was changed." -ForegroundColor Green; break }
    $second = Read-Host "This cannot be undone from here. Type PUBLISH to go ahead"
    if ($second -ne "PUBLISH") { Write-Host "Nothing was changed." -ForegroundColor Green; break }
    Save-UncommittedWork "publish" | Out-Null
    git reset --hard $entry.Commit
    # A failed reset must never be followed by a force-push.
    if ($LASTEXITCODE -ne 0) {
      Stop-WithMessage "The reset failed, so nothing was pushed. Your branch is unchanged."
    }
    git push --force-with-lease origin main
    if ($LASTEXITCODE -ne 0) {
      Stop-WithMessage "The push was refused. Your local branch has moved; run 'git fetch' and look before trying again."
    }
    Show-CurrentPosition
  }
}
