import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./config.js";

const ORIGINAL_ENV = { ...process.env };
const CONFIG_ENV_NAMES = [
  "DEMOX_CLIENT_ID",
  "DEMOX_SITE_URL",
  "DEMOX_AUTH_URL",
  "DEMOX_API_BASE",
  "DEMOX_SERVER_ENV",
  "DEMOX_API_URL",
  "DEMOX_CLOUD_FUNCTION_URL",
  "DEMOX_WEBSITE_API_URL",
];

function clearConfigEnv() {
  for (const name of CONFIG_ENV_NAMES) vi.stubEnv(name, "");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("uses public Demox defaults without environment variables", () => {
    clearConfigEnv();

    expect(loadConfig()).toEqual({
      clientId: "demox-mcp-client",
      siteUrl: "https://www.demox.site",
      authUrl: "https://www.demox.site/mcp-authorize",
      apiBase: "https://www.demox.site",
      serverEnv: "demox-scf",
      cloudFunctionUrl: "https://api.demox.site",
      websiteApiUrl: "https://api.demox.site",
    });
  });

  it("uses DEMOX_API_URL as the default SCF and website API URL", () => {
    vi.stubEnv("DEMOX_SITE_URL", "https://demox.site/");
    vi.stubEnv("DEMOX_API_URL", "https://api.demox.site/");
    vi.stubEnv("DEMOX_CLOUD_FUNCTION_URL", "");
    vi.stubEnv("DEMOX_WEBSITE_API_URL", "");

    expect(loadConfig()).toMatchObject({
      siteUrl: "https://demox.site",
      authUrl: "https://www.demox.site/mcp-authorize",
      apiBase: "https://demox.site",
      cloudFunctionUrl: "https://api.demox.site",
      websiteApiUrl: "https://api.demox.site",
    });
  });

  it("keeps custom site hosts for the default authorization URL", () => {
    vi.stubEnv("DEMOX_SITE_URL", "https://demox.example/");
    vi.stubEnv("DEMOX_API_URL", "https://api.demox.example/");
    vi.stubEnv("DEMOX_AUTH_URL", "");

    expect(loadConfig().authUrl).toBe("https://demox.example/mcp-authorize");
  });

  it("preserves an explicit authorization URL", () => {
    vi.stubEnv("DEMOX_SITE_URL", "https://demox.site/");
    vi.stubEnv("DEMOX_API_URL", "https://api.demox.site/");
    vi.stubEnv("DEMOX_AUTH_URL", "https://auth.example/oauth/");

    expect(loadConfig().authUrl).toBe("https://auth.example/oauth");
  });
});
