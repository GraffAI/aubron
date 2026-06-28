/**
 * Team identity: FIFA three-letter code → display name and a primary/secondary
 * colour pair (used to theme the GOAL celebration). Data providers may give us
 * only a country *name* ("South Korea", "United States"), so `resolveCode()`
 * folds names/aliases back to a code.
 */
import { hasFlag } from "./flags/registry.js";
import type { RGB } from "./canvas.js";
import { hex } from "./canvas.js";

export interface Team {
  readonly code: string;
  readonly name: string;
  readonly primary: RGB;
  readonly secondary: RGB;
}

interface Seed {
  code: string;
  name: string;
  primary: string;
  secondary: string;
  /** Extra names a provider might use, beyond `name`. */
  aka?: string[];
}

const SEEDS: Seed[] = [
  { code: "BRA", name: "Brazil", primary: "#FFDF00", secondary: "#009C3B" },
  { code: "ARG", name: "Argentina", primary: "#75AADB", secondary: "#FFFFFF" },
  { code: "FRA", name: "France", primary: "#0055A4", secondary: "#EF4135" },
  { code: "ENG", name: "England", primary: "#FFFFFF", secondary: "#CF142B" },
  { code: "ESP", name: "Spain", primary: "#F1BF00", secondary: "#AA151B" },
  { code: "DEU", name: "Germany", primary: "#FFCE00", secondary: "#DD0000", aka: ["Germany"] },
  { code: "POR", name: "Portugal", primary: "#FF0000", secondary: "#006600" },
  { code: "NLD", name: "Netherlands", primary: "#AE1C28", secondary: "#21468B", aka: ["Holland"] },
  { code: "ITA", name: "Italy", primary: "#009246", secondary: "#CE2B37" },
  { code: "BEL", name: "Belgium", primary: "#FAE042", secondary: "#ED2939" },
  { code: "CRO", name: "Croatia", primary: "#FF0000", secondary: "#171796" },
  {
    code: "USA",
    name: "USA",
    primary: "#3C3B6E",
    secondary: "#B22234",
    aka: ["United States", "United States of America"],
  },
  { code: "MEX", name: "Mexico", primary: "#006847", secondary: "#CE1126" },
  { code: "CAN", name: "Canada", primary: "#FF0000", secondary: "#FFFFFF" },
  { code: "JPN", name: "Japan", primary: "#BC002D", secondary: "#FFFFFF" },
  {
    code: "KOR",
    name: "South Korea",
    primary: "#0047A0",
    secondary: "#CD2E3A",
    aka: ["Korea Republic", "Republic of Korea"],
  },
  { code: "MAR", name: "Morocco", primary: "#C1272D", secondary: "#006233" },
  { code: "SEN", name: "Senegal", primary: "#00853F", secondary: "#FDEF42" },
  { code: "URY", name: "Uruguay", primary: "#0038A8", secondary: "#FFFFFF" },
  { code: "COL", name: "Colombia", primary: "#FCD116", secondary: "#003893" },
  { code: "ECU", name: "Ecuador", primary: "#FFDD00", secondary: "#034EA2" },
  { code: "PER", name: "Peru", primary: "#D91023", secondary: "#FFFFFF" },
  { code: "CHE", name: "Switzerland", primary: "#DA291C", secondary: "#FFFFFF" },
  { code: "DNK", name: "Denmark", primary: "#C8102E", secondary: "#FFFFFF" },
  { code: "SWE", name: "Sweden", primary: "#006AA7", secondary: "#FECC00" },
  { code: "NOR", name: "Norway", primary: "#BA0C2F", secondary: "#00205B" },
  { code: "POL", name: "Poland", primary: "#DC143C", secondary: "#FFFFFF" },
  { code: "AUT", name: "Austria", primary: "#ED2939", secondary: "#FFFFFF" },
  { code: "SRB", name: "Serbia", primary: "#C6363C", secondary: "#0C4076" },
  { code: "GHA", name: "Ghana", primary: "#FCD116", secondary: "#CE1126" },
  { code: "CMR", name: "Cameroon", primary: "#007A5E", secondary: "#CE1126" },
  {
    code: "CIV",
    name: "Ivory Coast",
    primary: "#F77F00",
    secondary: "#009E60",
    aka: ["Cote d'Ivoire", "Côte d'Ivoire"],
  },
  { code: "NGA", name: "Nigeria", primary: "#008751", secondary: "#FFFFFF" },
  { code: "AUS", name: "Australia", primary: "#00247D", secondary: "#FFCD00" },
  { code: "SAU", name: "Saudi Arabia", primary: "#006C35", secondary: "#FFFFFF" },
  {
    code: "TUR",
    name: "Turkey",
    primary: "#E30A17",
    secondary: "#FFFFFF",
    aka: ["Türkiye", "Turkiye"],
  },
  { code: "NZL", name: "New Zealand", primary: "#00247D", secondary: "#CC142B" },
  { code: "RUS", name: "Russia", primary: "#0039A6", secondary: "#D52B1E" },
  { code: "UKR", name: "Ukraine", primary: "#0057B7", secondary: "#FFD700" },
  {
    code: "IRL",
    name: "Ireland",
    primary: "#169B62",
    secondary: "#FF883E",
    aka: ["Republic of Ireland"],
  },
  { code: "ROU", name: "Romania", primary: "#002B7F", secondary: "#FCD116" },
  { code: "HUN", name: "Hungary", primary: "#CE2939", secondary: "#477050" },
  { code: "IDN", name: "Indonesia", primary: "#FF0000", secondary: "#FFFFFF" },

  // ---- the rest of the actual 2026 field (names match the api-football feed) -
  { code: "ALG", name: "Algeria", primary: "#006233", secondary: "#D21034" },
  {
    code: "BIH",
    name: "Bosnia & Herzegovina",
    primary: "#002395",
    secondary: "#FECB00",
    aka: ["Bosnia and Herzegovina", "Bosnia"],
  },
  {
    code: "CPV",
    name: "Cape Verde Islands",
    primary: "#003893",
    secondary: "#CF2027",
    aka: ["Cape Verde", "Cabo Verde"],
  },
  {
    code: "COD",
    name: "Congo DR",
    primary: "#007FFF",
    secondary: "#F7D618",
    aka: ["DR Congo", "Democratic Republic of the Congo"],
  },
  { code: "CUW", name: "Curaçao", primary: "#002B7F", secondary: "#F9D90F", aka: ["Curacao"] },
  {
    code: "CZE",
    name: "Czechia",
    primary: "#D7141A",
    secondary: "#11457E",
    aka: ["Czech Republic"],
  },
  { code: "EGY", name: "Egypt", primary: "#CE1126", secondary: "#C8A04F" },
  { code: "HAI", name: "Haiti", primary: "#00209F", secondary: "#D21034" },
  { code: "IRN", name: "Iran", primary: "#239F40", secondary: "#DA0000", aka: ["IR Iran"] },
  { code: "IRQ", name: "Iraq", primary: "#CE1126", secondary: "#007A3D" },
  { code: "JOR", name: "Jordan", primary: "#CE1126", secondary: "#007A3B" },
  { code: "PAN", name: "Panama", primary: "#005293", secondary: "#D21034" },
  { code: "PAR", name: "Paraguay", primary: "#D52B1E", secondary: "#0038A8" },
  { code: "QAT", name: "Qatar", primary: "#8A1538", secondary: "#FFFFFF" },
  { code: "SCO", name: "Scotland", primary: "#0065BF", secondary: "#FFFFFF" },
  { code: "RSA", name: "South Africa", primary: "#007A4D", secondary: "#FFB81C" },
  { code: "TUN", name: "Tunisia", primary: "#E70013", secondary: "#FFFFFF" },
  { code: "UZB", name: "Uzbekistan", primary: "#0099B5", secondary: "#1EB53A" },
];

