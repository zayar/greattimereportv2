import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { assertAgentReadOnlyGraphql } from "./agent-hub/read-only-guard.js";

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

const CHECK_INS_QUERY = `
  query AgentHubCheckIns(
    $where: CheckInWhereInput
    $orderBy: [CheckInOrderByWithRelationInput!]
    $take: Int
    $skip: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    checkIns(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      in_time
      out_time
      status
      created_at
      isUsePurchaseService
      merchant_note
      order_id
      service {
        id
        name
      }
      practitioner {
        id
        name
      }
      member {
        name
        phonenumber
        clinic_members(where: $clinicMembersWhere2) {
          name
          phonenumber
          clinic_id
        }
      }
      booking {
        service_helper {
          id
          name
        }
      }
      orders {
        order_id
        discount
        tax
        total
        net_total
        payment_method
        payment_status
        seller {
          display_name
        }
      }
      helper {
        name
      }
    }
    aggregateCheckIn(where: $where) {
      _count {
        _all
      }
    }
  }
`;

const PAYMENT_REPORT_QUERY = `
  query GetPaymentReport(
    $clinicCode: String!
    $filterType: String!
    $startDate: DateTime
    $endDate: DateTime
    $selectedDate: DateTime
    $skip: Int
    $take: Int
  ) {
    getPaymentReport(
      clinicCode: $clinicCode
      filterType: $filterType
      startDate: $startDate
      endDate: $endDate
      selectedDate: $selectedDate
      skip: $skip
      take: $take
    ) {
      data {
        Date
        InvoiceNumber
        CustomerName
        MemberId
        SalePerson
        ServiceName
        ServicePackageName
        PaymentMethod
        PaymentStatus
        WalletTopUp
        InvoiceNetTotal
      }
      totalCount
    }
  }
`;

