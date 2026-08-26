import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";
import { withProviderCircuit } from "@/services/resilience/retry";
import { getMetaPlatformConfig, type MetaPlatformConfig } from "@/services/meta/settings";
import { logger } from "@/lib/logging/logger";

export const DIRECT_PAGE_META_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"] as const;
export const BUSINESS_MANAGEMENT_PERMISSION = "business_management" as const;
export const REQUIRED_META_PERMISSIONS = [...DIRECT_PAGE_META_PERMISSIONS, BUSINESS_MANAGEMENT_PERMISSION] as const;
export type MetaPermissionStatus = "granted" | "declined" | "expired" | "missing" | "unknown";
export type MetaPermissionDiagnostic = { permission: string; status: MetaPermissionStatus };
type MetaPageSource = "ME_ACCOUNTS" | "ME_ASSIGNED_PAGES" | "BUSINESS_OWNED_PAGES" | "BUSINESS_CLIENT_PAGES" | "BUSINESS_ASSIGNED_PAGES" | "GRANULAR_TARGET";
type MetaPageSourceMetadata = { source: MetaPageSource; businessId?: string };
/** A discovered Page may not include an inline credential. The credential is server-only. */
export type MetaPage = { id: string; name: string; access_token?: string; tasks?: string[] };
type InternalMetaPage = MetaPage & { source?: MetaPageSource; businessId?: string; sources?: MetaPageSourceMetadata[] };
export type PublicMetaPage = Pick<MetaPage, "id" | "name">;
export type BusinessAccessState = true | false | "unknown";
export type MetaDiagnosticCheck = { status: "PASS" | "FAIL" | "UNKNOWN"; detail?: string };
export type PageDiscoveryDiagnostics = {
  rawRowsReturned: number;
  validPageIdentities: number;
  displayablePageCount: number;
  rowsWithPageAccessToken: number;
  meAccountsPageCount?: number;
  assignedPagesPageCount?: number;
  meAccountsRequests?: number;
  assignedPagesRequests?: number;
  businessesRequests?: number;
  businessPageEdgeRequests?: number;
  paginationTruncated?: boolean;
  granularTargetIds?: number;
  granularPageTargets?: number;
  businessAssetTargets?: number;
  unresolvedGranularTargets?: number;
  granularTargetDiagnostics?: GranularTargetDiagnostic[];
  verifiedGranularPages?: number;
  finalMergedPages?: number;
};

export type GranularScopeDiagnostic = { scope: string; targetIds: string[] };
export type GranularTargetVerification = "TARGET_PAGE_VERIFIED" | "TARGET_BUSINESS_ASSET" | "TARGET_UNRESOLVED";
export type GranularTargetDiagnostic = {
  targetId: string;
  associatedScopes: string[];
  verification: GranularTargetVerification;
  metaErrorCode?: string | number;
  metaErrorSubcode?: string | number;
  metaErrorType?: string;
};
export type MetaTokenDebug = {
  isValid: boolean;
  appId: string | null;
  type: string | null;
  userId: string | null;
  expiresAt: number | null;
  dataAccessExpiresAt: number | null;
  scopes: string[];
  granularScopes: GranularScopeDiagnostic[];
};

export type PageAccessDiagnostic = {
  authenticatedUser: boolean;
  authenticatedUserProfile: { id: string; name?: string } | null;
  oauthCallback: boolean;
  userAccessToken: boolean;
  permissions: MetaPermissionDiagnostic[];
  pagesReturned: number;
  rawRowsReturned: number;
  validPageIdentities: number;
  displayablePageCount: number;
  rowsWithPageAccessToken: number;
  loginConfigurationConfigured: boolean;
  graphApiVersion: string;
  checks: {
    facebookAuthentication: MetaDiagnosticCheck;
    oauthCallback: MetaDiagnosticCheck;
    tokenValidity: MetaDiagnosticCheck;
    tokenAppId: MetaDiagnosticCheck;
    userAccessToken: MetaDiagnosticCheck;
    pages_show_list: MetaDiagnosticCheck;
    pages_read_engagement: MetaDiagnosticCheck;
    pages_manage_metadata: MetaDiagnosticCheck;
    pages_messaging: MetaDiagnosticCheck;
    business_management: MetaDiagnosticCheck;
    loginConfiguration: MetaDiagnosticCheck;
    manageablePages: MetaDiagnosticCheck;
  };
  tokenType: string | null;
  diagnostics: {
    directManageablePages: number;
    granularTargetIds: number;
    granularPageTargets: number;
    businessAssetTargets: number;
    unresolvedGranularTargets: number;
    assignedPages: number;
    granularTargetDiagnostics: GranularTargetDiagnostic[];
    verifiedGranularPages: number;
    finalMergedPages: number;
    granularAssetsAuthorized?: boolean;
    businessAccessDetected: BusinessAccessState;
    businessAssetsReturned: number | null;
    likelyCause: string;
    recommendedAction: string;
  };
  errors: Array<{ operation: string; code?: string | number; subcode?: string | number; type?: string }>;
};

export type MetaPageAccessResult = { diagnostic: PageAccessDiagnostic; pages: MetaPage[] };

const MAX_PAGE_DISCOVERY_REQUESTS = 20;

