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
    holdCount: 0,
  };

  inventoryCache = sortInventory(
    inventoryCache.filter((book) => book.barcode !== normalizedBarcode).concat(bookRecord)
  );

  return bookRecord;
}