const TELEGRAM_PAYMENT_ORDERS_QUERY = `
  query TelegramPaymentOrders(
    $where: OrderWhereInput
    $orderBy: [OrderOrderByWithRelationInput!]
    $take: Int
    $skip: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    orders(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      order_id
      created_at
      status
      net_total
      total
      balance
      credit_balance
      payment_method
      payment_status
      member {
        name
        clinic_members(where: $clinicMembersWhere2) {
          name
          clinic_id
        }
      }
      user {
        name
      }
      seller {
        display_name
      }
      payments {
        payment_amount
        payment_method
        payment_note
        payment_date
      }
    }
    aggregateOrder(where: $where) {
      _count {
        id
      }
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

export type ApicorePaymentReportRow = {
  Date: string;
  InvoiceNumber: string;
  CustomerName: string;
  MemberId: string;
  SalePerson: string;
  ServiceName: string;
  ServicePackageName?: string | null;
  PaymentMethod?: string | null;
  PaymentStatus?: string | null;
  WalletTopUp?: string | number | null;
  InvoiceNetTotal: number | string;
};

export type ApicoreCheckInRow = {
  id: string;
  in_time: string;
  out_time?: string | null;
  status: string;
  created_at: string;
  isUsePurchaseService?: boolean | null;
  merchant_note?: string | null;
  order_id?: string | null;
  service?: {
    id?: string | null;
    name?: string | null;
  } | null;
  practitioner?: {
    id?: string | null;
    name?: string | null;
  } | null;
  member?: {
    name?: string | null;
    phonenumber?: string | null;
    clinic_members?: Array<{
      name?: string | null;
      phonenumber?: string | null;
      clinic_id?: string | null;
    }> | null;
  } | null;
  booking?: {
    service_helper?: {
      id?: string | null;
      name?: string | null;
    } | null;
  } | null;
  orders?: Array<{
    order_id?: string | null;
    discount?: number | string | null;
    tax?: number | string | null;
    total?: number | string | null;
    net_total?: number | string | null;
    payment_method?: string | null;
    payment_status?: string | null;
    seller?: {
      display_name?: string | null;
    } | null;
  }> | null;
  helper?: {
    name?: string | null;
  } | null;
};

export type ApicoreOrderPaymentRow = {
  payment_amount: number | string;
  payment_method?: string | null;
  payment_note?: string | null;
  payment_date: string;
};

export type ApicoreOrderWithPaymentsRow = {
  id: string;
  order_id: string;
  created_at: string;
  status?: string | null;
  net_total?: number | string | null;
  total?: number | string | null;
  balance?: number | string | null;
  credit_balance?: number | string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  member?: {
    name?: string | null;
    clinic_members?: Array<{
      name?: string | null;
      clinic_id?: string | null;
    }> | null;
  } | null;
  user?: {
    name?: string | null;
  } | null;
  seller?: {
    display_name?: string | null;
  } | null;
  payments?: ApicoreOrderPaymentRow[] | null;
};

type BookingDetailsPayload = {
  getBookingDetails?: {
    data?: ApicoreBookingDetailsRow[];
    totalCount?: number;
  } | null;
};

type PaymentReportPayload = {
  getPaymentReport?: {
    data?: ApicorePaymentReportRow[];
    totalCount?: number;
  } | null;
};

type CheckInsPayload = {
  checkIns?: ApicoreCheckInRow[] | null;
  aggregateCheckIn?: {
    _count?: {
      _all?: number | null;
    } | null;
  } | null;
};

type TelegramPaymentOrdersPayload = {
  orders?: ApicoreOrderWithPaymentsRow[] | null;
  aggregateOrder?: {
    _count?: {
      id?: number | null;
    } | null;
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, timeoutMessage: string) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new HttpError(504, timeoutMessage);
    }

    throw error;
  }
}

async function postGraphql<T>(body: Record<string, unknown>, authorization?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await fetchWithTimeout(
    resolveApicoreGraphqlUrl(),
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    env.APICORE_REQUEST_TIMEOUT_MS,
    "gt.apicore GraphQL request timed out.",
  );

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to reach gt.apicore GraphQL endpoint.");
  }

  return (await response.json()) as GraphQLResponse<T>;
}

export async function forwardApicoreGraphqlRequest<T>(input: {
  requestBody: Record<string, unknown>;
  authorizationHeader?: string;
}) {
  const authorization = input.authorizationHeader?.trim();

  if (!authorization) {
    throw new HttpError(401, "Missing Firebase bearer token.");
  }

  return postGraphql<T>(input.requestBody, authorization);
}

async function executeApicoreQueryWithFallback<T>(input: {
  requestBody: Record<string, unknown>;
  authorizationHeader?: string;
  errorMessage: string;
  readOnly?: boolean;
}) {
  if (input.readOnly) {
    const query = input.requestBody.query;
    if (typeof query !== "string") {
      throw new Error("Agent Hub APICORE access is read-only.");
    }
    assertAgentReadOnlyGraphql(query);
  }

  const usingCallerAuthorization =
    Boolean(input.authorizationHeader) && input.authorizationHeader!.trim().length > 0;
  const authorization = usingCallerAuthorization
    ? input.authorizationHeader!.trim()
    : `Bearer ${await getApicoreServiceIdToken()}`;

  let payload: GraphQLResponse<T>;

  try {
    payload = await postGraphql<T>(input.requestBody, authorization);
  } catch (error) {
    if (usingCallerAuthorization && error instanceof HttpError && error.statusCode === 401) {
      const serviceAuthorization = `Bearer ${await getApicoreServiceIdToken()}`;
      payload = await postGraphql<T>(input.requestBody, serviceAuthorization);
    } else {
      throw error;
    }
  }

  if (payload.errors?.length && usingCallerAuthorization && isGraphqlAuthError(payload.errors[0]?.message)) {
    const serviceAuthorization = `Bearer ${await getApicoreServiceIdToken()}`;
    payload = await postGraphql<T>(input.requestBody, serviceAuthorization);
  }

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || input.errorMessage);
  }

  return payload;
}

export async function queryApicoreWithFallback<T>(input: {
  query: string;
  variables?: Record<string, unknown>;
  authorizationHeader?: string;
  errorMessage: string;
  readOnly?: boolean;
}) {
  const payload = await executeApicoreQueryWithFallback<T>({
    requestBody: {
      query: input.query,
      variables: input.variables ?? {},
    },
    authorizationHeader: input.authorizationHeader,
    errorMessage: input.errorMessage,
    readOnly: input.readOnly,
  });

  return payload.data;
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

  const response = await fetchWithTimeout(
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
    env.FIREBASE_AUTH_REQUEST_TIMEOUT_MS,
    "Firebase custom token exchange timed out.",
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
  readOnly?: boolean;
}) {
  const payload = await executeApicoreQueryWithFallback<BookingDetailsPayload>({
    requestBody: {
      query: BOOKING_DETAILS_QUERY,
      variables: {
        clinicCode: params.clinicCode,
        startDate: params.startDate,
        endDate: params.endDate,
        status: params.status,
        skip: params.skip ?? 0,
        take: params.take ?? 200,
      },
    },
    authorizationHeader: params.authorizationHeader,
    errorMessage: "Booking details query failed.",
    readOnly: params.readOnly,
  });

  return {
    data: payload.data?.getBookingDetails?.data ?? [],
    totalCount: payload.data?.getBookingDetails?.totalCount ?? 0,
  };
}

export async function fetchApicoreCheckIns(params: {
  clinicId: string;
  startDate: string;
  endDate: string;
  status?: string;
  skip?: number;
  take?: number;
  authorizationHeader?: string;
  readOnly?: boolean;
}) {
  const andFilters: Array<Record<string, unknown>> = [
    {
      in_time: {
        gte: params.startDate,
      },
    },
    {
      in_time: {
        lte: params.endDate,
      },
    },
    {
      clinic_id: {
        equals: params.clinicId,
      },
    },
  ];

  if (params.status) {
    andFilters.push({
      status: {
        in: [params.status],
      },
    });
  }

  const payload = await executeApicoreQueryWithFallback<CheckInsPayload>({
    requestBody: {
      query: CHECK_INS_QUERY,
      variables: {
        where: {
          AND: andFilters,
        },
        clinicMembersWhere2: {
          clinic_id: {
            equals: params.clinicId,
          },
        },
        orderBy: [{ in_time: "desc" }],
        take: params.take ?? 200,
        skip: params.skip ?? 0,
      },
    },
    authorizationHeader: params.authorizationHeader,
    errorMessage: "Check-in query failed.",
    readOnly: params.readOnly,
  });

  return {
    data: payload.data?.checkIns ?? [],
    totalCount: payload.data?.aggregateCheckIn?._count?._all ?? 0,
  };
}

async function executeLegacyPaymentReportQuery(params: {
  variables: Record<string, unknown>;
  authorizationHeader?: string;
}) {
  let payload: GraphQLResponse<PaymentReportPayload>;

  try {
    payload = await postGraphql<PaymentReportPayload>({
      query: PAYMENT_REPORT_QUERY,
      variables: params.variables,
    });
  } catch (error) {
    if (
      params.authorizationHeader &&
      error instanceof HttpError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      payload = await executeApicoreQueryWithFallback<PaymentReportPayload>({
        requestBody: {
          query: PAYMENT_REPORT_QUERY,
          variables: params.variables,
        },
        authorizationHeader: params.authorizationHeader,
        errorMessage: "Payment report query failed.",
      });
    } else {
      throw error;
    }
  }

  if (payload.errors?.length && params.authorizationHeader) {
    payload = await executeApicoreQueryWithFallback<PaymentReportPayload>({
      requestBody: {
        query: PAYMENT_REPORT_QUERY,
        variables: params.variables,
      },
      authorizationHeader: params.authorizationHeader,
      errorMessage: "Payment report query failed.",
    });
  }

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || "Payment report query failed.");
  }

  return payload;
}

export async function fetchApicorePaymentReport(params: {
  clinicCode: string;
  startDate: string;
  endDate: string;
  skip?: number;
  take?: number;
  authorizationHeader?: string;
}) {
  const payload = await executeLegacyPaymentReportQuery({
    variables: {
      clinicCode: params.clinicCode,
      filterType: "day",
      startDate: params.startDate,
      endDate: params.endDate,
      skip: params.skip ?? 0,
      take: params.take ?? 200,
    },
    authorizationHeader: params.authorizationHeader,
  });

  return {
    data: payload.data?.getPaymentReport?.data ?? [],
    totalCount: payload.data?.getPaymentReport?.totalCount ?? 0,
  };
}

export async function fetchApicoreOrdersWithPayments(params: {
  clinicId: string;
  startDate: string;
  endDate: string;
  skip?: number;
  take?: number;
  authorizationHeader?: string;
}) {
  const payload = await executeApicoreQueryWithFallback<TelegramPaymentOrdersPayload>({
    requestBody: {
      query: TELEGRAM_PAYMENT_ORDERS_QUERY,
      variables: {
        where: {
          clinic_id: {
            equals: params.clinicId,
          },
          status: {
            equals: "ACTIVE",
          },
          payments: {
            some: {
              payment_date: {
                gte: params.startDate,
                lte: params.endDate,
              },
            },
          },
        },
        orderBy: [{ created_at: "desc" }],
        take: params.take ?? 200,
        skip: params.skip ?? 0,
        clinicMembersWhere2: {
          clinic_id: {
            equals: params.clinicId,
          },
        },
      },
    },
    authorizationHeader: params.authorizationHeader,
    errorMessage: "Payment report query failed.",
  });

  return {
    data: payload.data?.orders ?? [],
    totalCount: payload.data?.aggregateOrder?._count?.id ?? 0,
  };
}