export class MetaApiError extends Error {
  constructor(message: string, readonly details: { code?: string | number; type?: string; subcode?: string | number; operation: string; httpStatus?: number }) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class DuplicateMetaPageError extends Error {
  constructor(readonly pageId: string, readonly slug: string, readonly name: string) {
    super("That Facebook Page is already connected.");
    this.name = "DuplicateMetaPageError";
  }
}

async function metaConfig() {
  const config = await getMetaPlatformConfig();
  if (!config.appId || !config.appSecret || !config.redirectUri) throw new Error("Meta OAuth is not configured");
  return { ...config, version: config.graphApiVersion };
}

export function createOAuthState() {
  const state = crypto.randomBytes(32).toString("base64url");
  return { state, hash: crypto.createHash("sha256").update(state).digest("hex") };
}

export function buildMetaAuthorizationUrl(config: MetaPlatformConfig, state: string) {
  const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  if (config.loginConfigurationId) {
    url.searchParams.set("config_id", config.loginConfigurationId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", REQUIRED_META_PERMISSIONS.join(","));
  }
  return url;
}

export async function beginMetaOAuth() {
  const config = await metaConfig();
  const { state, hash } = createOAuthState();
  await prisma.oAuthState.create({ data: { stateHash: hash, redirectUri: config.redirectUri, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return buildMetaAuthorizationUrl(config, state).toString();
}

export async function getMetaOAuthDiagnostics() {
  const config = await getMetaPlatformConfig();
  const checks = {
    productionRedirect: config.redirectUri === "https://ai.growthifyx.space/api/meta/oauth/callback",
    loginConfigurationId: Boolean(config.loginConfigurationId),
    requiredPermissions: [...REQUIRED_META_PERMISSIONS],
    credentials: Boolean(config.appId && config.appSecret),
  };
  const constructible = Boolean(config.appId && config.redirectUri && config.graphApiVersion && buildMetaAuthorizationUrl(config, "diagnostic-state").toString());
  return { ok: checks.productionRedirect && checks.loginConfigurationId && checks.credentials && constructible, checks, authorizationUrl: constructible ? buildMetaAuthorizationUrl(config, "diagnostic-state").toString() : null };
}

async function metaJsonWithStatus<T>(url: URL, operation: string, init?: RequestInit): Promise<{ body: T; httpStatus: number }> {
  return withProviderCircuit("meta", async () => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: string | number; type?: string; error_subcode?: string | number } };
    if (!response.ok || body.error) {
      const providerError = body.error;
      throw new MetaApiError((providerError?.message ?? `Meta request failed (${response.status})`).slice(0, 500), { code: providerError?.code, type: providerError?.type, subcode: providerError?.error_subcode, operation, httpStatus: response.status });
    }
    return { body, httpStatus: response.status };
  });
}

async function metaJson<T>(url: URL, operation: string, init?: RequestInit): Promise<T> {
  const result = await metaJsonWithStatus<T>(url, operation, init);
  return result.body;
}

function withBearerToken(accessToken: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...init, headers };
}

function formRequest(values: Record<string, string>, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  return { ...init, method: "POST", headers, body: new URLSearchParams(values).toString() };
}

const GRANULAR_PAGE_PERMISSIONS = new Set<string>(REQUIRED_META_PERMISSIONS);

function normalizeGranularScopes(value: unknown): GranularScopeDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const scope = "scope" in item && typeof item.scope === "string" ? item.scope : null;
    if (!scope || !GRANULAR_PAGE_PERMISSIONS.has(scope)) return [];
    const rawTargetIds: unknown[] = "target_ids" in item && Array.isArray(item.target_ids) ? item.target_ids : [];
    const targetIds = rawTargetIds.filter((targetId): targetId is string => typeof targetId === "string" && targetId.trim().length > 0);
    return [{ scope, targetIds }];
  });
}

/**
 * Introspects a Meta token server-side. The returned object is deliberately
 * sanitized and contains no credential material.
 */
export async function inspectMetaToken(userAccessToken: string): Promise<MetaTokenDebug> {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/debug_token`);
  const response = await metaJson<{ data?: { is_valid?: unknown; app_id?: unknown; type?: unknown; user_id?: unknown; expires_at?: unknown; data_access_expires_at?: unknown; scopes?: unknown; granular_scopes?: unknown } }>(
    url,
    "oauth.debug_token",
    withBearerToken(`${config.appId}|${config.appSecret}`, formRequest({ input_token: userAccessToken, fields: "is_valid,app_id,type,user_id,expires_at,data_access_expires_at,scopes,granular_scopes" })),
  );
  const data = response.data;
  const debug: MetaTokenDebug = {
    isValid: data?.is_valid === true,
    appId: typeof data?.app_id === "string" || typeof data?.app_id === "number" ? String(data.app_id) : null,
    type: typeof data?.type === "string" ? data.type : null,
    userId: typeof data?.user_id === "string" || typeof data?.user_id === "number" ? String(data.user_id) : null,
    expiresAt: typeof data?.expires_at === "number" ? data.expires_at : null,
    dataAccessExpiresAt: typeof data?.data_access_expires_at === "number" ? data.data_access_expires_at : null,
    scopes: Array.isArray(data?.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    granularScopes: normalizeGranularScopes(data?.granular_scopes),
  };
  if (!debug.isValid) throw new MetaApiError("Meta rejected the OAuth token.", { operation: "oauth.debug_token" });
  if (debug.appId !== config.appId) throw new MetaApiError("Meta OAuth token belongs to a different application.", { operation: "oauth.debug_token" });
  return debug;
}

export async function consumeOAuthState(state: string) {
  const hash = crypto.createHash("sha256").update(state).digest("hex");
  const record = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) throw new Error("Invalid or expired OAuth state");
  if (!record.callbackCompletedAt) {
    const claimed = await prisma.oAuthState.updateMany({ where: { id: record.id, callbackCompletedAt: null, consumedAt: null, expiresAt: { gt: new Date() } }, data: { callbackCompletedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("Invalid or expired OAuth state");
  }
  return record;
}

export async function finalizeOAuthState(state: string) {
  const hash = crypto.createHash("sha256").update(state).digest("hex");
  const claimed = await prisma.oAuthState.updateMany({ where: { stateHash: hash, callbackCompletedAt: { not: null }, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date(), encryptedUserToken: null } });
  if (claimed.count !== 1) throw new Error("OAuth session has already been used or expired.");
}

export async function exchangeCode(code: string, redirectUri: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`);
  return metaJson<{ access_token: string }>(url, "oauth.access_token", formRequest({ client_id: config.appId, client_secret: config.appSecret, redirect_uri: redirectUri, code }));
}

