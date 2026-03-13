$port = 9222
$userDataDir = Join-Path $PSScriptRoot "..\\browser-profile\\chrome"
$chromePaths = @(
  "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
  "$env:ProgramFiles(x86)\\Google\\Chrome\\Application\\chrome.exe",
  "$env:LocalAppData\\Google\\Chrome\\Application\\chrome.exe"
)

$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromeExe) {
  $chromeCommand = Get-Command chrome -ErrorAction SilentlyContinue
  if ($chromeCommand) {
    $chromeExe = $chromeCommand.Source
  }
}

if (-not $chromeExe) {
  throw "Google Chrome executable was not found. Update scripts/start-chrome-debug.ps1 with the local Chrome install path."
}

New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null

Start-Process -FilePath $chromeExe -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$userDataDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  "about:blank"
)
