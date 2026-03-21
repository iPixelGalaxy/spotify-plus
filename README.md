# Spotify Plus

`spotify-plus` is a Spicetify extension focused on cleaning up Spotify’s UI, making playlist actions more usable, and adding a few quality-of-life tools that Spotify does not expose cleanly by default.

## What It Does

### Settings And Entry Points

- Adds a `Spotify+` entry to Spotify’s profile menu.
- Opens a custom `Spotify+ Settings` panel inside Spotify.
- Stores all settings in `Spicetify.LocalStorage`.

### Profile Menu Cleanup

- Hide `Your Updates`.
- Hide `Home config`.
- Hide `Account`.
- Hide `Profile`.
- Hide `Support`.
- Hide `Private Session`.
- Hide `Log out`.

### Player Cleanup And Tools

- Hide the `Friend Activity` button.
- Hide the `Lyrics` button.
- Hide the `Miniplayer` button.
- Reload Spotify with `F5`.
- Break into devtools with `F8`.
- Best-effort devtools opening on startup when Spotify exposes a working API.
- Restore the previous Spotify route across launches.

### Add To Playlist Override

- Replaces Spotify’s unstable folder-hover behavior for `Add to playlist`.
- Lets you refresh and cache playlist folders from your library.
- Lets you select multiple folders to expose in the generated menu.
- Uses each selected folder independently.
  - Selecting a parent folder only shows playlists directly inside that folder.
  - Nested subfolders only contribute if they are explicitly selected too.
- Routes clicks back through Spotify’s native add-to-playlist action path.
- Filters out non-addable and generated playlists such as:
  - `daylist`
  - `Discover Weekly`
  - `DJ On Repeat`
  - other `Made for you` / non-editable playlist rows when Spotify metadata exposes them

### Copy Context Menu

- Adds a `Copy` submenu for single-track context menus.
- Adds a `Copy IDs` action for multi-select track context menus.
- `Copy Song & Artist Name`
  - copies `Song - Artist`
- `Copy ID`
  - copies a single track id
- `Copy IDs`
  - copies selected track ids as `id1, id2, id3`
- Reorders the copy entry to sit above Spotify’s `Share` item.

### Experimental Features Modal Redesign

- Restyles Spotify’s `Experimental features` modal with a cleaner custom layout.
- Moves the search field into the modal header.
- Adds local search/filtering for the feature rows.

## Install

### One-Line PowerShell Install

Run this in PowerShell:

```powershell
irm https://raw.githubusercontent.com/iPixelGalaxy/spotify-plus/master/install.ps1 | iex
```

### ⚠️ PowerShell Install Warning

`spotify-plus` enables a few persistent client behaviors that uninstalling the extension will not automatically undo:

- developer tools can remain enabled in Spotify (**Note:** messing around with the toggle to run dev-tools on start may be required)
- `F5` reload behavior can remain available (honestly, this is just useful)
- last-view route memory can persist across Spotify restarts (allegedly a native spotify feature, I've never seen this behave consistently)

To fully clear the related Spotify/XPUI client state, fully close Spotify and run:

```powershell
(Get-Content "$env:APPDATA\Spotify\prefs") `
  -replace '(?m)^app\.enable-developer-mode=.*$', 'app.enable-developer-mode=false' `
  | Set-Content "$env:APPDATA\Spotify\prefs"

Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Sessions" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Session Storage" -ErrorAction SilentlyContinue
```

This clears Spotify’s persisted XPUI/session state and can reset client preferences and session-related UI state (**Including** all user setting and plugin configs).

The installer will:

- install Spicetify if it is missing
- download the latest `spotify-plus.js` release asset
- place it in your Spicetify `Extensions` folder
- add it to your Spicetify config
- run `spicetify backup apply`

### Manual Install

1. Install Spicetify.
2. Build this repo:

```powershell
npm ci
npm run build
```

3. Copy `dist/spotify-plus.js` into your Spicetify extensions folder.
4. Enable it:

```powershell
spicetify config extensions spotify-plus.js
spicetify backup apply
```

## Development

```powershell
npm ci
npm run dev
```

Useful scripts:

- `npm run build`
- `npm run lint`
- `npm run fmt`

## Release

This repo includes a manual GitHub Actions workflow at `.github/workflows/release.yml`.

It:

- installs dependencies
- builds the extension
- packages release assets
- publishes a manual GitHub release with:
  - `spotify-plus.js`
  - a versioned zip bundle

### ⚠️ Release Warning

Release builds have the same persistence caveat as the PowerShell installer:

- uninstalling the extension does not automatically disable Spotify developer tools again
- uninstalling does not automatically clear the remembered last-view route
- uninstalling does not automatically revert any XPUI/session storage state created while using the extension

If you need to fully reset that client state, close Spotify and run:

```powershell
(Get-Content "$env:APPDATA\Spotify\prefs") `
  -replace '(?m)^app\.enable-developer-mode=.*$', 'app.enable-developer-mode=false' `
  | Set-Content "$env:APPDATA\Spotify\prefs"

Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Sessions" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Spotify\Default\Session Storage" -ErrorAction SilentlyContinue
```

That reset can also clear Spotify client preferences and session/UI state.

## Notes

- The PowerShell installer expects this repo to be published at `iPixelGalaxy/spotify-plus`.
- If you fork or rename the repo, update the constants at the top of `install.ps1`.