export async function getGrantedPermissions(userAccessToken: string): Promise<MetaPermissionDiagnostic[]> {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/permissions`);
  const result = await metaJson<{ data?: Array<{ permission?: string; status?: string }> }>(url, "oauth.permissions", withBearerToken(userAccessToken));
  const actual = new Map((result.data ?? []).filter((item) => item.permission).map((item) => [item.permission!, item.status?.toLowerCase() as MetaPermissionStatus]));
  return REQUIRED_META_PERMISSIONS.map((permission) => ({ permission, status: actual.get(permission) ?? "missing" }));
}

export function missingRequiredPermissions(permissions: MetaPermissionDiagnostic[]) {
  return permissions.filter((item) => item.status !== "granted");
}

/** Permissions required for the normal Page connection flow. Business access
 * is diagnosed separately because Meta can return directly-owned Pages without
 * business_management. */
export function missingBlockingPagePermissions(permissions: MetaPermissionDiagnostic[]) {
  return permissions.filter((item) => item.status !== "granted" && item.permission !== BUSINESS_MANAGEMENT_PERMISSION);
}

type GraphPage = { id?: string; name?: string; access_token?: string; tasks?: unknown };
type GranularPageResponse = GraphPage;
type GraphUser = { id?: string; name?: string };
type GraphBusiness = { id?: string; name?: string };
type GraphAsset = GraphPage;
type PageEdge = "owned_pages" | "client_pages" | "assigned_pages";

type CollectionResult<T> = { rows: T[]; requests: number; paginationTruncated: boolean };
type DiscoveryCounters = { meAccountsRequests: number; assignedPagesRequests: number; businessesRequests: number; businessPageEdgeRequests: number; paginationTruncated: boolean };

type PageDiscoveryResult = {
  pages: InternalMetaPage[];
  diagnostics: PageDiscoveryDiagnostics;
  errors: PageAccessDiagnostic["errors"];
  businessAccessDetected: BusinessAccessState;
  businessAssetsReturned: number | null;
};

function normalizePage(row: GraphPage, metadata?: MetaPageSourceMetadata): InternalMetaPage | null {
  if (typeof row.id !== "string" || !row.id.trim() || typeof row.name !== "string" || !row.name.trim()) return null;
  const tasks = Array.isArray(row.tasks) ? row.tasks.filter((task): task is string => typeof task === "string") : undefined;
  return {
    id: row.id,
    name: row.name,
    ...(typeof row.access_token === "string" && row.access_token ? { access_token: row.access_token } : {}),
    ...(tasks ? { tasks } : {}),
    ...(metadata ? { source: metadata.source, ...(metadata.businessId ? { businessId: metadata.businessId } : {}), sources: [metadata] } : {}),
  };
}

function nextMetaPageUrl(next: string | undefined) {
  if (!next) return null;
  try {
    const url = new URL(next);
    if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") return null;
    url.searchParams.delete("access_token");
    url.searchParams.delete("appsecret_proof");
    return url;
  } catch {
    return null;
  }
}

function mergePage(pagesById: Map<string, InternalMetaPage>, page: InternalMetaPage) {
  const current = pagesById.get(page.id);
  if (!current) return pagesById.set(page.id, page);
  const sourceEntries = [...(current.sources ?? []), ...(page.sources ?? (page.source ? [{ source: page.source, ...(page.businessId ? { businessId: page.businessId } : {}) }] : []))];
  const sources = sourceEntries.filter((entry, index, all) => all.findIndex((candidate) => candidate.source === entry.source && candidate.businessId === entry.businessId) === index);
  const preferredSource = current.access_token ? current : page.access_token ? page : current;
  pagesById.set(page.id, {
    ...current,
    name: preferredSource.name,
    ...(current.access_token || !page.access_token ? {} : { access_token: page.access_token }),
    ...(current.tasks?.length || !page.tasks ? {} : { tasks: page.tasks }),
    ...(preferredSource.source ? { source: preferredSource.source } : {}),
    ...(preferredSource.businessId ? { businessId: preferredSource.businessId } : {}),
    ...(sources.length ? { sources } : {}),
  });
}

async function fetchGraphCollection<T extends object>(initialUrl: URL, operation: string, userAccessToken: string): Promise<CollectionResult<T>> {
  const rows: T[] = [];
  let next: URL | null = initialUrl;
  let requests = 0;
  let paginationTruncated = false;
  while (next && requests < MAX_PAGE_DISCOVERY_REQUESTS) {
    const response = await metaJsonWithStatus<{ data?: T[]; paging?: { next?: string } }>(next, operation, withBearerToken(userAccessToken));
    if (Array.isArray(response.body.data)) rows.push(...response.body.data);
    requests += 1;
    if (!response.body.paging?.next) {
      next = null;
      continue;
    }
    const validatedNext = nextMetaPageUrl(response.body.paging.next);
    if (!validatedNext || requests >= MAX_PAGE_DISCOVERY_REQUESTS) {
      paginationTruncated = true;
      next = null;
      continue;
    }
    next = validatedNext;
  }
  if (next) paginationTruncated = true;
  return { rows, requests, paginationTruncated };
}

function withoutSourceMetadata(page: InternalMetaPage): MetaPage {
  return {
    id: page.id,
    name: page.name,
    ...(page.access_token ? { access_token: page.access_token } : {}),
    ...(page.tasks ? { tasks: page.tasks } : {}),
  };
}

function addCollectionCounters(counters: DiscoveryCounters, kind: keyof Omit<DiscoveryCounters, "paginationTruncated">, result: CollectionResult<unknown>) {
  counters[kind] += result.requests;
  counters.paginationTruncated ||= result.paginationTruncated;
}

function sourceForEdge(edge: PageEdge): MetaPageSource {
  return edge === "owned_pages" ? "BUSINESS_OWNED_PAGES" : edge === "client_pages" ? "BUSINESS_CLIENT_PAGES" : "BUSINESS_ASSIGNED_PAGES";
}

function safeMetaError(error: unknown) {
  if (error instanceof MetaApiError) return { code: error.details.code, subcode: error.details.subcode, type: error.details.type };
  return {};
}

function isUnsupportedGraphObject(error: unknown) {
  if (!(error instanceof MetaApiError)) return false;
  return String(error.details.code ?? "") === "100" && String(error.details.subcode ?? "") === "33";
}

async function discoverPageRows(userAccessToken: string, tokenDebug: MetaTokenDebug, permissions: MetaPermissionDiagnostic[] = []): Promise<PageDiscoveryResult> {
  const config = await metaConfig();
  const counters: DiscoveryCounters = { meAccountsRequests: 0, assignedPagesRequests: 0, businessesRequests: 0, businessPageEdgeRequests: 0, paginationTruncated: false };
  const url = new URL(`https://graph.facebook.com/${config.version}/me/accounts`);
  url.searchParams.set("fields", "id,name,tasks,access_token");
  const directRowsResult = await fetchGraphCollection<GraphPage>(url, "pages.discovery", userAccessToken);
  addCollectionCounters(counters, "meAccountsRequests", directRowsResult);
  const rows = directRowsResult.rows;
  for (const pageRows of [rows]) {
    logger.info({
      operation: "pages.discovery",
      dataRows: pageRows.length,
      pageIds: pageRows.map((row) => row.id ?? null),
      rowsWithPageAccessToken: pageRows.filter((row) => typeof row.access_token === "string" && row.access_token.length > 0).length,
      pageRows: pageRows.map((row) => ({ pageId: row.id ?? null, pageName: row.name ?? null, hasAccessToken: typeof row.access_token === "string" && row.access_token.length > 0 })),
      paginationRequests: directRowsResult.requests,
    }, "Meta Page discovery response");
  }

  const validRows = rows.map((row) => normalizePage(row, { source: "ME_ACCOUNTS" })).filter((page): page is InternalMetaPage => page !== null);
  const pagesById = new Map<string, InternalMetaPage>();
  for (const page of validRows) mergePage(pagesById, page);

  const targetScopes = new Map<string, Set<string>>();
  for (const granularScope of tokenDebug.granularScopes) {
    for (const targetId of granularScope.targetIds) {
      const scopes = targetScopes.get(targetId) ?? new Set<string>();
      scopes.add(granularScope.scope);
      targetScopes.set(targetId, scopes);
    }
  }
  const granularTargetIds = [...targetScopes.keys()];
  const targetDiagnostics = new Map<string, GranularTargetDiagnostic>();
  const errors: PageAccessDiagnostic["errors"] = [];
  const setTargetDiagnostic = (targetId: string, verification: GranularTargetVerification, error?: unknown) => {
    const metaError = safeMetaError(error);
    targetDiagnostics.set(targetId, {
      targetId,
      associatedScopes: [...(targetScopes.get(targetId) ?? [])],
      verification,
      ...(metaError.code !== undefined ? { metaErrorCode: metaError.code } : {}),
      ...(metaError.subcode !== undefined ? { metaErrorSubcode: metaError.subcode } : {}),
      ...(metaError.type !== undefined ? { metaErrorType: metaError.type } : {}),
    });
  };

  let assignedPagesPageCount = 0;
  const assignedPageIds = new Set<string>();
  // Login for Business can authorize a user for Pages without exposing them
  // through /me/accounts. Always inspect this edge so a direct Page list never
  // hides additional Business-managed Pages.
  {
    try {
      const assignedUrl = new URL(`https://graph.facebook.com/${config.version}/me/assigned_pages`);
      assignedUrl.searchParams.set("fields", "id,name,tasks,access_token");
      let assignedRowsResult: CollectionResult<GraphPage>;
      let assignedCredentialFieldError: unknown;
      try {
        assignedRowsResult = await fetchGraphCollection<GraphPage>(assignedUrl, "pages.assigned_pages", userAccessToken);
      } catch (firstError) {
        if (isUnsupportedGraphObject(firstError)) throw firstError;
        // Some Meta configurations expose the edge but reject access_token as
        // a requested field. Retry with identity/task fields only; credentials
        // are resolved later through the server-side Page credential flow.
        assignedCredentialFieldError = firstError;
        const safeAssignedUrl = new URL(assignedUrl);
        safeAssignedUrl.searchParams.set("fields", "id,name,tasks");
        try {
          assignedRowsResult = await fetchGraphCollection<GraphPage>(safeAssignedUrl, "pages.assigned_pages.identity", userAccessToken);
        } catch {
          throw firstError;
        }
      }
      counters.assignedPagesRequests += assignedRowsResult.requests;
      counters.paginationTruncated ||= assignedRowsResult.paginationTruncated;
      const assignedRows = assignedRowsResult.rows;
      const assignedPages = assignedRows.map((row) => normalizePage(row, { source: "ME_ASSIGNED_PAGES" })).filter((page): page is InternalMetaPage => page !== null);
      if (assignedCredentialFieldError && assignedRows.length > 0 && assignedPages.length === 0) errors.push(diagnosticError(assignedCredentialFieldError));
      assignedPagesPageCount = assignedPages.length;
      for (const page of assignedPages) {
        assignedPageIds.add(page.id);
        mergePage(pagesById, page);
      }
      logger.info({ operation: "pages.assigned_pages", dataRows: assignedRows.length, validPageIdentities: assignedPages.length, rowsWithPageAccessToken: assignedRows.filter((row) => typeof row.access_token === "string" && row.access_token.length > 0).length, paginationRequests: assignedRowsResult.requests }, "Meta assigned Page discovery response");
    } catch (error) {
      errors.push(diagnosticError(error));
      logger.warn({ operation: "pages.assigned_pages", ...safeMetaError(error) }, "Meta assigned Page discovery failed");
    }
  }

  let verifiedGranularPages = 0;
  for (const targetId of granularTargetIds) {
    try {
      const verificationUrl = new URL(`https://graph.facebook.com/${config.version}/${encodeURIComponent(targetId)}`);
      verificationUrl.searchParams.set("fields", "id,name,tasks,access_token");
      let verifiedRow: GranularPageResponse;
      let credentialFieldError: unknown;
      try {
        verifiedRow = await metaJson<GranularPageResponse>(verificationUrl, "pages.granular.verify", withBearerToken(userAccessToken));
      } catch (firstError) {
        if (isUnsupportedGraphObject(firstError)) throw firstError;
        credentialFieldError = firstError;
        const identityUrl = new URL(verificationUrl);
        identityUrl.searchParams.set("fields", "id,name,tasks");
        try {
          verifiedRow = await metaJson<GranularPageResponse>(identityUrl, "pages.granular.verify.identity", withBearerToken(userAccessToken));
        } catch {
          throw firstError;
        }
      }
      const verified = normalizePage(verifiedRow, { source: "GRANULAR_TARGET" });
      if (!verified) {
        const matchedAssignedPage = assignedPageIds.has(targetId);
        if (matchedAssignedPage) verifiedGranularPages += 1;
        setTargetDiagnostic(targetId, matchedAssignedPage ? "TARGET_PAGE_VERIFIED" : "TARGET_UNRESOLVED", credentialFieldError);
        if (!matchedAssignedPage) logger.warn({ targetId, associatedScopes: [...(targetScopes.get(targetId) ?? [])], verification: "TARGET_UNRESOLVED" }, "Meta granular target did not resolve to a Page identity");
        continue;
      }
      verifiedGranularPages += 1;
      setTargetDiagnostic(targetId, "TARGET_PAGE_VERIFIED");
      mergePage(pagesById, verified);
    } catch (error) {
      const details = error instanceof MetaApiError ? error.details : { operation: "pages.granular.verify" };
      const matchedAssignedPage = assignedPageIds.has(targetId);
      if (matchedAssignedPage) verifiedGranularPages += 1;
      setTargetDiagnostic(targetId, matchedAssignedPage ? "TARGET_PAGE_VERIFIED" : "TARGET_UNRESOLVED", error);
      logger.warn({ targetId, associatedScopes: [...(targetScopes.get(targetId) ?? [])], verification: matchedAssignedPage ? "TARGET_PAGE_VERIFIED" : "TARGET_UNRESOLVED", operation: details.operation, metaErrorCode: details.code, metaErrorType: details.type, metaErrorSubcode: details.subcode }, "Meta granular target verification failed");
    }
  }

  let businessAccessDetected: BusinessAccessState = "unknown";
  let businessAssetsReturned: number | null = null;
  const businessIds = new Set<string>();
  const businessAssetIds = new Set<string>();
  const businessManagementGranted = permissions.find((permission) => permission.permission === BUSINESS_MANAGEMENT_PERMISSION)?.status === "granted" || tokenDebug.scopes.includes(BUSINESS_MANAGEMENT_PERMISSION);
  if (businessManagementGranted) {
    try {
      const businessesUrl = new URL(`https://graph.facebook.com/${config.version}/me/businesses`);
      businessesUrl.searchParams.set("fields", "id,name");
      const businessesResult = await fetchGraphCollection<GraphBusiness>(businessesUrl, "businesses.discovery", userAccessToken);
      addCollectionCounters(counters, "businessesRequests", businessesResult);
      const validBusinesses = businessesResult.rows.filter((business) => typeof business.id === "string" && business.id.length > 0);
      businessAccessDetected = validBusinesses.length > 0;
      const assets = new Map<string, GraphAsset>();
      for (const business of validBusinesses) {
        businessIds.add(business.id!);
        businessAssetIds.add(business.id!);
        for (const edge of ["owned_pages", "client_pages", "assigned_pages"] as const satisfies PageEdge[]) {
          try {
            const assetsUrl = new URL(`https://graph.facebook.com/${config.version}/${business.id}/${edge}`);
            assetsUrl.searchParams.set("fields", "id,name,tasks,access_token");
            let result: CollectionResult<GraphAsset>;
            let credentialFieldError: unknown;
            try {
              result = await fetchGraphCollection<GraphAsset>(assetsUrl, `businesses.${edge}`, userAccessToken);
            } catch (firstError) {
              if (isUnsupportedGraphObject(firstError)) throw firstError;
              // Preserve identity discovery when Meta rejects access_token as a
              // field. Credential retrieval is retried separately on connect.
              credentialFieldError = firstError;
              const identityUrl = new URL(assetsUrl);
              identityUrl.searchParams.set("fields", "id,name,tasks");
              try {
                result = await fetchGraphCollection<GraphAsset>(identityUrl, `businesses.${edge}.identity`, userAccessToken);
              } catch {
                throw firstError;
              }
            }
            if (credentialFieldError && result.rows.length > 0 && !result.rows.some((asset) => typeof asset.id === "string" && asset.id.length > 0 && typeof asset.name === "string" && asset.name.length > 0)) errors.push(diagnosticError(credentialFieldError));
            counters.businessPageEdgeRequests += result.requests;
            counters.paginationTruncated ||= result.paginationTruncated;
            for (const asset of result.rows) if (asset.id) {
              const existingAsset = assets.get(asset.id) as (GraphAsset & { __source?: MetaPageSource; __businessId?: string }) | undefined;
              assets.set(asset.id, {
                ...existingAsset,
                ...asset,
                ...(existingAsset?.access_token && !asset.access_token ? { access_token: existingAsset.access_token } : {}),
                ...(existingAsset?.tasks && !asset.tasks ? { tasks: existingAsset.tasks } : {}),
                __source: existingAsset?.__source ?? sourceForEdge(edge),
                __businessId: existingAsset?.__businessId ?? business.id,
              } as GraphAsset & { __source: MetaPageSource; __businessId: string });
            }
          } catch (error) {
            errors.push(diagnosticError(error));
          }
        }
      }
      businessAssetsReturned = assets.size;
      for (const asset of assets.values()) {
        const assetWithMetadata = asset as GraphAsset & { __source?: MetaPageSource; __businessId?: string };
        if (asset.id) businessAssetIds.add(asset.id);
        const page = normalizePage(asset, assetWithMetadata.__source ? { source: assetWithMetadata.__source, businessId: assetWithMetadata.__businessId } : undefined);
        if (page) mergePage(pagesById, page);
      }
    } catch (error) {
      errors.push(diagnosticError(error));
      businessAccessDetected = "unknown";
    }
  }

  for (const targetId of granularTargetIds) {
    const diagnostic = targetDiagnostics.get(targetId);
    if (diagnostic?.verification === "TARGET_PAGE_VERIFIED") continue;
    if (businessIds.has(targetId)) setTargetDiagnostic(targetId, "TARGET_BUSINESS_ASSET");
    else if (businessAssetIds.has(targetId) && pagesById.has(targetId)) setTargetDiagnostic(targetId, "TARGET_PAGE_VERIFIED");
    else if (!diagnostic) setTargetDiagnostic(targetId, "TARGET_UNRESOLVED");
  }
  const mergedPages = [...pagesById.values()];
  const granularTargetDiagnostics = granularTargetIds.map((targetId) => targetDiagnostics.get(targetId) ?? { targetId, associatedScopes: [...(targetScopes.get(targetId) ?? [])], verification: "TARGET_UNRESOLVED" as const });
  const granularPageTargets = granularTargetDiagnostics.filter((target) => target.verification === "TARGET_PAGE_VERIFIED").length;
  const businessAssetTargets = granularTargetDiagnostics.filter((target) => target.verification === "TARGET_BUSINESS_ASSET").length;
  const unresolvedGranularTargets = granularTargetDiagnostics.filter((target) => target.verification === "TARGET_UNRESOLVED").length;
  const diagnostics = {
    rawRowsReturned: rows.length,
    validPageIdentities: validRows.length,
    displayablePageCount: mergedPages.length,
    rowsWithPageAccessToken: rows.filter((row) => typeof row.access_token === "string" && row.access_token.length > 0).length,
    meAccountsPageCount: new Set(validRows.map((page) => page.id)).size,
    assignedPagesPageCount,
    granularTargetIds: granularTargetIds.length,
    granularPageTargets,
    businessAssetTargets,
    unresolvedGranularTargets,
    granularTargetDiagnostics,
    verifiedGranularPages,
    finalMergedPages: mergedPages.length,
    meAccountsRequests: counters.meAccountsRequests,
    assignedPagesRequests: counters.assignedPagesRequests,
    businessesRequests: counters.businessesRequests,
    businessPageEdgeRequests: counters.businessPageEdgeRequests,
    paginationTruncated: counters.paginationTruncated,
  } satisfies PageDiscoveryDiagnostics;
  logger.info({ operation: "pages.discovery.summary", ...diagnostics }, "Meta Page discovery summary");
  return { pages: mergedPages, diagnostics, errors, businessAccessDetected, businessAssetsReturned };
}

