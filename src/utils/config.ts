/**
 * 配置管理模块
 */

import os from "os";
import path from "path";

export interface MCPConfig {
  clientId: string;
  siteUrl: string;
  authUrl: string;
  apiBase: string;
  serverEnv: string;
  cloudFunctionUrl: string;
  websiteApiUrl: string;
}

const DEFAULT_CLIENT_ID = "demox-mcp-client";
const DEFAULT_SITE_URL = "https://www.demox.site";
const DEFAULT_API_URL = "https://api.demox.site";
const DEFAULT_SERVER_ENV = "demox-scf";

function optionalEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultAuthUrl(siteUrl: string): string {
  // The public apex is redirect-only; open OAuth directly on the canonical host.
  const authSiteUrl = siteUrl === "https://demox.site"
    ? "https://www.demox.site"
    : siteUrl;
  return `${authSiteUrl}/mcp-authorize`;
}

export function loadConfig(): MCPConfig {
  const clientId = optionalEnv("DEMOX_CLIENT_ID") || DEFAULT_CLIENT_ID;
  const siteUrl = stripTrailingSlash(optionalEnv("DEMOX_SITE_URL") || DEFAULT_SITE_URL);
  const authUrl =
    stripTrailingSlash(optionalEnv("DEMOX_AUTH_URL") || defaultAuthUrl(siteUrl));
  const apiBase = stripTrailingSlash(optionalEnv("DEMOX_API_BASE") || siteUrl);
  const serverEnv = optionalEnv("DEMOX_SERVER_ENV") || DEFAULT_SERVER_ENV;
  const apiUrl = stripTrailingSlash(
    optionalEnv("DEMOX_API_URL") ||
    optionalEnv("DEMOX_CLOUD_FUNCTION_URL") ||
    optionalEnv("DEMOX_WEBSITE_API_URL") ||
    DEFAULT_API_URL
  );
  const cloudFunctionUrl = stripTrailingSlash(optionalEnv("DEMOX_CLOUD_FUNCTION_URL") || apiUrl);
  const websiteApiUrl = stripTrailingSlash(optionalEnv("DEMOX_WEBSITE_API_URL") || apiUrl);

  return {
    clientId,
    siteUrl,
    authUrl,
    apiBase,
    serverEnv,
    cloudFunctionUrl,
    websiteApiUrl,
  };
}

/**
 * Token 存储路径
 */
export function getTokenPath(): string {
  const platform = os.platform();

  let configDir: string;

  if (platform === "darwin") {
    // macOS
    configDir = path.join(os.homedir(), ".demox");
  } else if (platform === "win32") {
    // Windows
    configDir = path.join(os.homedir(), ".demox");
  } else {
    // Linux
    configDir = path.join(os.homedir(), ".demox");
  }

  return path.join(configDir, "token.json");
}

/**
 * 日志工具
 */
export class Logger {
  private debugMode: boolean;

  constructor() {
    this.debugMode = process.env.DEBUG === "demox:*" || process.env.DEBUG === "*";
  }

  debug(message: string, ...args: any[]) {
    if (this.debugMode) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    console.error(`[INFO] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]) {
    console.error(`[WARN] ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

export const logger = new Logger();
