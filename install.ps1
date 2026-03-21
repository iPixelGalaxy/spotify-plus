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

function Show-InstallWarning {
    Write-Host ""
    Write-Host "To fully clear Spotify Plus client state later, fully close Spotify and run:" -ForegroundColor Yellow
    Write-Host ""
    Write-Muted '(Get-Content "$env:APPDATA\Spotify\prefs") `'
    Write-Muted '  -replace ''(?m)^app\.enable-developer-mode=.*$'', ''app.enable-developer-mode=false'' `'
    Write-Muted '  | Set-Content "$env:APPDATA\Spotify\prefs"'
    Write-Host ""
    Write-Muted 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Sessions" -ErrorAction SilentlyContinue'
    Write-Muted 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Session Storage" -ErrorAction SilentlyContinue'
    Write-Host ""
    Write-Warn "WARNING: uninstalling Spotify Plus alone will not automatically undo these persistent client changes:"
    Write-Host " - Spotify developer tools staying enabled"
    Write-Host " - F5 reload behavior remaining available"
    Write-Host " - remembered last-view route/session state across Spotify restarts"
    Write-Host ""
    Write-Warn "WARNING: running the reset commands above can also clear Spotify client preferences and session/UI state."
    Write-Host ""
}

function Confirm-Install {
    do {
        $answer = Read-Host "Continue installing Spotify Plus? [y/N]"
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

    return $null
}

function Ensure-Spicetify {
    $spicetifyExe = Get-SpicetifyExe
    if ($spicetifyExe) {
        return $spicetifyExe
    }

    Write-Step "Spicetify was not found. Installing Spicetify CLI..."
    Invoke-Expression (Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1").Content

    $spicetifyExe = Get-SpicetifyExe
    if (-not $spicetifyExe) {
        throw "Spicetify installed, but spicetify.exe could not be located afterwards."
    }

    return $spicetifyExe
}

function Get-LatestReleaseAssetInfo {
    $release = Invoke-RestMethod -Headers @{ "User-Agent" = "spotify-plus-installer" } -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1

    if (-not $asset) {
        throw "Latest release does not contain asset '$AssetName'."
    }

    return @{
        Version = ($release.tag_name -replace '^v', '')
        DownloadUrl = $asset.browser_download_url
    }
}

function Enable-SpotifyDeveloperMode {
    $prefsPath = Join-Path $env:APPDATA "Spotify\prefs"
    $prefsDirectory = Split-Path -Parent $prefsPath

    if (-not (Test-Path $prefsDirectory)) {
        New-Item -ItemType Directory -Path $prefsDirectory -Force | Out-Null
    }

    if (-not (Test-Path $prefsPath)) {
        Set-Content -Path $prefsPath -Value "app.enable-developer-mode=true"
        return
    }

    $prefsContent = Get-Content $prefsPath -Raw
    if ($prefsContent -match "(?m)^app\.enable-developer-mode=") {
        $updated = $prefsContent -replace "(?m)^app\.enable-developer-mode=.*$", "app.enable-developer-mode=true"
        Set-Content -Path $prefsPath -Value $updated
        return
    }

    $separator = if ($prefsContent.EndsWith("`n") -or [string]::IsNullOrEmpty($prefsContent)) { "" } else { [Environment]::NewLine }
    Set-Content -Path $prefsPath -Value ($prefsContent + $separator + "app.enable-developer-mode=true")
}

Show-InstallWarning
if (-not (Confirm-Install)) {
    Write-Host "Install cancelled." -ForegroundColor Yellow
    return
}

$spicetifyExe = Ensure-Spicetify
$extensionsRoot = & $spicetifyExe path -e root

if (-not $extensionsRoot) {
    throw "Could not resolve Spicetify extensions directory."
}

New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null

$releaseInfo = Get-LatestReleaseAssetInfo
$downloadUrl = $releaseInfo.DownloadUrl
$destination = Join-Path $extensionsRoot $AssetName

Write-Section "Download"
Write-Step "Installing Spotify Plus v$($releaseInfo.Version)"
Write-Step "Downloading $AssetName from latest release..."
Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $destination

Write-Section "Install"
Write-Step "Registering extension in Spicetify config..."
& $spicetifyExe config extensions "$AssetName-" extensions $AssetName | Out-Null

Write-Step "Enabling Spotify developer tools..."
& $spicetifyExe enable-devtools | Out-Null
Enable-SpotifyDeveloperMode

Write-Step "Applying Spicetify changes..."
& $spicetifyExe backup apply
& $spicetifyExe apply

Write-Section "Done"
Write-Step "Spotify Plus v$($releaseInfo.Version) installed successfully."
Write-Muted "Extension path: $destination"
Write-Muted "Uninstall later with:"
Write-Muted "irm https://raw.githubusercontent.com/$RepoOwner/$RepoName/master/uninstall.ps1 | iex"
