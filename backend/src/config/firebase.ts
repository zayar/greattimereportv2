import { readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "./env.js";

type ServiceAccountShape = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function readServiceAccount(): ServiceAccountShape | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccountShape;
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return JSON.parse(raw) as ServiceAccountShape;
  }

  return null;
}

export function ensureFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = readServiceAccount();

  return initializeApp({
    credential: serviceAccount
      ? cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        })
      : applicationDefault(),
  });
}

export function firebaseAuth() {
  return getAuth(ensureFirebaseAdmin());
}

export function firestoreDb() {
  return getFirestore(ensureFirebaseAdmin());
}
