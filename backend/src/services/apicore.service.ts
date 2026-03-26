import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

const GAUTH_MUTATION = `
  mutation Gauth($token: String!) {
    gauth(token: $token)
  }
`;

export async function exchangeGoogleCredentialForCustomToken(credential: string) {
  const response = await fetch(env.APICORE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: GAUTH_MUTATION,
      variables: { token: credential },
    }),
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to reach gt.apicore auth endpoint.");
  }

  const payload = (await response.json()) as {
    data?: { gauth?: string | null };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new HttpError(401, payload.errors[0]?.message || "Google sign-in failed.");
  }

  const customToken = payload.data?.gauth;
  if (!customToken) {
    throw new HttpError(401, "gt.apicore did not return a Firebase custom token.");
  }

  return customToken;
}

