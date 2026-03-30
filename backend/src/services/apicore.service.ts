import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

const CANONICAL_APICORE_GRAPHQL_URL = "https://greattime-api-core-hs6rtohe3q-uc.a.run.app/apicore";
const DEV_APICORE_GRAPHQL_HOST = "greattime-api-core-dev-75918019031.us-central1.run.app";
const PROD_CLOUD_RUN_APICORE_HOST_PATTERN = /^greattime-api-core-\d+\.us-central1\.run\.app$/;

const GAUTH_MUTATION = `
  mutation Gauth2($token: String!) {
    gauth2(token: $token) {
      token
    }
  }
`;

const GAUTH2_MUTATION = `
  mutation Gauth2($token: String!) {
    gauth2(token: $token) {
      token
    }
  }
`;

const BOOKING_DETAILS_QUERY = `
  query GetBookingDetails(
    $clinicCode: String!
    $startDate: DateTime!
    $endDate: DateTime!
    $status: BookingStatus
    $skip: Int
    $take: Int
  ) {
    getBookingDetails(
      clinicCode: $clinicCode
      startDate: $startDate
      endDate: $endDate
      status: $status
      skip: $skip
      take: $take
    ) {
      data {
        bookingid
        FromTime
        ToTime
        ServiceName
        MemberName
        MemberPhoneNumber
        PractitionerName
        ClinicName
        ClinicCode
        ClinicID
        HelperName
        status
        member_note
      }
      totalCount
    }
  }
`;

type GraphQLErrorShape = {
  message?: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorShape[];
};

export type ApicoreBookingDetailsRow = {
  bookingid: string;
  FromTime: string;
  ToTime: string;
  ServiceName: string;
  MemberName: string;
  MemberPhoneNumber: string;
  PractitionerName: string;
  ClinicName: string;
  ClinicCode: string;
  ClinicID: string;
  HelperName?: string | null;
  status: string;
  member_note?: string | null;
};

type BookingDetailsPayload = {
  getBookingDetails?: {
    data?: ApicoreBookingDetailsRow[];
    totalCount?: number;
  } | null;
};

let cachedServiceIdToken: { token: string; expiresAt: number } | null = null;
let hasLoggedApicoreUrlRewrite = false;

function buildBasicAuthorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function resolveApicoreGraphqlUrl() {
  let configuredUrl: URL;

  try {
    configuredUrl = new URL(env.APICORE_GRAPHQL_URL);
  } catch {
    return env.APICORE_GRAPHQL_URL;
  }

  if (configuredUrl.hostname === DEV_APICORE_GRAPHQL_HOST) {
    return env.APICORE_GRAPHQL_URL;
  }

  // gt.apicore's production auth allowlist currently trusts the hashed public URL,
  // not the direct Cloud Run service hostname. Normalize here so Telegram live
  // appointment fetches do not fail when deploy vars drift to the service URL.
  if (PROD_CLOUD_RUN_APICORE_HOST_PATTERN.test(configuredUrl.hostname)) {
    if (!hasLoggedApicoreUrlRewrite) {
      console.warn(
        `[apicore] rewriting APICORE_GRAPHQL_URL host from ${configuredUrl.hostname} to ${new URL(CANONICAL_APICORE_GRAPHQL_URL).hostname}`,
      );
      hasLoggedApicoreUrlRewrite = true;
    }
    return CANONICAL_APICORE_GRAPHQL_URL;
  }

  return env.APICORE_GRAPHQL_URL;
}

function isGraphqlAuthError(message: string | undefined) {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("access forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("token is invalid") ||
    normalized.includes("token has expired")
  );
}

async function postGraphql<T>(body: Record<string, unknown>, authorization?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await fetch(resolveApicoreGraphqlUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to reach gt.apicore GraphQL endpoint.");
  }

  return (await response.json()) as GraphQLResponse<T>;
}

export async function exchangeGoogleCredentialForCustomToken(credential: string) {
  const payload = await postGraphql<{ gauth2?: { token?: string | null } | null }>({
    query: GAUTH_MUTATION,
    variables: { token: credential },
  });

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || "Google sign-in failed.");
  }

  const customToken = payload.data?.gauth2?.token;
  if (!customToken) {
    throw new HttpError(401, "gt.apicore did not return a Firebase custom token.");
  }

  return customToken;
}

