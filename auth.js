import {
  assertFirebaseReady,
  auth,
  db,
  doc,
  getDoc,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "./firebase-init.js";
import { USER_ROLE } from "./shared.js";

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
    createdAt: userData.createdAt || null,
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

export async function signOutAdmin() {
  assertFirebaseReady();
  await signOut(auth);
}

export function watchAdminSession(onSessionChange, onError) {
  assertFirebaseReady();

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onSessionChange(null);
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
