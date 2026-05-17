import type { WireguardProtectedRoutePlanFile } from "./tool-types.js";
import {
  collectWireguardProtectedRoutePlans,
  readWireguardProtectedRoutePlanFile,
} from "./tool-chawrtd.js";
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
  const routePlan = await readWireguardProtectedRoutePlanFile(routePlanFile);
  if (!routePlan) {
    throw new Error(`routePlanFile is invalid or unreadable: ${routePlanFile}`);
  }
  return routePlan;
}
