import type { JsonRecord } from "./tool-types.js";
import {
  buildPortalPageName,
  resolvePortalWebRoot,
  sanitizePortalHtmlRoot,
  sanitizePortalPageName,
} from "./tool-parsers.js";
import { publishPortalPage } from "./chawrtd-client.js";

export {
  buildPortalPageName,
  resolvePortalWebRoot,
  sanitizePortalHtmlRoot,
  sanitizePortalPageName,
  publishPortalPage,
};

export async function renderAndPublishPortalPage(params: {
  deviceId: string;
  html: string;
  pageName?: string;
  webRoot?: string;
  timeoutMs?: number;
}): Promise<{
  pageName: string;
  root: string;
  filePath: string;
  response: JsonRecord;
}> {
  return publishPortalPage(params);
}
