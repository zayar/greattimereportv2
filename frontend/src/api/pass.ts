import type { DocumentNode } from "@apollo/client";
import { print } from "graphql";

export type PassAuthConfig = {
  id?: string | null;
  refresh_token?: string | null;
  refresh_token_url?: string | null;
};

type PassTokenPayload = {
  access_token?: string;
  expires_in?: string | number;
};

type GraphqlError = {
  message?: string;
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: GraphqlError[];
};

type CachedPassToken = {
  token: string;
  expiresAt: number;
};

const PASS_GRAPHQL_URL = "https://api.pitipass.com/graphql";
const PASS_TOKEN_STORAGE_PREFIX = "gtv2.pass.token";
const TOKEN_REFRESH_BUFFER_MS = 60_000;

const memoryTokenCache = new Map<string, CachedPassToken>();

function getStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function getCacheKey(config: PassAuthConfig) {
  return `${PASS_TOKEN_STORAGE_PREFIX}:${config.id ?? "unknown"}:${config.refresh_token_url ?? "default"}`;
}

function readCachedToken(cacheKey: string) {
  const cached = memoryTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cached;
  }

  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(cacheKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CachedPassToken;
    if (parsed.token && parsed.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      memoryTokenCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    storage.removeItem(cacheKey);
  }

  return null;
}

function writeCachedToken(cacheKey: string, token: CachedPassToken) {
  memoryTokenCache.set(cacheKey, token);
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(cacheKey, JSON.stringify(token));
}

function clearCachedToken(cacheKey: string) {
  memoryTokenCache.delete(cacheKey);
  const storage = getStorage();
  storage?.removeItem(cacheKey);
}

function getGraphqlDocument(query: string | DocumentNode) {
  return typeof query === "string" ? query : print(query);
}

function getFirstGraphqlError<T>(payload: GraphqlResponse<T>) {
  return payload.errors?.find((error) => Boolean(error.message))?.message ?? null;
}

function isAuthErrorMessage(message: string | null) {
  const normalized = message?.toLowerCase() ?? "";
  return (
    normalized.includes("unauthorized") ||
    normalized.includes("invalid token") ||
    normalized.includes("token is invalid") ||
    normalized.includes("jwt") ||
    normalized.includes("forbidden")
  );
}

async function refreshPassAccessToken(config: PassAuthConfig) {
  if (!config.refresh_token_url || !config.refresh_token) {
    throw new Error("PASS token refresh is not configured for this clinic.");
  }

  const response = await fetch(config.refresh_token_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: config.refresh_token,
    }),
  });

  if (!response.ok) {
    throw new Error(`PASS token refresh failed with status code ${response.status}.`);
  }

  const payload = (await response.json()) as PassTokenPayload;
  const accessToken = payload.access_token?.trim();

  if (!accessToken) {
    throw new Error("PASS token refresh returned no access token.");
  }

  const expiresInSeconds = Math.max(Number(payload.expires_in ?? 3600), 120);
  const token = {
    token: accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  writeCachedToken(getCacheKey(config), token);
  return token.token;
}

async function getPassAccessToken(config: PassAuthConfig) {
  const cacheKey = getCacheKey(config);
  const cached = readCachedToken(cacheKey);

  if (cached) {
    return cached.token;
  }

  return refreshPassAccessToken(config);
}

async function postPassGraphql<T>(args: {
  query: string | DocumentNode;
  variables?: Record<string, unknown>;
  accessToken: string;
}) {
  const response = await fetch(PASS_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      query: getGraphqlDocument(args.query),
      variables: args.variables ?? {},
    }),
  });

  const payload = (await response.json()) as GraphqlResponse<T>;

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function queryPassGraphql<T>(args: {
  query: string | DocumentNode;
  variables?: Record<string, unknown>;
  passConfig: PassAuthConfig;
}) {
  const accessToken = await getPassAccessToken(args.passConfig);
  let response = await postPassGraphql<T>({
    query: args.query,
    variables: args.variables,
    accessToken,
  });

  const firstError = getFirstGraphqlError(response.payload);
  const shouldRetryForAuth =
    response.status === 401 ||
    response.status === 403 ||
    isAuthErrorMessage(firstError);

  if (shouldRetryForAuth) {
    clearCachedToken(getCacheKey(args.passConfig));
    const refreshedToken = await refreshPassAccessToken(args.passConfig);
    response = await postPassGraphql<T>({
      query: args.query,
      variables: args.variables,
      accessToken: refreshedToken,
    });
  }

  if (!response.ok) {
    throw new Error(`PASS request failed with status code ${response.status}.`);
  }

  const errorMessage = getFirstGraphqlError(response.payload);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  if (!response.payload.data) {
    throw new Error("PASS returned no data.");
  }

  return response.payload.data;
}
