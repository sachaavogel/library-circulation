const admin = require("firebase-admin");
const functions = require("firebase-functions");

admin.initializeApp();

const db = admin.firestore();

exports.queueHoldReadyEmail = functions.firestore
  .document("holds/{holdId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    if (before.status === after.status) {
      return null;
    }

    if (after.status !== "fulfilled_auto_checkout") {
      return null;
    }

    const patronBarcode = after.patronBarcode;
    const bookBarcode = after.bookBarcode;

    if (!patronBarcode || !bookBarcode) {
      return null;
    }

    const [patronSnap, bookSnap] = await Promise.all([
      db.doc(`patrons/${patronBarcode}`).get(),
      db.doc(`books/${bookBarcode}`).get(),
    ]);

    const patron = patronSnap.exists ? patronSnap.data() : null;
    const book = bookSnap.exists ? bookSnap.data() : null;
    const email = patron?.email;

    if (!email) {
      return null;
    }

    const patronName = patron?.name || "patron";
    const title = book?.title || "Library book";
    const subject = `Hold ready: ${title}`;
    const text = [
      `Hello ${patronName},`,
      "",
      "Your hold is ready and has been checked out to you.",
      "",
      `Title: ${title}`,
      `Barcode: ${bookBarcode}`,
      "",
      "Thank you,",
      "Grand Oak Athenaeum",
    ].join("\n");

    await db.collection("mail").add({
      to: email,
      message: {
        subject,
        text,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      patronBarcode,
      type: "hold_ready",
    });

    return null;
  });