async function exchangeApicoreBasicAuthForCustomToken() {
  if (!env.APICORE_SERVICE_USERNAME || !env.APICORE_SERVICE_PASSWORD) {
    throw new HttpError(
      500,
      "APICORE_SERVICE_USERNAME and APICORE_SERVICE_PASSWORD are required for Telegram scheduled appointment reports.",
    );
  }

  const payload = await postGraphql<{ gauth2?: { token?: string | null } | null }>(
    {
      query: GAUTH2_MUTATION,
      variables: { token: "" },
    },
    buildBasicAuthorization(env.APICORE_SERVICE_USERNAME, env.APICORE_SERVICE_PASSWORD),
  );

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || "Service auth failed against gt.apicore.");
  }

  const customToken = payload.data?.gauth2?.token;
  if (!customToken) {
    throw new HttpError(401, "gt.apicore did not return a Firebase custom token for service auth.");
  }

  return customToken;
}

async function exchangeCustomTokenForIdToken(customToken: string) {
  if (!env.FIREBASE_WEB_API_KEY) {
    throw new HttpError(
      500,
      "FIREBASE_WEB_API_KEY is required for Telegram scheduled appointment reports.",
    );
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to exchange Firebase custom token for ID token.");
  }

  const payload = (await response.json()) as {
    idToken?: string;
    expiresIn?: string;
    error?: { message?: string };
  };

  if (payload.error?.message) {
    throw new HttpError(401, payload.error.message);
  }

  if (!payload.idToken) {
    throw new HttpError(401, "Firebase did not return an ID token for service auth.");
  }

  const expiresInSeconds = Number(payload.expiresIn ?? "3600");
  return {
    idToken: payload.idToken,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000,
  };
}

export async function getApicoreServiceIdToken() {
  if (cachedServiceIdToken && cachedServiceIdToken.expiresAt > Date.now()) {
    return cachedServiceIdToken.token;
  }

  const customToken = await exchangeApicoreBasicAuthForCustomToken();
  const tokenPair = await exchangeCustomTokenForIdToken(customToken);
  cachedServiceIdToken = { token: tokenPair.idToken, expiresAt: tokenPair.expiresAt };

  return tokenPair.idToken;
}

export async function fetchApicoreBookingDetails(params: {
  clinicCode: string;
  startDate: string;
  endDate: string;
  status?: string;
  skip?: number;
  take?: number;
  authorizationHeader?: string;
}) {
  const usingCallerAuthorization =
    Boolean(params.authorizationHeader) && params.authorizationHeader!.trim().length > 0;
  const authorization = usingCallerAuthorization
    ? params.authorizationHeader!.trim()
    : `Bearer ${await getApicoreServiceIdToken()}`;

  const requestBody = {
    query: BOOKING_DETAILS_QUERY,
    variables: {
      clinicCode: params.clinicCode,
      startDate: params.startDate,
      endDate: params.endDate,
      status: params.status,
      skip: params.skip ?? 0,
      take: params.take ?? 200,
    },
  };

  let payload: GraphQLResponse<BookingDetailsPayload>;

  try {
    payload = await postGraphql<BookingDetailsPayload>(requestBody, authorization);
  } catch (error) {
    if (usingCallerAuthorization && error instanceof HttpError && error.statusCode === 401) {
      const serviceAuthorization = `Bearer ${await getApicoreServiceIdToken()}`;
      payload = await postGraphql<BookingDetailsPayload>(requestBody, serviceAuthorization);
    } else {
      throw error;
    }
  }

  if (payload.errors?.length && usingCallerAuthorization && isGraphqlAuthError(payload.errors[0]?.message)) {
    const serviceAuthorization = `Bearer ${await getApicoreServiceIdToken()}`;
    payload = await postGraphql<BookingDetailsPayload>(requestBody, serviceAuthorization);
  }

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || "Booking details query failed.");
  }

  return {
    data: payload.data?.getBookingDetails?.data ?? [],
    totalCount: payload.data?.getBookingDetails?.totalCount ?? 0,
  };
}
