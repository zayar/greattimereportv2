import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { env } from "./env";

export const firebaseApp = initializeApp(env.firebase);

export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);
