import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

try {
  if (firebaseConfig && firebaseConfig.apiKey) {
    app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    authInstance = getAuth(app);
  }
} catch (err) {
  // Never crash client boot if third-party storage/IndexedDB is restricted in an iframe
  console.warn('Firebase Auth unavailable in current browser context:', err);
}

export const auth = authInstance;
export const googleAuthProvider = new GoogleAuthProvider();
