$ErrorActionPreference = "Stop"

$RepoOwner = "iPixelGalaxy"
$RepoName = "spotify-plus"
$AssetName = "spotify-plus.js"

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
}

function Write-Step([string]$Text) {
    Write-Host $Text -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host $Text -ForegroundColor Red
}

function Write-Muted([string]$Text) {
    Write-Host $Text -ForegroundColor DarkGray
}

function Get-SpicetifyExe {
    $command = Get-Command spicetify -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"),
        (Join-Path $env:USERPROFILE "spicetify-cli\spicetify.exe"),
        (Join-Path $env:USERPROFILE ".spicetify\spicetify.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Spicetify could not be found."
}

function Confirm-ClearUserSettings {
    Write-Host ""
    Write-Warn "⚠️ Clear All User Settings?"
    Write-Muted "This resets Spotify developer mode, sessions, and cached XPUI state."
    Write-Muted "Default: No"
    do {
        $answer = Read-Host "Clear all user settings too? [y/N]"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            return $false
        }

        switch ($answer.Trim().ToLowerInvariant()) {
            "y" { return $true }
            "yes" { return $true }
            "n" { return $false }
            "no" { return $false }
        }
    } while ($true)
}

function Disable-SpotifyDeveloperMode {
    $prefsPath = Join-Path $env:APPDATA "Spotify\prefs"
    if (-not (Test-Path $prefsPath)) {
        return
    }

    $prefsContent = Get-Content $prefsPath -Raw
    if ($prefsContent -match "(?m)^app\.enable-developer-mode=") {
        $updated = $prefsContent -replace "(?m)^app\.enable-developer-mode=.*$", "app.enable-developer-mode=false"
        Set-Content -Path $prefsPath -Value $updated
    }
}

function Clear-SpotifyClientState {
    Disable-SpotifyDeveloperMode
    Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Sessions" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Session Storage" -ErrorAction SilentlyContinue
}

$spicetifyExe = Get-SpicetifyExe
$extensionsRoot = & $spicetifyExe path -e root
$destination = Join-Path $extensionsRoot $AssetName

Write-Section "Uninstall"
Write-Step "Removing Spotify Plus from Spicetify config..."
& $spicetifyExe config extensions "$AssetName-" | Out-Null

if (Test-Path $destination) {
    Write-Step "Removing installed extension file..."
    Remove-Item -Force $destination
}

$clearUserSettings = Confirm-ClearUserSettings
if ($clearUserSettings) {
    Write-Section "Reset"
    Write-Step "Clearing Spotify client state..."
    Clear-SpotifyClientState
}

Write-Section "Apply"
Write-Step "Applying Spicetify changes..."
& $spicetifyExe backup apply
& $spicetifyExe apply

Write-Host ""
Write-Step "Spotify Plus uninstalled."
Write-Muted "Install again later with:"
Write-Muted "irm https://raw.githubusercontent.com/$RepoOwner/$RepoName/master/install.ps1 | iex"
