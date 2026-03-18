import {
  assertFirebaseReady,
  collection,
  db,
  doc,
  serverTimestamp,
  setDoc,
} from "./firebase-init.js";

function buildReceiptText({ patron, loans, holds }) {
  const patronName = patron.name || "patron";
  const patronLine = `${patronName} (${patron.barcode})`;

  const loanLines = loans.length
    ? loans.map((loan, index) => {
        const title = loan.bookTitle || "Unknown title";
        return `${index + 1}. ${title} — ${loan.bookBarcode}`;
      })
    : ["No active loans."];

  const holdLines = holds.length
    ? holds.map((hold, index) => {
        const title = hold.bookTitle || "Unknown title";
        return `${index + 1}. ${title} — ${hold.bookBarcode}`;
      })
    : ["No active holds."];

  return [
    `Hello ${patronName},`,
    "",
    `Patron: ${patronLine}`,
    "",
    "Active loans:",
    ...loanLines,
    "",
    "Active holds:",
    ...holdLines,
    "",
    "Thank you,",
    "Grand Oak Athenaeum",
  ].join("\n");
}

export async function queuePatronReceipt({ patron, loans, holds, requestedByUid }) {
  assertFirebaseReady();

  const email = String(patron?.email || "").trim();
  if (!email) {
    throw new Error("Patron email is required to send a receipt.");
  }

  const requester = String(requestedByUid || "").trim();
  if (!requester) {
    throw new Error("Active session is required to send a receipt.");
  }

  const patronBarcode = String(patron?.barcode || "").trim();
  if (!patronBarcode) {
    throw new Error("Patron barcode is missing.");
  }

  const subject = "Your Grand Oak Athenaeum loans and holds";
  const text = buildReceiptText({ patron, loans, holds });

  const mailRef = doc(collection(db, "mail"));
  await setDoc(mailRef, {
    to: email,
    message: {
      subject,
      text,
    },
    createdAt: serverTimestamp(),
    requestedByUid: requester,
    patronBarcode,
  });

  return {
    id: mailRef.id,
  };
}
