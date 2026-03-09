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
  where,
} from "./firebase-init.js";
import {
  HOLD_STATUS,
  LOAN_STATUS,
  compareByTimestampAscending,
  compareByTimestampDescending,
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

export async function ensurePatron(rawPatronBarcode) {
  assertFirebaseReady();

  const patronBarcode = requireBarcode(rawPatronBarcode, "Patron barcode");
  let created = false;

  await runTransaction(db, async (transaction) => {
    const patronRef = doc(db, "patrons", patronBarcode);
    const patronSnapshot = await transaction.get(patronRef);

    if (patronSnapshot.exists()) {
      created = false;
      transaction.set(
        patronRef,
        {
          barcode: patronBarcode,
          lastSeenAt: serverTimestamp(),
          status: "active",
        },
        { merge: true }
      );
      return;
    }

    created = true;
    transaction.set(patronRef, {
      barcode: patronBarcode,
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
  const ensureResult = await ensurePatron(patronBarcode);

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

  return {
    patron: {
      barcode: patronBarcode,
      ...patronSnapshot.data(),
    },
    createdOnLoad: ensureResult.created,
    detailsLimited: !includeDetails,
    activeLoans,
    activeHolds,
  };
}
