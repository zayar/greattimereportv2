function readEnv(key: keyof ImportMetaEnv) {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function normalizeApiBaseUrl(value: string) {
  const parsed = new URL(value);
  const path = parsed.pathname.replace(/\/+$/, "");

  if (path === "" || path === "/") {
    parsed.pathname = "/api";
    return parsed.toString().replace(/\/+$/, "");
  }

  if (path.endsWith("/api")) {
    parsed.pathname = path;
    return parsed.toString().replace(/\/+$/, "");
  }

  parsed.pathname = path;
  return parsed.toString().replace(/\/+$/, "");
}

export const env = {
  apiBaseUrl: normalizeApiBaseUrl(readEnv("VITE_API_BASE_URL")),
  apicoreGraphqlUrl: readEnv("VITE_APICORE_GRAPHQL_URL"),
  googleClientId: readEnv("VITE_GOOGLE_CLIENT_ID"),
  firebase: {
    apiKey: readEnv("VITE_FIREBASE_API_KEY"),
    authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: readEnv("VITE_FIREBASE_APP_ID"),
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  },
};
