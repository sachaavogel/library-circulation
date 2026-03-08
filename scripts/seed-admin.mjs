import admin from "firebase-admin";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error(
    'Usage: npm run seed:admin -- "admin@library.org" "StrongPassword123!"'
  );
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "Set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service account JSON file before running this script."
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const auth = admin.auth();
const firestore = admin.firestore();

let userRecord;

try {
  userRecord = await auth.getUserByEmail(email);
  console.log(`Using existing Firebase Auth user ${userRecord.uid} for ${email}.`);
} catch (error) {
  if (error?.code !== "auth/user-not-found") {
    throw error;
  }

  userRecord = await auth.createUser({
    email,
    password,
  });

  console.log(`Created Firebase Auth user ${userRecord.uid} for ${email}.`);
}

await firestore.doc(`users/${userRecord.uid}`).set(
  {
    email,
    role: "admin",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  { merge: true }
);

console.log(`Ensured admin role document at users/${userRecord.uid}.`);
