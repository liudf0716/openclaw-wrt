/**
 * Portal page tools: generate and publish captive portal pages.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  PublishPortalPageParams,
  GeneratePortalPageParams,
} from "../tool-types.js";
import { getDefaultChawrtdClient } from "../chawrtd-client.js";
import {
  asObject,
  buildPortalPageName,
  resolvePortalWebRoot,
} from "../tool-parsers.js";
import { renderPortalPageHtml } from "../portal-page-renderer.js";
import { buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";

// ============================================================================
// Portal page publishing (extracted from ChawrtdClient)
// ============================================================================

async function getVpsPublicIp(timeoutMs?: number): Promise<string | null> {
  const client = getDefaultChawrtdClient();
  try {
    const response = await client.call({
      path: "/v1/vps/public-ip",
      method: "GET",
      timeoutMs: timeoutMs ?? 10_000,
    });
    const dataObj = asObject(response.data);
    const publicIp = dataObj?.publicIp;
    if (typeof publicIp === "string" && publicIp.trim()) return publicIp.trim();
    return null;
  } catch {
    return null;
  }
}

async function publishPortalPage(params: {
  deviceId: string;
  html: string;
  pageName?: string;
  webRoot?: string;
  timeoutMs?: number;
}): Promise<{ pageName: string; root: string; filePath: string; response: JsonRecord }> {
  const client = getDefaultChawrtdClient();
  const pageName = buildPortalPageName(params.deviceId, params.pageName);
  const root = await resolvePortalWebRoot(params.webRoot);
  const filePath = path.join(root, pageName);
  const html = params.html.trim();
  if (!html) throw new Error("publishPortalPage requires non-empty html");

  await fs.writeFile(filePath, html, "utf8");

  // When bridge is available, portal URL is just the page name (gateway serves it).
  // When using chawrtd HTTP API, we need the VPS public IP for the full URL.
  const shouldFetchPublicIp = !client.hasBridge();
  let portalUrl = pageName;
  if (shouldFetchPublicIp) {
    const publicIp = await getVpsPublicIp(params.timeoutMs);
    if (publicIp) portalUrl = `http://${publicIp}/${pageName}`;
  }

  const response = await client.callDeviceOp({
    deviceId: params.deviceId,
    op: "set_local_portal",
    payload: { portal: portalUrl },
    timeoutMs: params.timeoutMs,
    expectResponse: true,
  });

  return { pageName, root, filePath, response };
}

export function createPortalTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    // ---------------------------------------------------------------------------
    // clawwrt_generate_portal_page — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_generate_portal_page",
      label: "OpenClaw WRT Generate Portal Page",
      description:
        "Step 1 of 2: Generate captive portal HTML from a template and write it to nginx web root. Does NOT contact the router. Returns details.filePath (full file path in nginx webroot) and details.pageName. Pass both to clawwrt_publish_portal_page to complete deployment.",
      parameters: SharedSchemas.GeneratePortalPageSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_generate_portal_page", rawParams);
        const args = rawParams as GeneratePortalPageParams;
        const deviceId = args.deviceId.trim();
        const pageName = buildPortalPageName(deviceId, args.pageName);
        const html = renderPortalPageHtml({
          deviceId,
          template: args.template,
          content: args.content,
        });

        const webRoot = await resolvePortalWebRoot();
        const filePath = path.join(webRoot, pageName);
        await fs.writeFile(filePath, html, "utf8");

        return buildToolResult(
          `Generated portal HTML for ${deviceId} at ${filePath}. Next step: call clawwrt_publish_portal_page with filePath=details.filePath and pageName=details.pageName to push the URL to the router.`,
          {
            deviceId,
            pageName,
            filePath,
            template: args.template ?? "default",
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_publish_portal_page — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_publish_portal_page",
      label: "OpenClaw WRT Publish Portal Page",
      description:
        "Step 2 of 2: Read the HTML from the file written by clawwrt_generate_portal_page in nginx webroot, detect VPS public IP, and push the resulting URL to the router via set_local_portal. Pass filePath from details.filePath and pageName from details.pageName of the generate step.",
      parameters: SharedSchemas.PublishPortalPageSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_publish_portal_page", rawParams);
        const args = rawParams as PublishPortalPageParams;
        const deviceId = args.deviceId.trim();
        const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
        if (!filePath) {
          throw new Error(
            "filePath is required for clawwrt_publish_portal_page. Use clawwrt_generate_portal_page first to generate the HTML file.",
          );
        }
        const html = await fs.readFile(filePath, "utf8");
        const result = await publishPortalPage({
          deviceId,
          html,
          pageName: args.pageName,
          webRoot: args.webRoot,
          timeoutMs: args.timeoutMs,
        });

        return buildToolResult(
          `Published portal page ${result.pageName} for ${deviceId} and updated local portal routing.`,
          {
            deviceId,
            pageName: result.pageName,
            webRoot: result.root,
            filePath: result.filePath,
            portalUrl: result.response?.portal ?? null,
            response: result.response,
          },
        );
      },
    },
  ];
}
