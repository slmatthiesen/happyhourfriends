import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
} from "firebase/auth";

/**
 * Browser-side Firebase used only for admin Google sign-in (PRD §2 — operator
 * login only). Reads NEXT_PUBLIC_FIREBASE_* env; when absent the login UI shows an
 * "unconfigured" notice, mirroring the server gate's no-op behaviour.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export function isFirebaseClientConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

let app: FirebaseApp | undefined;

function firebaseAuth(): Auth {
  app = getApps()[0] ?? initializeApp(config);
  return getAuth(app);
}

/** Pop the Google sign-in flow and return a fresh ID token for session exchange. */
export async function signInWithGoogleIdToken(): Promise<string> {
  const cred = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
  return cred.user.getIdToken();
}
