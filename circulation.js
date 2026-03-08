import {
  assertFirebaseReady,
  db,
  doc,
  runTransaction,
  serverTimestamp,
} from "./firebase-init.js";
import {
  BOOK_STATUS,
  HOLD_STATUS,
  LOAN_STATUS,
  makeHoldId,
  makeLoanId,
  requireBarcode,
} from "./shared.js";

function getBookQueue(bookData) {
  return Array.isArray(bookData?.holdQueue) ? bookData.holdQueue : [];
}

function writePatronCounters(
  transaction,
  patronRef,
  patronSnapshot,
  patronBarcode,
  { loanDelta = 0, holdDelta = 0 }
) {
  const existingData = patronSnapshot.exists() ? patronSnapshot.data() : null;
  const nextLoanCount = Math.max(0, Number(existingData?.activeLoanCount || 0) + loanDelta);
  const nextHoldCount = Math.max(0, Number(existingData?.activeHoldCount || 0) + holdDelta);

  transaction.set(
    patronRef,
    {
      barcode: patronBarcode,
      status: "active",
      createdAt: existingData?.createdAt || serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      activeLoanCount: nextLoanCount,
      activeHoldCount: nextHoldCount,
    },
    { merge: true }
  );
}

export async function checkoutOrPlaceHold({
  patronBarcode: rawPatronBarcode,
  bookBarcode: rawBookBarcode,
  adminUid,
}) {
  assertFirebaseReady();

  const patronBarcode = requireBarcode(rawPatronBarcode, "Patron barcode");
  const bookBarcode = requireBarcode(rawBookBarcode, "Book barcode");

  if (!String(adminUid ?? "").trim()) {
    throw new Error("Admin user is required for circulation actions.");
  }

  const loanId = makeLoanId(bookBarcode);

  return runTransaction(db, async (transaction) => {
    const patronRef = doc(db, "patrons", patronBarcode);
    const bookRef = doc(db, "books", bookBarcode);

    const [patronSnapshot, bookSnapshot] = await Promise.all([
      transaction.get(patronRef),
      transaction.get(bookRef),
    ]);

    if (!bookSnapshot.exists()) {
      throw new Error(`Book barcode ${bookBarcode} was not found in inventory.`);
    }

    const bookData = bookSnapshot.data();

    if (bookData.status === BOOK_STATUS.available) {
      const loanRef = doc(db, "loans", loanId);

      transaction.set(loanRef, {
        bookBarcode,
        patronBarcode,
        status: LOAN_STATUS.active,
        checkedOutAt: serverTimestamp(),
        returnedAt: null,
        createdByUid: adminUid,
        closedByUid: null,
      });

      transaction.set(
        bookRef,
        {
          status: BOOK_STATUS.checkedOut,
          currentLoanId: loanId,
          currentPatronBarcode: patronBarcode,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      writePatronCounters(transaction, patronRef, patronSnapshot, patronBarcode, {
        loanDelta: 1,
      });

      return {
        action: "checkout",
        status: "success",
        message: `Checked out "${bookData.title}" to patron ${patronBarcode}.`,
      };
    }

    const currentPatronBarcode = bookData.currentPatronBarcode || null;

    if (currentPatronBarcode === patronBarcode) {
      return {
        action: "noop",
        status: "info",
        message: `"${bookData.title}" is already checked out to patron ${patronBarcode}.`,
      };
    }

    const holdQueue = getBookQueue(bookData);
    const alreadyQueued = holdQueue.some(
      (entry) => entry.patronBarcode === patronBarcode
    );

    if (alreadyQueued) {
      return {
        action: "noop",
        status: "info",
        message: `Patron ${patronBarcode} already has an active hold on "${bookData.title}".`,
      };
    }

    const nextPosition = Number(bookData.lastHoldPosition || 0) + 1;
    const holdId = makeHoldId(bookBarcode, nextPosition);
    const holdRef = doc(db, "holds", holdId);
    const nextQueue = holdQueue.concat({
      holdId,
      patronBarcode,
      position: nextPosition,
    });

    transaction.set(holdRef, {
      bookBarcode,
      patronBarcode,
      status: HOLD_STATUS.queued,
      createdAt: serverTimestamp(),
      fulfilledAt: null,
      position: nextPosition,
    });

    transaction.set(
      bookRef,
      {
        holdCount: nextQueue.length,
        holdQueue: nextQueue,
        lastHoldPosition: nextPosition,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    writePatronCounters(transaction, patronRef, patronSnapshot, patronBarcode, {
      holdDelta: 1,
    });

    return {
      action: "hold",
      status: "success",
      message: `Queued hold #${nextPosition} for patron ${patronBarcode} on "${bookData.title}".`,
    };
  });
}

export async function returnBook({ bookBarcode: rawBookBarcode, adminUid }) {
  assertFirebaseReady();

  const bookBarcode = requireBarcode(rawBookBarcode, "Book barcode");

  if (!String(adminUid ?? "").trim()) {
    throw new Error("Admin user is required for circulation actions.");
  }

  const newLoanId = makeLoanId(bookBarcode);

  return runTransaction(db, async (transaction) => {
    const bookRef = doc(db, "books", bookBarcode);
    const bookSnapshot = await transaction.get(bookRef);

    if (!bookSnapshot.exists()) {
      throw new Error(`Book barcode ${bookBarcode} was not found in inventory.`);
    }

    const bookData = bookSnapshot.data();

    if (bookData.status !== BOOK_STATUS.checkedOut || !bookData.currentLoanId) {
      return {
        action: "noop",
        status: "info",
        message: `"${bookData.title}" is already marked available.`,
      };
    }

    const currentLoanRef = doc(db, "loans", bookData.currentLoanId);
    const currentLoanSnapshot = await transaction.get(currentLoanRef);

    if (!currentLoanSnapshot.exists()) {
      throw new Error(`Active loan ${bookData.currentLoanId} is missing for ${bookBarcode}.`);
    }

    const currentLoanData = currentLoanSnapshot.data();
    const currentPatronBarcode =
      currentLoanData.patronBarcode || bookData.currentPatronBarcode;
    const currentPatronRef = doc(db, "patrons", currentPatronBarcode);
    const currentPatronSnapshot = await transaction.get(currentPatronRef);

    transaction.set(
      currentLoanRef,
      {
        status: LOAN_STATUS.returned,
        returnedAt: serverTimestamp(),
        closedByUid: adminUid,
      },
      { merge: true }
    );

    writePatronCounters(
      transaction,
      currentPatronRef,
      currentPatronSnapshot,
      currentPatronBarcode,
      { loanDelta: -1 }
    );

    const holdQueue = getBookQueue(bookData);

    if (holdQueue.length === 0) {
      transaction.set(
        bookRef,
        {
          status: BOOK_STATUS.available,
          currentLoanId: null,
          currentPatronBarcode: null,
          holdCount: 0,
          holdQueue: [],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return {
        action: "return",
        status: "success",
        message: `Returned "${bookData.title}". The book is now available.`,
      };
    }

    const [nextHold, ...remainingQueue] = holdQueue;
    const nextHoldRef = doc(db, "holds", nextHold.holdId);
    const nextLoanRef = doc(db, "loans", newLoanId);
    const nextPatronRef = doc(db, "patrons", nextHold.patronBarcode);

    const [nextHoldSnapshot, nextPatronSnapshot] = await Promise.all([
      transaction.get(nextHoldRef),
      transaction.get(nextPatronRef),
    ]);

    if (!nextHoldSnapshot.exists()) {
      throw new Error(`Queued hold ${nextHold.holdId} is missing for ${bookBarcode}.`);
    }

    const nextHoldData = nextHoldSnapshot.data();

    if (nextHoldData.status !== HOLD_STATUS.queued) {
      throw new Error(`Hold ${nextHold.holdId} is not queued and cannot be fulfilled.`);
    }

    transaction.set(
      nextHoldRef,
      {
        status: HOLD_STATUS.fulfilledAutoCheckout,
        fulfilledAt: serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(nextLoanRef, {
      bookBarcode,
      patronBarcode: nextHold.patronBarcode,
      status: LOAN_STATUS.active,
      checkedOutAt: serverTimestamp(),
      returnedAt: null,
      createdByUid: adminUid,
      closedByUid: null,
    });

    transaction.set(
      bookRef,
      {
        status: BOOK_STATUS.checkedOut,
        currentLoanId: newLoanId,
        currentPatronBarcode: nextHold.patronBarcode,
        holdCount: remainingQueue.length,
        holdQueue: remainingQueue,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    writePatronCounters(
      transaction,
      nextPatronRef,
      nextPatronSnapshot,
      nextHold.patronBarcode,
      { loanDelta: 1, holdDelta: -1 }
    );

    return {
      action: "return_auto_checkout",
      status: "success",
      message: `Returned "${bookData.title}" from patron ${currentPatronBarcode} and auto-checked it out to patron ${nextHold.patronBarcode}.`,
    };
  });
}
