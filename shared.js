export const USER_ROLE = Object.freeze({
  admin: "admin",
});

export const ACCESS_MODE = Object.freeze({
  admin: "admin",
  guest: "guest",
});

export const BOOK_STATUS = Object.freeze({
  available: "available",
  checkedOut: "checked_out",
});

export const LOAN_STATUS = Object.freeze({
  active: "active",
  returned: "returned",
});

export const HOLD_STATUS = Object.freeze({
  queued: "queued",
  fulfilledAutoCheckout: "fulfilled_auto_checkout",
  cancelled: "cancelled",
});

export const LOAN_TERM_DAYS = 21;
export const DUE_WARNING_DAYS = 3;
export const GRACE_DAYS = 2;
export const FINE_CENTS = 800;

export const TAB = Object.freeze({
  inventory: "inventory",
  circulation: "circulation",
});

const BARCODE_PATTERN = /^\d{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export function normalizeBarcodeInput(rawValue) {
  return String(rawValue ?? "").trim().replace(/\s+/g, "");
}

export function requireBarcode(rawValue, label = "Barcode") {
  const barcode = normalizeBarcodeInput(rawValue);

  if (!BARCODE_PATTERN.test(barcode)) {
    throw new Error(`${label} must be exactly 12 digits.`);
  }

  return barcode;
}

export function normalizeTitle(rawValue) {
  return String(rawValue ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeEmail(rawValue) {
  return String(rawValue ?? "").trim().toLowerCase();
}

export function requireName(rawValue) {
  const name = normalizeTitle(rawValue);

  if (!name) {
    throw new Error("Name is required.");
  }

  return name;
}

export function requireEmail(rawValue) {
  const email = normalizeEmail(rawValue);

  if (!email) {
    throw new Error("Email is required.");
  }

  if (!email.includes("@") || !email.includes(".")) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

export function requireTitle(rawValue) {
  const title = normalizeTitle(rawValue);

  if (!title) {
    throw new Error("Title is required.");
  }

  return title;
}

export function toNormalizedTitle(title) {
  return requireTitle(title).toLocaleLowerCase();
}

export function normalizeSearchQuery(rawValue) {
  return String(rawValue ?? "").trim().toLocaleLowerCase();
}

export function formatTimestamp(value) {
  const date = toDate(value);
  return date ? timestampFormatter.format(date) : "—";
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "—";
}

export function formatCurrency(cents) {
  const amount = Number(cents || 0) / 100;
  return currencyFormatter.format(amount);
}

export function toDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
}

export function addDays(value, days) {
  const date = toDate(value) || new Date();
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(value) {
  const date = toDate(value);
  if (!date) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function diffInDays(target, base = new Date()) {
  const targetDay = startOfDay(target);
  const baseDay = startOfDay(base);
  if (!targetDay || !baseDay) {
    return 0;
  }
  return Math.round((targetDay.getTime() - baseDay.getTime()) / DAY_MS);
}

export function getLoanDueDate(loan, fallbackDate = new Date()) {
  const dueAt = toDate(loan?.dueAt);
  if (dueAt) {
    return dueAt;
  }

  const checkedOutAt = toDate(loan?.checkedOutAt) || fallbackDate;
  return addDays(checkedOutAt, LOAN_TERM_DAYS);
}

export function makeLoanId(bookBarcode) {
  const timeComponent = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).slice(2, 8);
  return `loan_${bookBarcode}_${timeComponent}_${randomComponent}`;
}

export function makeHoldId(bookBarcode, position) {
  return `hold_${bookBarcode}_${String(position).padStart(6, "0")}`;
}

export function getBookStatusLabel(status) {
  return status === BOOK_STATUS.checkedOut ? "Checked out" : "Available";
}

export function getErrorMessage(error, fallback = "Something went wrong.") {
  const code = error?.code;

  if (code) {
    const mapped = {
      "auth/invalid-email": "Enter a valid email address.",
      "auth/invalid-credential": "Invalid email or password.",
      "auth/operation-not-allowed":
        "Enable Anonymous sign-in in Firebase Authentication to use patron mode.",
      "auth/user-disabled": "This Firebase Auth account has been disabled.",
      "permission-denied":
        "This session is not allowed to perform that action.",
      aborted: "Another scan updated the same record. Run the action again.",
      unavailable: "Firebase is unavailable right now. Try again in a moment.",
    };

    if (mapped[code]) {
      return mapped[code];
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function setFeedbackMessage(element, kind, message) {
  element.hidden = !message;
  element.textContent = message || "";

  if (message) {
    element.dataset.kind = kind;
  } else {
    delete element.dataset.kind;
  }
}

export function compareByTimestampDescending(left, right, fieldName) {
  const leftDate = left?.[fieldName]?.toDate?.() ?? new Date(0);
  const rightDate = right?.[fieldName]?.toDate?.() ?? new Date(0);
  return rightDate - leftDate;
}

export function compareByTimestampAscending(left, right, fieldName) {
  const leftDate = left?.[fieldName]?.toDate?.() ?? new Date(0);
  const rightDate = right?.[fieldName]?.toDate?.() ?? new Date(0);
  return leftDate - rightDate;
}