const BY_CODE = new Map<string, Team>();
const NAME_TO_CODE = new Map<string, string>();

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

for (const seed of SEEDS) {
  BY_CODE.set(seed.code, {
    code: seed.code,
    name: seed.name,
    primary: hex(seed.primary),
    secondary: hex(seed.secondary),
  });
  for (const name of [seed.name, ...(seed.aka ?? [])]) NAME_TO_CODE.set(norm(name), seed.code);
}

const UNKNOWN: Omit<Team, "code" | "name"> = {
  primary: hex("#3B82F6"),
  secondary: hex("#1E293B"),
};

/**
 * Resolve a provider's team identity to our model. Accepts a 3-letter code
 * (preferred — football-data gives `tla`) or a country name (api-football). A
 * `displayCode` keeps the on-screen label sensible even for unknown nations.
 */
export function resolveTeam(input: { code?: string; name: string }): Team {
  const code = resolveCode(input);
  const known = BY_CODE.get(code);
  if (known) return known;
  return { code, name: input.name, ...UNKNOWN };
}

export function resolveCode(input: { code?: string; name: string }): string {
  if (input.code && BY_CODE.has(input.code.toUpperCase())) return input.code.toUpperCase();
  const byName = NAME_TO_CODE.get(norm(input.name));
  if (byName) return byName;
  // Last resort: a 3-letter uppercase code from the provided code or name.
  const raw = (input.code ?? input.name).toUpperCase().replace(/[^A-Z]/g, "");
  return raw.slice(0, 3).padEnd(3, "X");
}

export function teamByCode(code: string): Team | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** True when we have a dedicated flag design (vs. the neutral fallback). */
export function hasDedicatedFlag(code: string): boolean {
  return hasFlag(code);
}
