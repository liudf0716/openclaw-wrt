/**
 * Portal page path resolution and name sanitization.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";

/**
 * Candidate directories for nginx web root (in priority order).
 */
export const PORTAL_WEB_ROOT_CANDIDATES = [
  "/usr/share/nginx/html",
  "/var/www/html",
  "/www",
  "/srv/http",
  "/usr/local/www/nginx/html",
  "/usr/local/www",
];

/**
 * Extract the root directory from nginx configuration file.
 * Parses /etc/nginx/sites-enabled/default for the 'root' directive.
 */
export async function extractNginxRootFromConfig(): Promise<string | null> {
  const configPath = "/etc/nginx/sites-enabled/default";
  try {
    const content = await fs.readFile(configPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("root ") && trimmed.endsWith(";")) {
        const rootPath = trimmed.slice(5, -1).trim();
        if (rootPath) return rootPath;
      }
    }
  } catch {
    // Config file not readable, silently continue
  }
  return null;
}

/**
 * Sanitize and resolve portal HTML root directory path.
 */
export function sanitizePortalHtmlRoot(root: string): string {
  return path.resolve(root.trim());
}

/**
 * Sanitize portal page name (remove unsafe characters).
 */
export function sanitizePortalPageName(input: string): string {
  const baseName = path.basename(input.trim());
  const cleaned = baseName.replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "");
}

/**
 * Build a portal page name from device ID and optional explicit name.
 */
export function buildPortalPageName(deviceId: string, explicitPageName?: string): string {
  const requested = explicitPageName?.trim();
  if (requested) {
    const cleaned = sanitizePortalPageName(requested);
    if (cleaned) {
      return cleaned.endsWith(".html") ? cleaned : `${cleaned}.html`;
    }
  }

  const deviceSlug = deviceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!deviceSlug) {
    throw new Error("unable to derive portal page name from deviceId");
  }
  return `portal-${deviceSlug}.html`;
}

/**
 * Resolve the writable nginx web root directory.
 * Checks in order: nginx config, explicit override, environment variables, and candidate directories.
 */
export async function resolvePortalWebRoot(explicitRoot?: string): Promise<string> {
  const candidates: Array<string | null | undefined> = [
    explicitRoot?.trim(),
    process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT?.trim(),
    process.env.OPENCLAW_WRT_WEB_ROOT?.trim(),
    await extractNginxRootFromConfig(),
    ...PORTAL_WEB_ROOT_CANDIDATES,
  ];

  const filteredCandidates = candidates.filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );

  for (const candidate of filteredCandidates) {
    const resolved = sanitizePortalHtmlRoot(candidate);
    if (explicitRoot?.trim() === candidate) {
      await fs.mkdir(resolved, { recursive: true });
      return resolved;
    }
    try {
      await fs.access(resolved, fsConstants.W_OK);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(
    `unable to locate a writable nginx web root; checked nginx config, set OPENCLAW_WRT_PORTAL_WEB_ROOT, or pass webRoot (fallback candidates: ${PORTAL_WEB_ROOT_CANDIDATES.join(", ")})`,
  );
}
