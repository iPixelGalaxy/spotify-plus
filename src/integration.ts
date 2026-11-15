type Integration = { protocol: number; phase: "loading" | "integrated" | "standalone"; hasEnhancements: boolean };
type Runtime = { protocol: 1; state: "waiting" | "active" | "standby"; loaderStarted?: boolean; bundleStarted?: boolean };
const sharedWindow = window as Window & { __LYSSNA_LYRICS_INTEGRATION__?: Integration; __SPOTIFY_PLUS_RUNTIME__?: Runtime };
export const runtime: Runtime = sharedWindow.__SPOTIFY_PLUS_RUNTIME__ ??= { protocol: 1, state: "waiting" };

export function setRuntimeState(state: Runtime["state"]) {
  runtime.state = state;
  window.dispatchEvent(new Event("spotify-plus:runtime-state"));
}
setRuntimeState(runtime.state);

export async function shouldStandDown(): Promise<boolean> {
  const configured = (Spicetify as any).Config?.extensions ?? [];
  const files: string[] = Array.isArray(configured) ? configured : String(configured).split("|");
  const expectsLyssna = files.some(file => /(?:^|[/\\])(?:lyssna-lyrics(?:@[^/\\]+)?|spicy-lyrics-pixel)\.(?:js|mjs)$/i.test(file.trim()));
  const state = sharedWindow.__LYSSNA_LYRICS_INTEGRATION__;
  if (state?.protocol === 1 && state.phase !== "loading") return state.phase === "integrated";
  if (!state && !expectsLyssna) return false;
  return new Promise(resolve => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("lyssna-lyrics:integration-state", inspect);
      resolve(value);
    };
    const inspect = () => {
      const current = sharedWindow.__LYSSNA_LYRICS_INTEGRATION__;
      if (current?.protocol === 1 && current.phase !== "loading") finish(current.phase === "integrated");
    };
    // A known loader explicitly settles on success or failure. Only time out waiting for an absent/older launcher.
    const timer = setTimeout(() => {
      if (sharedWindow.__LYSSNA_LYRICS_INTEGRATION__?.phase !== "loading") finish(false);
    }, 15000);
    window.addEventListener("lyssna-lyrics:integration-state", inspect);
    inspect();
  });
}
