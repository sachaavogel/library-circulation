import {
  assertFirebaseReady,
  collection,
  db,
  doc,
  getDoc,
  getDocs,
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
  let created = false;

  await runTransaction(db, async (transaction) => {
    const patronRef = doc(db, "patrons", patronBarcode);
    const patronSnapshot = await transaction.get(patronRef);

    if (patronSnapshot.exists()) {
      const existingName = patronSnapshot.data().name || null;
      const shouldSetName = name && !existingName;
      created = false;
      transaction.set(
        patronRef,
        {
          barcode: patronBarcode,
          lastSeenAt: serverTimestamp(),
          status: "active",
          ...(shouldSetName ? { name } : {}),
        },
        { merge: true }
      );
      return;
    }

    created = true;
    transaction.set(patronRef, {
      barcode: patronBarcode,
      name: name || "",
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      activeLoanCount: 0,
      activeHoldCount: 0,
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
  const ensureResult = await ensurePatron(patronBarcode, {
    name: options.patronName,
  });

  if (options.guestUid) {
    await setGuestSessionPatron({
      guestUid: options.guestUid,
      patronBarcode,
    });
  }

  const patronRef = doc(db, "patrons", patronBarcode);
  const patronSnapshot = await getDoc(patronRef);
  let activeLoans = [];
  let activeHolds = [];

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

    const [loanSnapshot, holdSnapshot] = await Promise.all([
      getDocs(loansQuery),
      getDocs(holdsQuery),
    ]);

    activeLoans = loanSnapshot.docs.map(mapSnapshot);
    activeHolds = holdSnapshot.docs.map(mapSnapshot);

    const titleMap = await getBookTitles(
      activeLoans
        .map((loan) => loan.bookBarcode)
        .concat(activeHolds.map((hold) => hold.bookBarcode))
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
  }

  const patronData = patronSnapshot.data() || {};

  return {
    patron: {
      barcode: patronBarcode,
      ...patronData,
    },
    createdOnLoad: ensureResult.created,
    detailsLimited: !includeDetails,
    needsName: !patronData.name,
    activeLoans,
    activeHolds,
  };
}

export async function updatePatronName({ patronBarcode, name }) {
  assertFirebaseReady();

  const barcode = requireBarcode(patronBarcode, "Patron barcode");
  const cleanName = requireName(name);
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
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {
    barcode,
    name: cleanName,
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
