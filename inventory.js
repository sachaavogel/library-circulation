import {
  assertFirebaseReady,
  collection,
  db,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "./firebase-init.js";
import {
  BOOK_STATUS,
  normalizeSearchQuery,
  requireBarcode,
  requireTitle,
  toNormalizedTitle,
} from "./shared.js";

let inventoryCache = [];

function mapBookSnapshot(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

function sortInventory(books) {
  return [...books].sort((left, right) =>
    String(left.normalizedTitle || left.title || "").localeCompare(
      String(right.normalizedTitle || right.title || "")
    )
  );
}

export function watchInventory(onChange, onError) {
  assertFirebaseReady();

  const inventoryQuery = query(collection(db, "books"), orderBy("normalizedTitle"));

  return onSnapshot(
    inventoryQuery,
    (snapshot) => {
      inventoryCache = sortInventory(snapshot.docs.map(mapBookSnapshot));
      onChange(inventoryCache);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function searchInventory(rawQuery) {
  const search = normalizeSearchQuery(rawQuery);

  if (!search) {
    return inventoryCache;
  }

  return inventoryCache.filter((book) => {
    const title = String(book.normalizedTitle || "").toLocaleLowerCase();
    return book.barcode.includes(search) || title.includes(search);
  });
}

export function getInventoryStats(books = inventoryCache) {
  const total = books.length;
  let available = 0;
  let checkedOut = 0;
  let onHold = 0;

  books.forEach((book) => {
    if (book.status === BOOK_STATUS.checkedOut) {
      checkedOut += 1;
    } else {
      available += 1;
    }

    if (Number(book.holdCount || 0) > 0) {
      onHold += 1;
    }
  });

  return {
    total,
    available,
    checkedOut,
    onHold,
  };
}

export async function addBook({ barcode, title }) {
  assertFirebaseReady();

  const normalizedBarcode = requireBarcode(barcode, "Book barcode");
  const cleanTitle = requireTitle(title);
  const normalizedTitle = toNormalizedTitle(cleanTitle);

  await runTransaction(db, async (transaction) => {
    const bookRef = doc(db, "books", normalizedBarcode);
    const bookSnapshot = await transaction.get(bookRef);

    if (bookSnapshot.exists()) {
      throw new Error(`Book barcode ${normalizedBarcode} already exists.`);
    }

      transaction.set(bookRef, {
        barcode: normalizedBarcode,
        title: cleanTitle,
        normalizedTitle,
        status: BOOK_STATUS.available,
        currentLoanId: null,
        currentPatronBarcode: null,
        currentDueAt: null,
        holdCount: 0,
        holdQueue: [],
        lastHoldPosition: 0,
        createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const bookRecord = {
    barcode: normalizedBarcode,
    title: cleanTitle,
    normalizedTitle,
    status: BOOK_STATUS.available,
    currentLoanId: null,
    currentPatronBarcode: null,
    currentDueAt: null,
    holdCount: 0,
  };

  inventoryCache = sortInventory(
    inventoryCache.filter((book) => book.barcode !== normalizedBarcode).concat(bookRecord)
  );

  return bookRecord;
}

export async function updateBook({ originalBarcode, barcode, title }) {
  assertFirebaseReady();

  const existingBarcode = requireBarcode(originalBarcode, "Original barcode");
  const nextBarcode = requireBarcode(barcode, "Book barcode");
  const cleanTitle = requireTitle(title);
  const normalizedTitle = toNormalizedTitle(cleanTitle);
  const barcodeChanged = existingBarcode !== nextBarcode;

  await runTransaction(db, async (transaction) => {
    const bookRef = doc(db, "books", existingBarcode);
    const bookSnapshot = await transaction.get(bookRef);

    if (!bookSnapshot.exists()) {
      throw new Error(`Book barcode ${existingBarcode} was not found.`);
    }

    const bookData = bookSnapshot.data();

    if (barcodeChanged) {
      const nextRef = doc(db, "books", nextBarcode);
      const nextSnapshot = await transaction.get(nextRef);

      if (nextSnapshot.exists()) {
        throw new Error(`Book barcode ${nextBarcode} already exists.`);
      }

      const holdQueue = Array.isArray(bookData.holdQueue) ? bookData.holdQueue : [];

      if (
        bookData.status === BOOK_STATUS.checkedOut ||
        bookData.currentLoanId ||
        Number(bookData.holdCount || 0) > 0 ||
        holdQueue.length > 0
      ) {
        throw new Error(
          "Cannot change the barcode while the book is checked out or has holds."
        );
      }

      transaction.set(nextRef, {
        ...bookData,
        barcode: nextBarcode,
        title: cleanTitle,
        normalizedTitle,
        updatedAt: serverTimestamp(),
      });
      transaction.delete(bookRef);
    } else {
      transaction.set(
        bookRef,
        {
          title: cleanTitle,
          normalizedTitle,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  const existing = inventoryCache.find((book) => book.barcode === existingBarcode);
  const nextRecord = {
    ...(existing || {}),
    barcode: nextBarcode,
    title: cleanTitle,
    normalizedTitle,
  };

  inventoryCache = sortInventory(
    inventoryCache
      .filter((book) => book.barcode !== existingBarcode && book.barcode !== nextBarcode)
      .concat(nextRecord)
  );

  return nextRecord;
}

export async function removeBook({ barcode }) {
  assertFirebaseReady();

  const normalizedBarcode = requireBarcode(barcode, "Book barcode");

  await runTransaction(db, async (transaction) => {
    const bookRef = doc(db, "books", normalizedBarcode);
    const bookSnapshot = await transaction.get(bookRef);

    if (!bookSnapshot.exists()) {
      throw new Error(`Book barcode ${normalizedBarcode} was not found.`);
    }

    const bookData = bookSnapshot.data();
    const holdQueue = Array.isArray(bookData.holdQueue) ? bookData.holdQueue : [];

    if (
      bookData.status === BOOK_STATUS.checkedOut ||
      bookData.currentLoanId ||
      Number(bookData.holdCount || 0) > 0 ||
      holdQueue.length > 0
    ) {
      throw new Error(
        "Cannot remove a book that is checked out or has active holds."
      );
    }

    transaction.delete(bookRef);
  });

  inventoryCache = inventoryCache.filter((book) => book.barcode !== normalizedBarcode);
}