export async function discoverPages(userAccessToken: string, tokenDebug?: MetaTokenDebug): Promise<MetaPage[]> {
  // Callers handling OAuth should pass the already validated debug result. The
  // optional form preserves this low-level source-A helper for internal tools.
  const emptyDebug: MetaTokenDebug = { isValid: true, appId: null, type: null, userId: null, expiresAt: null, dataAccessExpiresAt: null, scopes: [], granularScopes: [] };
  return (await discoverPageRows(userAccessToken, tokenDebug ?? emptyDebug)).pages.map(withoutSourceMetadata);
}

export function pageDiscoveryStatus(diagnostics: PageDiscoveryDiagnostics): "NO_PAGES" | "PAGE_FOUND_TOKEN_PENDING" | "PAGES_AVAILABLE" {
  if (diagnostics.displayablePageCount === 0) return "NO_PAGES";
  return "PAGES_AVAILABLE";
}

export async function resolvePageAccessToken(userAccessToken: string, page: MetaPage) {
  if (page.access_token) return page.access_token;
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${encodeURIComponent(page.id)}`);
  url.searchParams.set("fields", "id,access_token");
  const result = await metaJson<{ id?: string; access_token?: string }>(url, "page.access_token", withBearerToken(userAccessToken));
  if (result.id && result.id !== page.id) throw new MetaApiError("Meta returned a different Page identity while resolving the Page credential.", { operation: "page.access_token" });
  if (!result.access_token) throw new MetaApiError("Meta did not return a usable Page access credential.", { operation: "page.access_token" });
  return result.access_token;
}

function diagnosticError(error: unknown) {
  if (error instanceof MetaApiError) return { operation: error.details.operation, code: error.details.code, subcode: error.details.subcode, type: error.details.type };
  return { operation: "meta.diagnostic" };
}

function permissionCheck(permissions: MetaPermissionDiagnostic[], permission: string): MetaDiagnosticCheck {
  const found = permissions.find((item) => item.permission === permission);
  if (!found || found.status === "missing" || found.status === "declined" || found.status === "expired") return { status: "FAIL", detail: found?.status ?? "missing" };
  if (found.status !== "granted") return { status: "UNKNOWN", detail: found.status };
  return { status: "PASS" };
}

function likelyCauseForEmptyPages(input: { permissions: MetaPermissionDiagnostic[]; loginConfigurationConfigured: boolean; businessAccessDetected: BusinessAccessState; businessAssetsReturned: number | null }) {
  const missing = missingBlockingPagePermissions(input.permissions);
  if (missing.length > 0) return {
    likelyCause: "Required Page permissions were not actually granted to this login.",
    recommendedAction: `Reconnect Facebook and grant: ${missing.map((item) => item.permission).join(", ")}.`,
  };
  if (!input.loginConfigurationConfigured) return {
    likelyCause: "The Facebook Login for Business Login Configuration ID is missing.",
    recommendedAction: "Set the correct Login Configuration ID in Meta Platform settings, then reconnect Facebook.",
  };
  if (input.permissions.find((permission) => permission.permission === BUSINESS_MANAGEMENT_PERMISSION)?.status !== "granted") return {
    likelyCause: "business_management was not granted to this Login for Business session, so Business Portfolio Pages may not be discoverable.",
    recommendedAction: "Add business_management to the Meta Login Configuration and reconnect. Directly-owned Pages can still connect when the four Page permissions are granted.",
  };
  if (input.businessAccessDetected === true && (input.businessAssetsReturned ?? 0) > 0) return {
    likelyCause: "This user has Business Portfolio asset access, but no directly manageable Page was exposed by this login.",
    recommendedAction: "In Meta Business Settings, grant this user Page access with messaging/management permissions and verify the Page is included in the Login for Business configuration.",
  };
  if (input.businessAccessDetected === true) return {
    likelyCause: "Business Portfolio access was detected, but Meta returned no Page assets usable for this login.",
    recommendedAction: "Verify Page access in Business Settings and verify the Login for Business configuration includes the Page asset.",
  };
  if (input.businessAccessDetected === false) return {
    likelyCause: "The Facebook user has no directly manageable Pages visible to this login.",
    recommendedAction: "Log in as a user with direct Page access, or grant this user access to the Page in Meta Business Settings, then reconnect.",
  };
  return {
    likelyCause: "Meta returned an unexpected empty Page asset set; Business Portfolio access could not be confirmed.",
    recommendedAction: "Verify the Login Configuration ID and included Page assets, then grant direct Page access and run the diagnostic again.",
  };
}

/**
 * Runs the live Page access probe. The returned `pages` value is intentionally
 * server-only; route handlers must map it to PublicMetaPage before responding.
 */
export async function runPageAccessDiagnostic(userAccessToken: string, options: { oauthCallback?: boolean } = {}): Promise<MetaPageAccessResult> {
  const config = await metaConfig();
  const errors: PageAccessDiagnostic["errors"] = [];
  const tokenDebug = await inspectMetaToken(userAccessToken);
  const userUrl = new URL(`https://graph.facebook.com/${config.version}/me`);
  userUrl.searchParams.set("fields", "id,name");
  const user = await metaJson<GraphUser>(userUrl, "oauth.user", withBearerToken(userAccessToken));
  if (!user.id) throw new MetaApiError("Meta did not return an authenticated user identity.", { operation: "oauth.user" });

  const permissions = await getGrantedPermissions(userAccessToken);
  const pageDiscovery = await discoverPageRows(userAccessToken, tokenDebug, permissions);
  const pages = pageDiscovery.pages.map(withoutSourceMetadata);
  errors.push(...pageDiscovery.errors);
  const { businessAccessDetected, businessAssetsReturned } = pageDiscovery;

  const loginConfigurationConfigured = Boolean(config.loginConfigurationId);
  const emptyCause = likelyCauseForEmptyPages({ permissions, loginConfigurationConfigured, businessAccessDetected, businessAssetsReturned });
  const checks = {
    facebookAuthentication: { status: "PASS" as const },
    oauthCallback: { status: options.oauthCallback === false ? "UNKNOWN" as const : "PASS" as const },
    tokenValidity: tokenDebug.isValid ? { status: "PASS" as const } : { status: "FAIL" as const },
    tokenAppId: tokenDebug.appId === config.appId ? { status: "PASS" as const } : { status: "FAIL" as const },
    userAccessToken: { status: "PASS" as const },
    pages_show_list: permissionCheck(permissions, "pages_show_list"),
    pages_read_engagement: permissionCheck(permissions, "pages_read_engagement"),
    pages_manage_metadata: permissionCheck(permissions, "pages_manage_metadata"),
    pages_messaging: permissionCheck(permissions, "pages_messaging"),
    business_management: permissionCheck(permissions, BUSINESS_MANAGEMENT_PERMISSION),
    loginConfiguration: loginConfigurationConfigured ? { status: "PASS" as const } : { status: "FAIL" as const, detail: "not configured" },
    manageablePages: pages.length > 0 ? { status: "PASS" as const } : { status: "FAIL" as const, detail: "Meta returned zero Page identities" },
  };
  return {
    pages,
    diagnostic: {
      authenticatedUser: true,
      authenticatedUserProfile: { id: user.id, ...(user.name ? { name: user.name } : {}) },
      oauthCallback: options.oauthCallback !== false,
      userAccessToken: true,
      tokenType: tokenDebug.type,
      permissions,
      pagesReturned: pageDiscovery.diagnostics.rawRowsReturned,
      ...pageDiscovery.diagnostics,
      loginConfigurationConfigured,
      graphApiVersion: config.version,
      checks,
      diagnostics: {
        directManageablePages: pageDiscovery.diagnostics.displayablePageCount,
        granularTargetIds: pageDiscovery.diagnostics.granularTargetIds ?? 0,
        granularPageTargets: pageDiscovery.diagnostics.granularPageTargets ?? 0,
        businessAssetTargets: pageDiscovery.diagnostics.businessAssetTargets ?? 0,
        unresolvedGranularTargets: pageDiscovery.diagnostics.unresolvedGranularTargets ?? 0,
        assignedPages: pageDiscovery.diagnostics.assignedPagesPageCount ?? 0,
        granularTargetDiagnostics: pageDiscovery.diagnostics.granularTargetDiagnostics ?? [],
        verifiedGranularPages: pageDiscovery.diagnostics.verifiedGranularPages ?? 0,
        finalMergedPages: pageDiscovery.diagnostics.finalMergedPages ?? pageDiscovery.diagnostics.displayablePageCount,
        granularAssetsAuthorized: (pageDiscovery.diagnostics.granularTargetIds ?? 0) > 0 && (pageDiscovery.diagnostics.verifiedGranularPages ?? 0) > 0,
        businessAccessDetected,
        businessAssetsReturned,
        ...(pages.length === 0 ? emptyCause : (pageDiscovery.diagnostics.meAccountsPageCount === 0 && (pageDiscovery.diagnostics.verifiedGranularPages ?? 0) > 0 ? { likelyCause: "Facebook Login for Business authorized Page assets through granular permissions.", recommendedAction: "Select and verify a Page to continue." } : { likelyCause: "Meta returned Page identities.", recommendedAction: "Select and verify a Page to continue." })),
      },
      errors,
    },
  };
}

