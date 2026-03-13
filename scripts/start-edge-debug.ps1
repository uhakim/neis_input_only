$port = 9222
$userDataDir = Join-Path $PSScriptRoot "..\\browser-profile\\edge"
$edgePaths = @(
  "$env:ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:LocalAppData\\Microsoft\\Edge\\Application\\msedge.exe"
)

$edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edgeExe) {
  $edgeCommand = Get-Command msedge -ErrorAction SilentlyContinue
  if ($edgeCommand) {
    $edgeExe = $edgeCommand.Source
  }
}

if (-not $edgeExe) {
  throw "Microsoft Edge executable was not found. Use ./scripts/start-chrome-debug.ps1 on this PC, or update this script with your Edge install path."
}

New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null

Start-Process -FilePath $edgeExe -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$userDataDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  "about:blank"
)
