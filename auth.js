import {
  assertFirebaseReady,
  auth,
  db,
  doc,
  getDoc,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "./firebase-init.js";
import { ACCESS_MODE, USER_ROLE } from "./shared.js";

async function readAdminUser(uid, fallbackEmail = "") {
  assertFirebaseReady();

  const userRef = doc(db, "users", uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error("Signed-in user does not have an admin role record.");
  }

  const userData = userSnapshot.data();

  if (userData.role !== USER_ROLE.admin) {
    throw new Error("Signed-in user is not authorized as an admin.");
  }

  return {
    uid,
    email: userData.email || fallbackEmail,
    role: userData.role,
    access: ACCESS_MODE.admin,
    createdAt: userData.createdAt || null,
  };
}

function buildGuestSession(user) {
  return {
    uid: user.uid,
    email: "Guest mode",
    role: ACCESS_MODE.guest,
    access: ACCESS_MODE.guest,
    createdAt: null,
  };
}

export async function signInAdmin(email, password) {
  assertFirebaseReady();

  if (!String(email ?? "").trim()) {
    throw new Error("Email is required.");
  }

  if (!String(password ?? "").trim()) {
    throw new Error("Password is required.");
  }

  const credentials = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  try {
    return await readAdminUser(credentials.user.uid, credentials.user.email || "");
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}

export async function signInGuest() {
  assertFirebaseReady();
  const credentials = await signInAnonymously(auth);
  return buildGuestSession(credentials.user);
}

export async function signOutSession() {
  assertFirebaseReady();
  await signOut(auth);
}

export function watchLibrarySession(onSessionChange, onError) {
  assertFirebaseReady();

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onSessionChange(null);
      return;
    }

    if (user.isAnonymous) {
      onSessionChange(buildGuestSession(user));
      return;
    }

    try {
      const adminUser = await readAdminUser(user.uid, user.email || "");
      onSessionChange(adminUser);
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      onError?.(error);
      onSessionChange(null);
    }
  });
}
