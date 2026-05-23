#!/usr/bin/env python3
"""
Stage A complete cleanup for tool-monolith.ts.
Uses a proper brace counter that skips string content.
"""
import re
import sys
from pathlib import Path

MONOLITH = Path(__file__).parent.parent / "src" / "tool-monolith.ts"
content = MONOLITH.read_text()
original_lines = len(content.splitlines())

def find_function_end(text, start_pos):
    """Find the closing brace of a function body, handling strings and nested braces."""
    i = start_pos
    # First, find the opening brace of the function body
    # Skip past the signature (including type annotations which have { })
    # Strategy: count parens for the parameter list first
    paren_count = 0
    found_open_paren = False
    
    while i < len(text):
        ch = text[i]
        if ch == '/' and i + 1 < len(text) and text[i+1] == '/':
            # Skip line comment
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < len(text) and text[i+1] == '*':
            # Skip block comment
            i += 2
            while i < len(text) - 1 and not (text[i] == '*' and text[i+1] == '/'):
                i += 1
            i += 2
            continue
        if ch == '"' or ch == "'":
            # Skip string
            quote = ch
            i += 1
            while i < len(text) and text[i] != quote:
                if text[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if ch == '`':
            # Skip template literal
            i += 1
            while i < len(text) and text[i] != '`':
                if text[i] == '\\':
                    i += 1
                elif text[i] == '$' and i + 1 < len(text) and text[i+1] == '{':
                    # Nested expression - simplified handling
                    pass
                i += 1
            i += 1
            continue
        if ch == '(':
            paren_count += 1
            found_open_paren = True
        elif ch == ')':
            paren_count -= 1
            if found_open_paren and paren_count == 0:
                # Done with params, now find the function body opening brace
                # Skip return type annotation and find the {
                i += 1
                while i < len(text) and text[i] != '{':
                    if text[i] == '/' and i + 1 < len(text) and text[i+1] == '/':
                        while i < len(text) and text[i] != '\n':
                            i += 1
                    i += 1
                # Now i points to the opening brace of the body
                break
        i += 1
    
    if i >= len(text):
        return -1
    
    # Now count braces for the body
    brace_count = 0
    while i < len(text):
        ch = text[i]
        if ch == '/' and i + 1 < len(text) and text[i+1] == '/':
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < len(text) and text[i+1] == '*':
            i += 2
            while i < len(text) - 1 and not (text[i] == '*' and text[i+1] == '/'):
                i += 1
            i += 2
            continue
        if ch == '"' or ch == "'":
            quote = ch
            i += 1
            while i < len(text) and text[i] != quote:
                if text[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if ch == '`':
            i += 1
            while i < len(text) and text[i] != '`':
                if text[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if ch == '{':
            brace_count += 1
        elif ch == '}':
            brace_count -= 1
            if brace_count == 0:
                return i + 1  # position after closing brace
        i += 1
    return -1

def remove_function(content, pattern):
    """Remove a function by finding its start pattern and tracking to end."""
    idx = content.find(pattern)
    if idx == -1:
        return content
    
    # Find start of line
    line_start = content.rfind('\n', 0, idx)
    if line_start == -1:
        line_start = 0
    else:
        line_start += 1
    
    # For const single-line assignments
    if pattern.startswith("const ") and ";" in content[idx:idx+200].split('\n')[0]:
        end = content.index(';', idx) + 1
        if end < len(content) and content[end] == '\n':
            end += 1
        return content[:line_start] + content[end:]
    
    # Find the end of the function body
    end = find_function_end(content, idx)
    if end == -1:
        print(f"  WARNING: Could not find end of function: {pattern[:50]}")
        return content
    
    # Skip trailing newline
    if end < len(content) and content[end] == '\n':
        end += 1
    
    return content[:line_start] + content[end:]

# ============================================================================
# Phase 1: Remove wrapper functions first (before renaming calls)
# ============================================================================

wrapper_functions = [
    "function normalizeMac(input: string): string {",
    "function normalizeBpfAddress(table: ",
    "function ipv4ToInt(ip: string): number {",
    "function intToIpv4(value: number): string {",
    "function parseIPv4Cidr(input: string):",
    "function parseIPv4WithMask(ip: string, mask: string):",
    "function cidrOverlaps(left: IPv4CidrInfo, right: IPv4CidrInfo):",
    "function isValidWireGuardPublicKey(key: string):",
    "function isValidWireGuardPrivateKey(key: string):",
    "function deriveWireGuardPublicKeyFromPrivateKey(",
    "function sanitizePortalHtmlRoot(root: string):",
    "function resolvePortalWebRoot(explicitRoot?: string):",
    "function sanitizePortalPageName(input: string):",
    "function buildPortalPageName(deviceId: string, explicitPageName?: string):",
    "function parseChawrtdTimestamp(value: unknown): number {",
    "function parseChawrtdDeviceSnapshot(value: unknown): DeviceSnapshot | null {",
    "function formatDuration(ms: number): string {",
    "function getCategoryEmoji(key: string): string {",
]

for fn in wrapper_functions:
    before = len(content)
    content = remove_function(content, fn)
    removed = before - len(content)
    if removed > 0:
        print(f"  Removed {removed} chars: {fn[:50]}")
    else:
        print(f"  NOT FOUND: {fn[:50]}")

# Remove chawrtd duplicates
chawrtd_dupes = [
    "function getChawrtdBaseUrl(config?: ResolvedClawWRTConfig): string {",
    "async function callChawrtd(params: {",
    "async function getDevicesListViaChawrtd(config?: ResolvedClawWRTConfig): Promise<DeviceSnapshot[]> {",
    "async function getDeviceViaChawrtd(",
    "async function ensureDevice(deviceId: string",
    "function getSingleGatewayId(device: DeviceSnapshot)",
    "async function callDeviceOp(params: {",
    "async function callDeviceOpViaChawrtd(params: {",
    "async function restartXfrpcService(params: {",
    "async function publishPortalPage(params: {",
    "async function lookupClientByMac(params: {",
    "async function readWireguardProtectedRoutePlanFile(",
    "async function collectWireguardProtectedRoutePlans(params: {",
]

for fn in chawrtd_dupes:
    before = len(content)
    content = remove_function(content, fn)
    removed = before - len(content)
    if removed > 0:
        print(f"  Removed {removed} chars: {fn[:50]}")
    else:
        print(f"  NOT FOUND: {fn[:50]}")

# Remove DEFAULT_CHAWRTD_BASE_URL constant
content = content.replace('const DEFAULT_CHAWRTD_BASE_URL = "http://127.0.0.1:8001";\n\n', '')

# ============================================================================
# Phase 2: Now do safe regex replacements (imports, types, call renames)
# ============================================================================

# Update imports
content = content.replace(
    'import type { ClawWRTBridge as SharedClawWRTBridge, Logger as SharedLogger } from "./tool-types.js";',
    '''import type {
  ClawWRTBridge,
  Logger,
  JsonRecord,
  DeviceSnapshot,
  ChawrtdToolResult,
  ChawrtdDeviceSnapshot,
  ExecFileSyncRunner,
  IPv4CidrInfo,
  BpfJsonTable,
  WireguardProtectedRoutePlan,
  WireguardProtectedRoutePlanFile,
  PortalTemplate,
  PortalContent,
  GenericToolParams,
  DeviceOnlyParams,
  ClientInfoParams,
  AuthClientParams,
  KickoffClientParams,
  UpdateDeviceInfoParams,
  SetAuthServerParams,
  PublishPortalPageParams,
  GeneratePortalPageParams,
  SetMqttServerParams,
  SetWireguardVpnParams,
  TmpPassParams,
  SetWifiInfoParams,
  ScanWifiParams,
  SetWifiRelayParams,
  DomainSyncParams,
  TrustedMacSyncParams,
  ShellCommandParams,
  BpfAddParams,
  BpfJsonParams,
  BpfDeleteParams,
  BpfFlushParams,
  BpfUpdateParams,
  BpfUpdateAllParams,
  SetVpnRoutesParams,
  ResetWireguardVpnParams,
  SetBrLanParams,
  ResetWgServerParams,
  GetXfrpcTcpServiceParams,
  DelXfrpcTcpServiceParams,
  DisableXfrpcTcpServiceParams,
  DeployWgServerPeerParams,
  CollectWireguardProtectedRoutesParams,
  VerifyWireguardConnectivityParams,
  RunSpeedtestParams,
} from "./tool-types.js";'''
)

content = content.replace(
    '''import {
  normalizeMac as parserNormalizeMac,
  sanitizePortalHtmlRoot as parserSanitizePortalHtmlRoot,
  resolvePortalWebRoot as parserResolvePortalWebRoot,
  sanitizePortalPageName as parserSanitizePortalPageName,
  buildPortalPageName as parserBuildPortalPageName,
} from "./tool-parsers.js";''',
    '''import {
  normalizeMac as parserNormalizeMac,
  normalizeBpfAddress as parserNormalizeBpfAddress,
  sanitizePortalHtmlRoot as parserSanitizePortalHtmlRoot,
  resolvePortalWebRoot as parserResolvePortalWebRoot,
  sanitizePortalPageName as parserSanitizePortalPageName,
  buildPortalPageName as parserBuildPortalPageName,
  parseChawrtdTimestamp as parserParseChawrtdTimestamp,
  parseChawrtdDeviceSnapshot as parserParseChawrtdDeviceSnapshot,
  formatDuration as parserFormatDuration,
  getCategoryEmoji as parserGetCategoryEmoji,
} from "./tool-parsers.js";'''
)

content = content.replace(
    '''import {
  parseIPv4Cidr as validatorParseIPv4Cidr,
  parseIPv4WithMask as validatorParseIPv4WithMask,
  cidrOverlaps as validatorCidrOverlaps,
  isValidWireGuardPublicKey as validatorIsValidWireGuardPublicKey,
  isValidWireGuardPrivateKey as validatorIsValidWireGuardPrivateKey,
  deriveWireGuardPublicKeyFromPrivateKey as validatorDeriveWireGuardPublicKeyFromPrivateKey,
} from "./tool-validators.js";''',
    '''import {
  parseIPv4Cidr as validatorParseIPv4Cidr,
  parseIPv4WithMask as validatorParseIPv4WithMask,
  cidrOverlaps as validatorCidrOverlaps,
  isValidWireGuardPublicKey as validatorIsValidWireGuardPublicKey,
  isValidWireGuardPrivateKey as validatorIsValidWireGuardPrivateKey,
  deriveWireGuardPublicKeyFromPrivateKey as validatorDeriveWireGuardPublicKeyFromPrivateKey,
  ipv4ToInt as validatorIpv4ToInt,
  intToIpv4 as validatorIntToIpv4,
} from "./tool-validators.js";'''
)

content = content.replace(
    '''import {
  setActiveClawWRTConfig as setChawrtdActiveClawWRTConfig,
  setActiveBridgeFallback as setChawrtdBridgeFallback,
  setActiveToolLogger as setChawrtdToolLogger,
} from "./tool-chawrtd.js";''',
    '''import {
  setActiveClawWRTConfig as setChawrtdActiveClawWRTConfig,
  setActiveBridgeFallback as setChawrtdBridgeFallback,
  setActiveToolLogger as setChawrtdToolLogger,
  callChawrtd,
  callDeviceOp,
  getDevicesListViaChawrtd,
  getDeviceViaChawrtd,
  ensureDevice,
  getSingleGatewayId,
  restartXfrpcService,
  publishPortalPage,
  lookupClientByMac,
  readWireguardProtectedRoutePlanFile,
  collectWireguardProtectedRoutePlans,
} from "./tool-chawrtd.js";'''
)

content = content.replace('import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/core";\n', '')

content = content.replace(
    '''import {
  PORTAL_TEMPLATE_VALUES,
  renderPortalPageHtml,
  type PortalContent as PortalContentType,
  type PortalTemplate as PortalTemplateType,
} from "./portal-page-renderer.js";''',
    '''import {
  renderPortalPageHtml,
} from "./portal-page-renderer.js";'''
)

# Remove type declarations
content = content.replace('\ntype JsonRecord = Record<string, unknown>;\n', '\n')
content = content.replace('\ntype ClawWRTBridge = SharedClawWRTBridge;\n', '\n')
content = content.replace('\ntype Logger = SharedLogger;\n', '\n')
content = content.replace('\ntype PortalTemplate = PortalTemplateType;\n', '\n')
content = content.replace('\ntype PortalContentParams = PortalContentType;\n', '\n')
content = content.replace('\ntype BpfJsonTable = "ipv4" | "ipv6" | "mac" | "sid" | "l7";\n', '\n')

# Multi-line type blocks
content = re.sub(r'\ntype DeviceSnapshot = \{\n  deviceId: string;\n  connectedAtMs: number;\n  lastSeenAtMs: number;\n  remoteAddress\?: string;\n  gateway\?: unknown;\n  deviceInfo\?: unknown;\n  authMode\?: number;\n  alias\?: string;\n\};\n', '\n', content)
content = re.sub(r'\ntype WireguardProtectedRoutePlan = \{\n  deviceId: string;\n  deviceName\?: string;\n  lanCidr: string;\n  routes: string\[\];\n\};\n', '\n', content)
content = re.sub(r'\ntype WireguardProtectedRoutePlanFile = \{.*?^\};\n', '\n', content, flags=re.DOTALL|re.MULTILINE)
content = re.sub(r'\ntype ChawrtdToolResult = \{\n  summary\?: string;\n  output\?: string;\n  data\?: JsonRecord;\n  error\?: string;\n\};\n', '\n', content)
content = re.sub(r'\ntype ChawrtdDeviceSnapshot = \{\n  device_id\?: string;\n  connected_at\?: string;\n  last_seen_at\?: string;\n  remote_addr\?: string;\n  gateway\?: unknown;\n  device_info\?: unknown;\n  auth_mode\?: number \| string;\n  alias\?: string;\n\};\n', '\n', content)
content = re.sub(r'\ntype ExecFileSyncRunner = \(\n  file: string,\n  args\?: readonly string\[\],\n  options\?: unknown,\n\) => string \| Uint8Array;\n', '\n', content)
content = re.sub(r'\ntype IPv4CidrInfo = \{\n  input: string;\n  normalized: string;\n  network: number;\n  broadcast: number;\n  prefix: number;\n\};\n', '\n', content)

# Param type aliases
param_types = [
    "GenericToolParams", "DeviceOnlyParams", "ClientInfoParams", "AuthClientParams",
    "KickoffClientParams", "UpdateDeviceInfoParams", "SetAuthServerParams",
    "PublishPortalPageParams", "GeneratePortalPageParams", "SetMqttServerParams",
    "SetWireguardVpnParams", "TmpPassParams", "SetWifiInfoParams", "ScanWifiParams",
    "SetWifiRelayParams", "DomainSyncParams", "TrustedMacSyncParams", "ShellCommandParams",
    "BpfAddParams", "BpfJsonParams", "BpfDeleteParams", "BpfFlushParams",
    "BpfUpdateParams", "BpfUpdateAllParams", "SetVpnRoutesParams", "ResetWireguardVpnParams",
    "SetBrLanParams", "ResetWgServerParams", "GetXfrpcTcpServiceParams",
    "DelXfrpcTcpServiceParams", "DisableXfrpcTcpServiceParams",
]
for t in param_types:
    content = re.sub(rf'\ntype {t} = Static<typeof \w+>;\n', '\n', content)
content = re.sub(r'\ntype DeployWgServerPeerParams = Static<NonNullable<\(typeof DeployWgServerSchema\)\["properties"\]\["peerBindings"\]>>\[number\];\n', '\n', content)

content = content.replace("PortalContentParams", "PortalContent")

# Remove Field declarations
content = re.sub(r'\nconst TimeoutField = Type\.Optional\(\n  Type\.Integer\(\{\n    minimum: 1000,\n    maximum: 120_000,\n    description: "Request timeout in milliseconds\.",\n  \}\),\n\);\n', '\n', content)
content = re.sub(r'\nconst WifiConfigDataField = Type\.Object\(\n  \{.*?\},\n  \{ additionalProperties: true, description: "Wi-Fi configuration fields to update\." \},\n\);\n', '\n', content, flags=re.DOTALL)
content = re.sub(r'\nconst PortalTemplateField = stringEnum\(PORTAL_TEMPLATE_VALUES, \{.*?\}\);\n', '\n', content, flags=re.DOTALL)
content = re.sub(r'const JsonObjectField = Type\.Record\(Type\.String\(\), Type\.Unknown\(\), \{\n  description: "Arbitrary JSON object payload\.",\n\}\);\n', '', content)
content = re.sub(r'\nconst StringArrayField = Type\.Array\(Type\.String\(\{ minLength: 1 \}\)\);\n', '\n', content)
content = re.sub(r'const BandField = optionalStringEnum\(\["2g", "5g"\] as const, \{\n  description: "Wi-Fi band to scan: 2g or 5g\.",\n\}\);\n', '', content)
content = re.sub(r'const BpfTableField = stringEnum\(\["ipv4", "ipv6", "mac"\] as const, \{\n  description: "BPF table to target: ipv4, ipv6, or mac\.",\n\}\);\n', '', content)
content = re.sub(r'const BpfJsonTableField = stringEnum\(\["ipv4", "ipv6", "mac", "sid", "l7"\] as const, \{\n  description: "BPF JSON table to query: ipv4, ipv6, mac, sid, or l7\.",\n\}\);\n', '', content)
content = re.sub(r'\nconst XfrpcServiceNameField = Type\.String\(\{\n  minLength: 1,\n  pattern: "\^\[A-Za-z0-9_\]\+\$",\n  description: "Service name\. Use letters, numbers, and underscore only\.",\n\}\);\n', '\n', content)
content = re.sub(r'\nconst DeviceIdField = Type\.String\(\{\n  minLength: 1,\n  description: "Target openclaw-wrt device_id\.",\n\}\);\n', '\n', content)
content = content.replace("{ deviceId: DeviceIdField }", "{ deviceId: SharedSchemas.DeviceIdField }")
content = re.sub(r'\nconst PORTAL_WEB_ROOT_CANDIDATES = \[\n  "/usr/share/nginx/html",\n  "/var/www/html",\n  "/www",\n  "/srv/http",\n  "/usr/local/www/nginx/html",\n  "/usr/local/www",\n\];\n', '\n', content)

# Rename function calls
renames = [
    ("normalizeMac(", "parserNormalizeMac("),
    ("normalizeBpfAddress(", "parserNormalizeBpfAddress("),
    ("parseChawrtdTimestamp(", "parserParseChawrtdTimestamp("),
    ("parseChawrtdDeviceSnapshot(", "parserParseChawrtdDeviceSnapshot("),
    ("formatDuration(", "parserFormatDuration("),
    ("getCategoryEmoji(", "parserGetCategoryEmoji("),
    ("sanitizePortalHtmlRoot(", "parserSanitizePortalHtmlRoot("),
    ("resolvePortalWebRoot(", "parserResolvePortalWebRoot("),
    ("sanitizePortalPageName(", "parserSanitizePortalPageName("),
    ("buildPortalPageName(", "parserBuildPortalPageName("),
    ("parseIPv4Cidr(", "validatorParseIPv4Cidr("),
    ("parseIPv4WithMask(", "validatorParseIPv4WithMask("),
    ("cidrOverlaps(", "validatorCidrOverlaps("),
    ("isValidWireGuardPublicKey(", "validatorIsValidWireGuardPublicKey("),
    ("isValidWireGuardPrivateKey(", "validatorIsValidWireGuardPrivateKey("),
    ("deriveWireGuardPublicKeyFromPrivateKey(", "validatorDeriveWireGuardPublicKeyFromPrivateKey("),
    ("ipv4ToInt(", "validatorIpv4ToInt("),
    ("intToIpv4(", "validatorIntToIpv4("),
]
for old, new in renames:
    # Only replace if not preceded by a letter/underscore (to avoid double-renaming imports)
    content = re.sub(r'(?<![a-zA-Z_])' + re.escape(old), new, content)

# Clean up consecutive blank lines
content = re.sub(r'\n{3,}', '\n\n', content)

MONOLITH.write_text(content)
new_lines = len(content.splitlines())
print(f"\nFinal: {original_lines} -> {new_lines} lines (removed {original_lines - new_lines})")
