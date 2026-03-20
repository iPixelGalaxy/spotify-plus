$ErrorActionPreference = "Stop"

$RepoOwner = "iPixelGalaxy"
$RepoName = "spotify-plus"
$AssetName = "spotify-plus.js"

function Show-InstallWarning {
    Write-Host ""
    Write-Host "WARNING: Spotify Plus enables persistent client behaviors that uninstalling the extension will not automatically undo." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This can leave behind:" -ForegroundColor Yellow
    Write-Host " - Spotify developer tools staying enabled"
    Write-Host " - F5 reload behavior remaining available"
    Write-Host " - remembered last-view route/session state across Spotify restarts"
    Write-Host ""
    Write-Host "To fully clear that client state later, fully close Spotify and run:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host '(Get-Content "$env:APPDATA\Spotify\prefs") `'
    Write-Host '  -replace ''(?m)^app\.enable-developer-mode=.*$'', ''app.enable-developer-mode=false'' `'
    Write-Host '  | Set-Content "$env:APPDATA\Spotify\prefs"'
    Write-Host ""
    Write-Host 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Sessions" -ErrorAction SilentlyContinue'
    Write-Host 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Session Storage" -ErrorAction SilentlyContinue'
    Write-Host ""
    Write-Host "That reset can also clear Spotify client preferences and session/UI state." -ForegroundColor Yellow
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

    Write-Host "Spicetify was not found. Installing Spicetify CLI..."
    Invoke-Expression (Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1").Content

    $spicetifyExe = Get-SpicetifyExe
    if (-not $spicetifyExe) {
        throw "Spicetify installed, but spicetify.exe could not be located afterwards."
    }

    return $spicetifyExe
}

function Get-LatestReleaseAssetUrl {
    $release = Invoke-RestMethod -Headers @{ "User-Agent" = "spotify-plus-installer" } -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1

    if (-not $asset) {
        throw "Latest release does not contain asset '$AssetName'."
    }

    return $asset.browser_download_url
}

Show-InstallWarning
if (-not (Confirm-Install)) {
    Write-Host "Install cancelled."
    return
}

$spicetifyExe = Ensure-Spicetify
$extensionsRoot = & $spicetifyExe path -e root

if (-not $extensionsRoot) {
    throw "Could not resolve Spicetify extensions directory."
}

New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null

$downloadUrl = Get-LatestReleaseAssetUrl
$destination = Join-Path $extensionsRoot $AssetName

Write-Host "Downloading $AssetName from latest release..."
Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $destination

Write-Host "Registering extension in Spicetify config..."
& $spicetifyExe config extensions "$AssetName-" extensions $AssetName | Out-Null

Write-Host "Applying Spicetify changes..."
& $spicetifyExe backup apply

Write-Host ""
Write-Host "Spotify Plus installed successfully."
Write-Host "Extension path: $destination"
