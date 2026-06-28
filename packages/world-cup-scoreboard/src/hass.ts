/**
 * Drive a Home Assistant media_player over its REST API — enough to cast a goal
 * clip to a Chromecast/Nest Hub and (optionally) duck the volume around it.
 *
 * Casting a URL hands playback to the device, which fetches the media itself, so
 * the clip URL must be reachable by the Hub (see audioserver.ts). All calls are
 * time-boxed; the caller swallows failures so a flaky Hub never stalls the panel.
 */
export interface HassConfig {
  url: string;
  token: string;
  entity: string;
  /** 0–1; when set, the volume is raised to this for the clip then restored. */
  volume?: number;
  timeoutMs?: number;
}

async function callService(
  cfg: HassConfig,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${cfg.url}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 8_000),
  });
  if (!res.ok) throw new Error(`HA ${domain}.${service} ${res.status} ${res.statusText}`);
}

/** Read the player's current volume (0–1), or null if unavailable. */
async function currentVolume(cfg: HassConfig): Promise<number | null> {
  const res = await fetch(`${cfg.url}/api/states/${cfg.entity}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { attributes?: { volume_level?: number } };
  return body.attributes?.volume_level ?? null;
}

const setVolume = (cfg: HassConfig, level: number): Promise<void> =>
  callService(cfg, "media_player", "volume_set", { entity_id: cfg.entity, volume_level: level });

/**
 * Cast `audioUrl` to the configured player. If a goal volume is set, raise to it
 * first and restore the prior level `restoreAfterMs` later (best-effort).
 */
export async function castAudio(
  cfg: HassConfig,
  audioUrl: string,
  restoreAfterMs: number,
): Promise<void> {
  let prev: number | null = null;
  if (cfg.volume != null) {
    prev = await currentVolume(cfg);
    await setVolume(cfg, cfg.volume);
  }
  await callService(cfg, "media_player", "play_media", {
    entity_id: cfg.entity,
    media_content_id: audioUrl,
    media_content_type: "music",
  });
  if (prev != null) {
    setTimeout(() => {
      void setVolume(cfg, prev).catch(() => {});
    }, restoreAfterMs);
  }
}
