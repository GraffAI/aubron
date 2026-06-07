/**
 * HTTPS cloud API transport (brief §5, §8) — ported from the reference
 * `libflagship/httpapi.py` and the `anselor` `config login` flow.
 *
 * Handles email/password login (ECDH-encrypted password), profile + printer
 * list retrieval, and PPPP key fetch — assembling a full {@link AnkerConfig}.
 * Region-coded endpoints; the login captcha branch surfaces as a structured
 * {@link AuthError} (never a hang).
 */
import { API_HOSTS, type AnkerConfig, type AnkerPrinter, type Region } from "../config.js";
import { ppppDecodeInitstring } from "../crypto.js";
import { ecdhEncryptLoginPassword } from "../crypto.js";
import { AuthError } from "../errors.js";

type Json = Record<string, unknown>;

/** Country codes that route to the US region (reference `guess_region`). */
const US_REGIONS = new Set(["US", "CA", "MX", "BR", "AR", "CU", "BS", "AU", "NZ"]);

export function guessRegion(countryCode: string): Region {
  return US_REGIONS.has(countryCode.toUpperCase()) ? "us" : "eu";
}

const LOGIN_HEADERS: Record<string, string> = {
  App_name: "anker_make",
  App_version: "",
  Model_type: "PC",
  Os_type: "windows",
  Os_version: "10sp1",
};

export interface LoginResult {
  auth_token: string;
  user_id: string;
  email: string;
  region: Region;
  ab_code?: string;
}

export interface LoginOptions {
  email: string;
  password: string;
  /** 2-letter country code selecting the API region. */
  country: string;
  captchaId?: string;
  captchaAnswer?: string;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Low-level cloud HTTPS client for a single region. */
export class AnkerHttpApi {
  constructor(
    readonly region: Region,
    private readonly authToken?: string,
  ) {}

  private base(): string {
    return `https://${API_HOSTS[this.region]}`;
  }