export async function connectMetaPage(input: { pageId: string; metaPageId: string; name: string; pageAccessToken: string }) {
  const encryptedToken = encryptCredential(input.pageAccessToken);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.page.findUnique({ where: { metaPageId: input.metaPageId }, select: { id: true, slug: true, name: true } });
    if (existing && existing.id !== input.pageId) throw new DuplicateMetaPageError(existing.id, existing.slug, existing.name);
    const page = await tx.page.update({ where: { id: input.pageId }, data: { metaPageId: input.metaPageId, name: input.name, connectionStatus: "PENDING" } });
    await tx.pageConnection.upsert({ where: { pageId: page.id }, update: { encryptedToken, status: "PENDING", connectedAt: null, lastError: null, subscribedAt: null }, create: { pageId: page.id, encryptedToken, status: "PENDING" } });
    return page;
  });
}

export async function verifyMetaPage(pageAccessToken: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ id: string; name: string }>(url, "page.identity");
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (signature.slice(7).length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature.slice(7)), Buffer.from(expected));
}

export async function sendMetaMessage(pageAccessToken: string, recipientId: string, text: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ message_id?: string }>(url, "messages.send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }) });
}

export async function subscribePageWebhooks(pageId: string, pageAccessToken: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${pageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "messages,messaging_postbacks");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ success: boolean }>(url, "page.webhook_subscription", { method: "POST" });
}

export async function healthCheckMetaPage(pageId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { connection: true } });
  if (!page?.metaPageId || !page.connection?.encryptedToken) throw new Error("Page is not connected");
  try {
    const token = decryptCredential(page.connection.encryptedToken);
    const identity = await verifyMetaPage(token);
    if (identity.id !== page.metaPageId) throw new Error("Meta returned a different Page identity than the selected Page.");
    await subscribePageWebhooks(page.metaPageId, token);
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "CONNECTED", connectedAt: new Date(), lastHealthCheckAt: new Date(), lastHealthCheckStatus: "healthy", subscribedAt: new Date(), lastError: null } })]);
    return identity;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta health check failed";
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "ERROR" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "ERROR", lastHealthCheckAt: new Date(), lastHealthCheckStatus: "error", lastError: message.slice(0, 500) } })]);
    throw error;
  }
}
