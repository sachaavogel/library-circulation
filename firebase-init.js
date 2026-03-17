import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const config = window.LIBRARY_CATALOG_FIREBASE_CONFIG || {};

export const firebaseConfigReady = REQUIRED_KEYS.every((key) => {
  const value = config[key];
  return typeof value === "string" && value.trim() && !value.includes("YOUR_");
});

const app = firebaseConfigReady
  ? getApps().length
    ? getApp()
    : initializeApp(config)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export function assertFirebaseReady() {
  if (!firebaseConfigReady || !auth || !db) {
    throw new Error(
      "Firebase config is incomplete. Update window.LIBRARY_CATALOG_FIREBASE_CONFIG in index.html."
    );
  }
}

export {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
};