  private async request(scope: string, path: string, body?: Json, auth = false): Promise<Json> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...LOGIN_HEADERS,
    };
    if (auth) {
      if (!this.authToken) throw new AuthError({ message: "Missing auth token" });
      headers["X-Auth-Token"] = this.authToken;
    }
    let resp: Response;
    try {
      resp = await fetch(`${this.base()}${scope}${path}`, {
        method: body ? "POST" : "GET",
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      throw new AuthError({
        code: "https_unreachable",
        message: `Could not reach Anker cloud API (${API_HOSTS[this.region]})`,
        retriable: true,
        hint: "Check your internet connection and try again.",
        cause,
      });
    }
    if (!resp.ok) {
      throw new AuthError({
        code: "https_error",
        message: `API request failed: ${resp.status} ${resp.statusText}`,
        retriable: resp.status >= 500,
      });
    }
    const jsn = (await resp.json()) as Json;
    if (num(jsn.code) !== 0) {
      throw this.apiError(jsn);
    }
    return (jsn.data as Json) ?? {};
  }

  /** Translate a non-zero API response into a structured error (captcha-aware). */
  private apiError(jsn: Json): AuthError {
    const data = (jsn.data as Json) ?? {};
    const message = str(jsn.msg, "API error");
    if (typeof data.captcha_id === "string") {
      return new AuthError({
        code: "captcha_required",
        message: "Login requires solving a captcha challenge",
        hint:
          "Re-run login with `--captcha-answer <text>` (and the captcha_id below). " +
          "The captcha image URL is in `input`.",
        input: {
          captcha_id: data.captcha_id,
          ...(typeof data.item === "string" ? { captcha_image: data.item } : {}),
        },
      });
    }
    return new AuthError({
      code: "login_rejected",
      message,
      input: { api_code: num(jsn.code) },
    });
  }

  // --- /v2/passport/login ---
  async login(opts: LoginOptions): Promise<LoginResult> {
    const { publicKey, encryptedPassword } = ecdhEncryptLoginPassword(opts.password);
    const body: Json = {
      client_secret_info: { public_key: publicKey },
      email: opts.email,
      password: encryptedPassword,
    };
    if (opts.captchaId) body.captcha_id = opts.captchaId;
    if (opts.captchaAnswer) body.answer = opts.captchaAnswer;

    const data = await this.request("/v2/passport/login", "", body);
    const authToken = str(data.auth_token);
    if (!authToken) {
      throw new AuthError({ code: "login_failed", message: "Login returned no auth token" });
    }
    return {
      auth_token: authToken,
      user_id: str(data.user_id),
      email: str(data.email, opts.email),
      region: this.region,
      ab_code: str(data.ab_code) || undefined,
    };
  }

  // --- /v1/passport/profile ---
  async profile(): Promise<{ user_id: string; email: string; country: string }> {
    const data = await this.request("/v1/passport", "/profile", undefined, true);
    const country = (data.country as Json | undefined)?.code;
    return {
      user_id: str(data.user_id),
      email: str(data.email),
      country: str(country),
    };
  }

  // --- /v1/app/query_fdm_list ---
  async queryFdmList(): Promise<Json[]> {
    const data = await this.request("/v1/app", "/query_fdm_list", {}, true);
    return Array.isArray(data) ? (data as Json[]) : ((data.data as Json[] | undefined) ?? []);
  }

  // --- /v1/app/equipment/get_dsk_keys ---
  async getDskKeys(stationSns: string[]): Promise<Record<string, string>> {
    const data = await this.request(
      "/v1/app",
      "/equipment/get_dsk_keys",
      { invalid_dsks: {}, station_sns: stationSns },
      true,
    );
    const out: Record<string, string> = {};
    for (const dsk of (data.dsk_keys as Json[] | undefined) ?? []) {
      const sn = str(dsk.station_sn);
      if (sn) out[sn] = str(dsk.dsk_key);
    }
    return out;
  }
}

/** Map a raw cloud printer record + dsk keys into our {@link AnkerPrinter}. */
function toPrinter(pr: Json, dskKeys: Record<string, string>): AnkerPrinter {
  const sn = str(pr.station_sn);
  return {
    id: str(pr.station_id),
    sn,
    name: str(pr.station_name),
    model: str(pr.station_model),
    duid: str(pr.p2p_did),
    ip_addr: str(pr.ip_addr),
    wifi_mac: str(pr.wifi_mac),
    mqtt_key: str(pr.secret_key),
    p2p_key: dskKeys[sn] ?? "",
    api_hosts: pr.app_conn ? ppppDecodeInitstring(str(pr.app_conn)) : [],
    p2p_hosts: pr.p2p_conn ? ppppDecodeInitstring(str(pr.p2p_conn)) : [],
  };
}

/**
 * Full login → config bootstrap (reference `fetch_config_by_login` +
 * `load_config_from_api`). Logs in, then pulls profile, printer list, and PPPP
 * keys, returning a ready-to-store {@link AnkerConfig}.
 */
export async function loginAndBuildConfig(opts: LoginOptions): Promise<AnkerConfig> {
  const region = guessRegion(opts.country);
  const api = new AnkerHttpApi(region);
  const login = await api.login(opts);

  const authed = new AnkerHttpApi(region, login.auth_token);
  const profile = await authed.profile();

  const printersRaw = await authed.queryFdmList();
  const sns = printersRaw.map((p) => str(p.station_sn)).filter(Boolean);
  const dskKeys = sns.length ? await authed.getDskKeys(sns) : {};

  const printers = printersRaw
    .map((p) => toPrinter(p, dskKeys))
    .sort((a, b) => Number(a.id) - Number(b.id));

  return {
    account: {
      user_id: profile.user_id || login.user_id,
      auth_token: login.auth_token,
      email: profile.email || login.email,
      region,
      country: profile.country || opts.country.toUpperCase(),
    },
    printers,
  };
}
