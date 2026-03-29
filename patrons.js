import {
  assertFirebaseReady,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "./firebase-init.js";
import {
  HOLD_STATUS,
  LOAN_STATUS,
  compareByTimestampAscending,
  compareByTimestampDescending,
  requireEmail,
  requireName,
  requireBarcode,
} from "./shared.js";

function mapSnapshot(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

async function getBookTitles(bookBarcodes) {
  const uniqueBarcodes = [...new Set(bookBarcodes)];
  const titleMap = new Map();

  await Promise.all(
    uniqueBarcodes.map(async (barcode) => {
      const bookSnapshot = await getDoc(doc(db, "books", barcode));
      titleMap.set(barcode, bookSnapshot.exists() ? bookSnapshot.data().title : "Unknown title");
    })
  );

  return titleMap;
}

export async function ensurePatron(rawPatronBarcode, options = {}) {
  assertFirebaseReady();

  const patronBarcode = requireBarcode(rawPatronBarcode, "Patron barcode");
  const name = options.name ? requireName(options.name) : null;
  const email = options.email ? requireEmail(options.email) : null;
  let created = false;

  await runTransaction(db, async (transaction) => {
    const patronRef = doc(db, "patrons", patronBarcode);
    const patronSnapshot = await transaction.get(patronRef);

    if (patronSnapshot.exists()) {
      const existingData = patronSnapshot.data() || {};
      const existingName = existingData.name || null;
      const existingEmail = existingData.email || null;
      const existingFineCents =
        typeof existingData.fineCents === "number" ? existingData.fineCents : null;
      const shouldSetName = name && !existingName;
      const shouldSetEmail = email && !existingEmail;
      const shouldSetFine = existingFineCents == null;
      created = false;
      transaction.set(
        patronRef,
        {
          barcode: patronBarcode,
          lastSeenAt: serverTimestamp(),
          status: "active",
          ...(shouldSetName ? { name } : {}),
          ...(shouldSetEmail ? { email } : {}),
          ...(shouldSetFine ? { fineCents: 0 } : {}),
        },
        { merge: true }
      );
      return;
    }

    created = true;
    transaction.set(patronRef, {
      barcode: patronBarcode,
      name: name || "",
      email: email || "",
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      activeLoanCount: 0,
      activeHoldCount: 0,
      fineCents: 0,
      status: "active",
    });
  });

  return {
    barcode: patronBarcode,
    created,
  };
}

export async function loadPatronSession(rawPatronBarcode, options = {}) {
  assertFirebaseReady();

  const { includeDetails = true } = options;
  const patronBarcode = requireBarcode(rawPatronBarcode, "Patron barcode");
  if (options.guestUid) {
    await setGuestSessionPatron({
      guestUid: options.guestUid,
      patronBarcode,
    });
  }

  const ensureResult = await ensurePatron(patronBarcode, {
    name: options.patronName,
    email: options.patronEmail,
  });

  const patronRef = doc(db, "patrons", patronBarcode);
  const patronSnapshot = await getDoc(patronRef);
  let activeLoans = [];
  let activeHolds = [];
  let recentLoans = [];

  if (includeDetails) {
    const loansQuery = query(
      collection(db, "loans"),
      where("patronBarcode", "==", patronBarcode),
      where("status", "==", LOAN_STATUS.active),
      orderBy("checkedOutAt", "desc")
    );
    const holdsQuery = query(
      collection(db, "holds"),
      where("patronBarcode", "==", patronBarcode),
      where("status", "==", HOLD_STATUS.queued),
      orderBy("createdAt", "asc")
    );

    const recentLoansQuery = query(
      collection(db, "loans"),
      where("patronBarcode", "==", patronBarcode),
      orderBy("checkedOutAt", "desc"),
      limit(5)
    );

    const [loanSnapshot, holdSnapshot, recentSnapshot] = await Promise.all([
      getDocs(loansQuery),
      getDocs(holdsQuery),
      getDocs(recentLoansQuery),
    ]);

    activeLoans = loanSnapshot.docs.map(mapSnapshot);
    activeHolds = holdSnapshot.docs.map(mapSnapshot);
    recentLoans = recentSnapshot.docs.map(mapSnapshot);

    const titleMap = await getBookTitles(
      activeLoans
        .map((loan) => loan.bookBarcode)
        .concat(activeHolds.map((hold) => hold.bookBarcode))
        .concat(recentLoans.map((loan) => loan.bookBarcode))
    );

    activeLoans.sort((left, right) =>
      compareByTimestampDescending(left, right, "checkedOutAt")
    );
    activeHolds.sort((left, right) => {
      const positionDifference = (left.position || 0) - (right.position || 0);
      return positionDifference || compareByTimestampAscending(left, right, "createdAt");
    });

    activeLoans = activeLoans.map((loan) => ({
      ...loan,
      bookTitle: titleMap.get(loan.bookBarcode) || "Unknown title",
    }));
    activeHolds = activeHolds.map((hold) => ({
      ...hold,
      bookTitle: titleMap.get(hold.bookBarcode) || "Unknown title",
    }));
    recentLoans = recentLoans.map((loan) => ({
      ...loan,
      bookTitle: titleMap.get(loan.bookBarcode) || "Unknown title",
    }));
  }

  const patronData = patronSnapshot.data() || {};
  const needsProfile = !patronData.name || !patronData.email;

  return {
    patron: {
      barcode: patronBarcode,
      ...patronData,
    },
    createdOnLoad: ensureResult.created,
    detailsLimited: !includeDetails,
    needsProfile,
    activeLoans,
    activeHolds,
    recentLoans: includeDetails ? recentLoans : [],
  };
}

export async function updatePatronProfile({ patronBarcode, name, email }) {
  assertFirebaseReady();

  const barcode = requireBarcode(patronBarcode, "Patron barcode");
  const cleanName = requireName(name);
  const cleanEmail = requireEmail(email);
  const patronRef = doc(db, "patrons", barcode);

  await runTransaction(db, async (transaction) => {
    const patronSnapshot = await transaction.get(patronRef);

    if (!patronSnapshot.exists()) {
      throw new Error(`Patron ${barcode} does not exist.`);
    }

    transaction.set(
      patronRef,
      {
        name: cleanName,
        email: cleanEmail,
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {
    barcode,
    name: cleanName,
    email: cleanEmail,
  };
}

export async function setGuestSessionPatron({ guestUid, patronBarcode }) {
  assertFirebaseReady();

  if (!String(guestUid || "").trim()) {
    throw new Error("Guest session is required.");
  }

  const barcode = requireBarcode(patronBarcode, "Patron barcode");
  const sessionRef = doc(db, "guestSessions", guestUid);

  await setDoc(
    sessionRef,
    {
      patronBarcode: barcode,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function clearGuestSessionPatron({ guestUid }) {
  assertFirebaseReady();

  if (!String(guestUid || "").trim()) {
    throw new Error("Guest session is required.");
  }

  const sessionRef = doc(db, "guestSessions", guestUid);
  await deleteDoc(sessionRef);
}

export async function getPatronNameMap(barcodes) {
  assertFirebaseReady();

  const uniqueBarcodes = [...new Set(barcodes)].filter(Boolean);
  const nameMap = new Map();

  await Promise.all(
    uniqueBarcodes.map(async (barcode) => {
      const snapshot = await getDoc(doc(db, "patrons", barcode));
      const data = snapshot.exists() ? snapshot.data() : null;
      nameMap.set(barcode, data?.name || "");
    })
  );

  return nameMap;
}
