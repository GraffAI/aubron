import type { Config } from "../config.js";
import { apiFootballProvider } from "./apiFootball.js";
import { footballDataProvider } from "./footballData.js";
import { mockProvider } from "./mock.js";
import type { Provider } from "./types.js";

export type { Provider } from "./types.js";
export { apiFootballProvider } from "./apiFootball.js";
export { footballDataProvider } from "./footballData.js";
export { mockProvider } from "./mock.js";

/** Build the configured data provider, validating required credentials. */
export function createProvider(cfg: Config): Provider {
  switch (cfg.provider) {
    case "mock":
      return mockProvider();
    case "football-data":
      if (!cfg.apiKey)
        throw new Error("football-data provider needs an API key (--key or WC_API_KEY)");
      return footballDataProvider(cfg.apiKey, cfg.competition);
    case "api-football":
      if (!cfg.apiKey)
        throw new Error("api-football provider needs an API key (--key or WC_API_KEY)");
      return apiFootballProvider(cfg.apiKey, { league: cfg.league, season: cfg.season });
  }
}
