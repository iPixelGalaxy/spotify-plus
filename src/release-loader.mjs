const OWNER = "iPixelGalaxy";
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CACHE_NAME = "lyrics-release-runtimes-v1";
const manifestKey = repo => `release-loader:${OWNER}/${repo}`;
const runtimeKey = repo => `https://api.github.com/repos/${OWNER}/${repo}/cached-runtime`;

function validRelease(repo, release, assetName) {
  if (!release || !VERSION.test(release.version) || release.assetName !== assetName(release.version)) return false;
  try {
    const url = new URL(release.url);
    return url.origin === "https://github.com" && url.pathname ===
      `/${OWNER}/${repo}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(release.assetName)}` &&
      (!release.digest || /^sha256:[a-f0-9]{64}$/i.test(release.digest));
  } catch { return false; }
}

export async function fetchGitHubRelease(repo, assetName) {
  let cached;
  try { cached = JSON.parse(globalThis.Spicetify.LocalStorage.get(manifestKey(repo)) ?? "null"); } catch { /* Fetch a fresh manifest. */ }
  if (validRelease(repo, cached, assetName) && Date.now() - cached.checkedAt >= 0 && Date.now() - cached.checkedAt < 60_000) return cached;
  try {
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/releases/latest`, {
      credentials: "omit", cache: "no-store", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`GitHub release lookup failed: ${response.status}`);
    const data = await response.json();
    const version = typeof data.tag_name === "string" ? data.tag_name.replace(/^v/, "") : "";
    if (!VERSION.test(version) || data.draft || data.prerelease || !Array.isArray(data.assets)) throw new Error("Invalid published release");
    const asset = data.assets.find(item => item.name === assetName(version));
    const release = { version, tag: data.tag_name, assetName: assetName(version), url: asset?.browser_download_url, digest: asset?.digest ?? null, checkedAt: Date.now() };
    if (!validRelease(repo, release, assetName)) throw new Error("Published release is missing its runtime asset");
    try { globalThis.Spicetify.LocalStorage.set(manifestKey(repo), JSON.stringify(release)); } catch { /* Cache storage is optional. */ }
    return release;
  } catch (error) {
    if (validRelease(repo, cached, assetName)) return cached;
    throw error;
  }
}

async function verify(bytes, digest) {
  if (!bytes.byteLength || bytes.byteLength > 8_000_000) throw new Error("Invalid runtime bundle size");
  if (!digest) return;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (`sha256:${hex}` !== digest.toLowerCase()) throw new Error("Runtime checksum does not match the published release");
}

export async function getGitHubBundle(repo, assetName) {
  let cache, cached;
  try {
    cache = await caches.open(CACHE_NAME);
    cached = await cache.match(runtimeKey(repo));
  } catch { /* The loader can run without an offline cache. */ }
  try {
    const release = await fetchGitHubRelease(repo, assetName);
    if (cached?.headers.get("x-release-version") === release.version && cached.headers.get("x-release-digest") === (release.digest ?? "")) {
      try {
        const bytes = await cached.clone().arrayBuffer();
        await verify(bytes, release.digest);
        return { version: release.version, bytes };
      } catch { cached = undefined; }
    }
    // Release downloads lack browser CORS headers; use Spicetify's existing public proxy.
    const response = await fetch(`https://cors-proxy.spicetify.app/${release.url}`, {
      credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    await verify(bytes, release.digest);
    try {
      await cache?.put(runtimeKey(repo), new Response(bytes, { headers: {
        "content-type": "text/javascript", "x-release-version": release.version, "x-release-digest": release.digest ?? "",
      } }));
    } catch { /* A cache write failure must not prevent startup. */ }
    return { version: release.version, bytes };
  } catch (error) {
    if (!cached || cached.bodyUsed) throw error;
    const version = cached.headers.get("x-release-version");
    if (!version || !VERSION.test(version)) throw error;
    const bytes = await cached.arrayBuffer();
    await verify(bytes, cached.headers.get("x-release-digest"));
    console.warn(`Using the cached ${repo} release after an update lookup failure:`, error);
    return { version, bytes };
  }
}

export async function importGitHubBundle(bundle) {
  const url = URL.createObjectURL(new Blob([bundle.bytes], { type: "text/javascript" }));
  try { await import(url); } finally { URL.revokeObjectURL(url); }
}
