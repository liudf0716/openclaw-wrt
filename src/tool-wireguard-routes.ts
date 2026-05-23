import type { WireguardProtectedRoutePlanFile } from "./tool-types.js";
import {
  collectWireguardProtectedRoutePlans,
  readWireguardProtectedRoutePlanFile,
} from "./chawrtd-client.js";
import { cidrOverlaps, parseIPv4Cidr, parseIPv4WithMask } from "./tool-validators.js";

export {
  collectWireguardProtectedRoutePlans,
  readWireguardProtectedRoutePlanFile,
  cidrOverlaps,
  parseIPv4Cidr,
  parseIPv4WithMask,
};

export async function loadWireguardRoutePlanOrThrow(
  routePlanFile: string,
): Promise<WireguardProtectedRoutePlanFile> {
  const routePlan = await readWireguardProtectedRoutePlanFile(routePlanFile) as WireguardProtectedRoutePlanFile | null;
  if (!routePlan) {
    throw new Error(`routePlanFile is invalid or unreadable: ${routePlanFile}`);
  }
  return routePlan;
}
