import {
  signInAdmin,
  signInGuest,
  signOutSession,
  watchLibrarySession,
} from "./auth.js";
import { checkoutOrPlaceHold, returnBook } from "./circulation.js";
import {
  collection,
  db,
  doc,
  firebaseConfigReady,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "./firebase-init.js";
import {
  addBook,
  getInventoryStats,
  removeBook,
  searchInventory,
  updateBook,
  watchInventory,
} from "./inventory.js";
import { createCirculationView } from "./circulation-view.js";
import { createInventoryView } from "./inventory-view.js";
import { createLoginView } from "./login-view.js";
import {
  clearGuestSessionPatron,
  getPatronNameMap,
  loadPatronSession,
  updatePatronProfile,
} from "./patrons.js";
import { sendPatronReceipt } from "./notifications.js";
import {
  ACCESS_MODE,
  DUE_WARNING_DAYS,
  FINE_CENTS,
  GRACE_DAYS,
  LOAN_STATUS,
  TAB,
  diffInDays,
  formatDate,
  getErrorMessage,
  getLoanDueDate,
} from "./shared.js";

const sessionLabel = document.getElementById("session-label");
const sessionDetail = document.getElementById("session-detail");
const setupNotice = document.getElementById("setup-notice");
const appShell = document.getElementById("app-shell");
const adminEmail = document.getElementById("admin-email");
const signOutButton = document.getElementById("sign-out-button");
const inventorySection = document.getElementById("inventory-section");
const circulationSection = document.getElementById("circulation-section");
const inventoryTabButton = document.getElementById("tab-inventory");
const circulationTabButton = document.getElementById("tab-circulation");

const state = {
  session: null,
  activeTab: TAB.inventory,
  activePatronBarcode: null,
  activeSession: null,
  inventoryUnsubscribe: null,
  circulationInventoryQuery: "",
  patronNameCache: new Map(),
  profileRequired: false,
};

const DUE_PROCESSING_STORAGE_KEY = "library_due_processing_date";
let dueProcessingTimer = null;

const loginView = createLoginView({
  onSubmit: handleLogin,
  onGuestSubmit: handleGuestEntry,
});

const inventoryView = createInventoryView({
  onAddBook: handleAddBook,
  onSearch: handleInventorySearch,
  onUpdateBook: handleUpdateBook,
  onRemoveBook: handleRemoveBook,
});

const circulationView = createCirculationView({
  onLoadPatron: handleLoadPatron,
  onCheckout: handleCheckout,
  onReturn: handleReturn,
  onSaveProfile: handleSavePatronProfile,
  onSendReceipt: handleSendPatronReceipt,
  onEndPatron: handleEndPatron,
  onHomeSearch: handleCirculationInventorySearch,
});

inventoryTabButton.addEventListener("click", () => selectTab(TAB.inventory));
circulationTabButton.addEventListener("click", () => selectTab(TAB.circulation));
signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;

  try {
    await signOutSession();
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to sign out."));
  } finally {
    signOutButton.disabled = false;
  }
});

circulationView.clearPatronSession();

if (!firebaseConfigReady) {
  sessionLabel.textContent = "Setup required";
  sessionDetail.textContent = "Update the Firebase config block in index.html.";
  setupNotice.hidden = false;
  loginView.disableForSetup(
    "Firebase config is incomplete. Update index.html before trying to sign in."
  );
} else {
  sessionLabel.textContent = "Signed out";
  sessionDetail.textContent = "Sign in as admin or continue as patron.";
  loginView.focus();

  watchLibrarySession(handleAuthChange, (error) => {
    loginView.setMessage("error", getErrorMessage(error));
  });
}

function isAdminSession() {
  return state.session?.access === ACCESS_MODE.admin;
}

function hasCirculationAccess() {
  return Boolean(state.session);
}

function syncAccessModeUi() {
  const adminSession = isAdminSession();

  inventoryTabButton.hidden = !adminSession;
  circulationView.setReturnVisible(true);

  if (!adminSession && state.inventoryUnsubscribe) {
    state.inventoryUnsubscribe();
    state.inventoryUnsubscribe = null;
  }

  if (!adminSession) {
    inventorySection.hidden = true;
  }
}

function selectTab(tabName) {
  if (tabName === TAB.inventory && !isAdminSession()) {
    tabName = TAB.circulation;
  }

  state.activeTab = tabName;

  const inventoryActive = tabName === TAB.inventory;

  inventorySection.hidden = !isAdminSession() || !inventoryActive;
  circulationSection.hidden = inventoryActive;

  inventoryTabButton.classList.toggle("tab-button--active", inventoryActive);
  inventoryTabButton.setAttribute("aria-selected", String(inventoryActive));

  circulationTabButton.classList.toggle("tab-button--active", !inventoryActive);
  circulationTabButton.setAttribute("aria-selected", String(!inventoryActive));
}

function handleAuthChange(admin) {
  state.session = admin;
  state.activePatronBarcode = null;
  state.profileRequired = false;
  state.activeSession = null;
  state.patronNameCache = new Map();
  circulationView.clearPatronSession();
  circulationView.clearBanner();
  circulationView.setHomeVisible(true);

  if (admin) {
    loginView.hide();
    loginView.resetPassword();
    appShell.hidden = false;
    adminEmail.textContent =
      admin.access === ACCESS_MODE.guest ? "Patron mode" : admin.email || admin.uid;
    sessionLabel.textContent =
      admin.access === ACCESS_MODE.guest ? "Patron session" : "Admin authenticated";
    sessionDetail.textContent =
      admin.access === ACCESS_MODE.guest
        ? "Patron circulation enabled. Inventory changes require admin sign-in."
        : `Role: ${admin.role}`;
    signOutButton.textContent =
      admin.access === ACCESS_MODE.guest ? "Exit patron" : "Sign out";
    circulationView.setGuestMode(admin.access === ACCESS_MODE.guest);
    syncAccessModeUi();
    scheduleDueProcessing();

    if (isAdminSession()) {
      beginInventoryWatch();
      selectTab(state.activeTab);
    } else {
      inventoryView.setMessage("", "");
      selectTab(TAB.circulation);
    }

    return;
  }

  adminEmail.textContent = "admin";
  sessionLabel.textContent = "Signed out";
  sessionDetail.textContent = "Sign in as admin or continue as patron.";
  signOutButton.textContent = "Sign out";
  appShell.hidden = true;
  loginView.show();
  loginView.focus();
  circulationView.setGuestMode(false);
  inventoryView.setMessage("", "");
  circulationView.setReturnVisible(true);
  inventoryTabButton.hidden = false;
  stopDueProcessing();

  if (state.inventoryUnsubscribe) {
    state.inventoryUnsubscribe();
    state.inventoryUnsubscribe = null;
  }
}

function scheduleDueProcessing() {
  stopDueProcessing();

  if (!isAdminSession()) {
    return;
  }

  runDueProcessing();
  dueProcessingTimer = window.setInterval(runDueProcessing, 4 * 60 * 60 * 1000);
}

function stopDueProcessing() {
  if (dueProcessingTimer) {
    window.clearInterval(dueProcessingTimer);
    dueProcessingTimer = null;
  }
}

async function runDueProcessing() {
  if (!isAdminSession()) {
    return;
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(DUE_PROCESSING_STORAGE_KEY) === todayKey) {
    return;
  }

  try {
    await processDueActions();
    localStorage.setItem(DUE_PROCESSING_STORAGE_KEY, todayKey);
  } catch (error) {
    console.warn("Due processing failed.", error);
  }
}

async function processDueActions() {
  const loansQuery = query(
    collection(db, "loans"),
    where("status", "==", LOAN_STATUS.active),
    orderBy("checkedOutAt", "desc")
  );
  const snapshot = await getDocs(loansQuery);
  const now = new Date();

  const dueSoonByPatron = new Map();
  const dueTodayByPatron = new Map();
  const updates = [];

  snapshot.forEach((docSnap) => {
    const loan = docSnap.data();
    const dueDate = getLoanDueDate(loan, now);
    const daysUntilDue = diffInDays(dueDate, now);
    const daysPastDue = -daysUntilDue;

    if (!loan.dueAt && loan.checkedOutAt) {
      updates.push(updateDoc(docSnap.ref, { dueAt: dueDate }));
      if (loan.bookBarcode) {
        updates.push(
          updateDoc(doc(db, "books", loan.bookBarcode), { currentDueAt: dueDate })
        );
      }
    }

    if (daysUntilDue === DUE_WARNING_DAYS && !loan.notice3SentAt) {
      queueDueNotice(dueSoonByPatron, docSnap.ref, loan);
    }

    if (daysUntilDue === 0 && !loan.noticeDaySentAt) {
      queueDueNotice(dueTodayByPatron, docSnap.ref, loan);
    }

    if (daysPastDue >= GRACE_DAYS && !loan.fineAppliedAt) {
      updates.push(
        updateDoc(docSnap.ref, {
          fineCents: FINE_CENTS,
          fineAppliedAt: serverTimestamp(),
        })
      );
      if (loan.patronBarcode) {
        updates.push(
          updateDoc(doc(db, "patrons", loan.patronBarcode), {
            fineCents: increment(FINE_CENTS),
          })
        );
      }
    }
  });

  if (updates.length) {
    await Promise.all(updates);
  }

  await sendDueNoticeEmails(dueTodayByPatron, {
    headline: "Your items are due today.",
    subject: "Your library items are due today",
    highlightLabel: "Due today:",
    noticeField: "noticeDaySentAt",
  });

  await sendDueNoticeEmails(dueSoonByPatron, {
    headline: `Your items are due in ${DUE_WARNING_DAYS} days.`,
    subject: `Your library items are due in ${DUE_WARNING_DAYS} days`,
    highlightLabel: "Due soon:",
    noticeField: "notice3SentAt",
  });
}

function queueDueNotice(map, loanRef, loan) {
  if (!loan?.patronBarcode) {
    return;
  }

  const entries = map.get(loan.patronBarcode) || [];
  entries.push({ ref: loanRef, loan });
  map.set(loan.patronBarcode, entries);
}

async function sendDueNoticeEmails(map, options) {
  const { headline, subject, highlightLabel, noticeField } = options;

  for (const [patronBarcode, entries] of map.entries()) {
    try {
      const session = await loadPatronSession(patronBarcode, { includeDetails: true });
      if (!session?.patron?.email) {
        continue;
      }

      const highlightEntry = entries[0]?.loan;
      const highlightLoan =
        highlightEntry &&
        session.activeLoans.find(
          (loan) => loan.bookBarcode === highlightEntry.bookBarcode
        );

      await sendPatronReceipt({
        patron: session.patron,
        loans: session.activeLoans,
        holds: session.activeHolds,
        subject,
        headline,
        highlightLoanTitle: highlightLoan?.bookTitle,
        highlightLoanLabel: highlightLabel,
      });

      await Promise.all(
        entries.map((entry) =>
          updateDoc(entry.ref, { [noticeField]: serverTimestamp() })
        )
      );
    } catch (error) {
      console.warn("Unable to send due notice email.", error);
    }
  }
}

async function beginInventoryWatch() {
  if (state.inventoryUnsubscribe) {
    return;
  }

  state.inventoryUnsubscribe = watchInventory(
    () => {
      refreshInventoryViews();
    },
    (error) => {
      inventoryView.setMessage("error", getErrorMessage(error, "Unable to load inventory."));
    }
  );
}

function handleInventorySearch(query) {
  const results = searchInventory(query);
  inventoryView.renderBooks(results, state.patronNameCache);
  if (isAdminSession()) {
    hydratePatronNames(results);
  }
}

function handleCirculationInventorySearch(query) {
  if (!isAdminSession()) {
    return;
  }
  state.circulationInventoryQuery = query;
  refreshInventoryViews();
}

function refreshInventoryViews() {
  const inventoryResults = searchInventory(inventoryView.getSearchQuery());
  inventoryView.renderBooks(inventoryResults, state.patronNameCache);

  const circulationResults = searchInventory(state.circulationInventoryQuery);
  if (isAdminSession()) {
    circulationView.renderInventory(
      circulationResults,
      getInventoryStats(),
      state.patronNameCache
    );
  }

  if (isAdminSession()) {
    hydratePatronNames(circulationResults.concat(inventoryResults));
  }
}

async function hydratePatronNames(books) {
  const barcodes = [
    ...new Set(books.map((book) => book.currentPatronBarcode).filter(Boolean)),
  ];
  const missing = barcodes.filter((barcode) => !state.patronNameCache.has(barcode));

  if (!missing.length) {
    return;
  }

  try {
    const nameMap = await getPatronNameMap(missing);
    nameMap.forEach((name, barcode) => {
      state.patronNameCache.set(barcode, name);
    });
    refreshInventoryViews();
  } catch {
    // Ignore patron-name hydration errors to keep inventory responsive.
  }
}

function applyActiveSession(session) {
  state.activeSession = session;
  state.activePatronBarcode = session.patron.barcode;
  state.profileRequired = session.needsProfile;
  circulationView.renderPatronSession(session);
}

async function handleLogin({ email, password }) {
  loginView.setPending(true);
  loginView.setMessage("", "");

  try {
    await signInAdmin(email, password);
  } catch (error) {
    loginView.setMessage("error", getErrorMessage(error, "Unable to sign in."));
  } finally {
    loginView.setPending(false);
  }
}

async function handleGuestEntry() {
  loginView.setPending(true);
  loginView.setMessage("", "");

  try {
    await signInGuest();
  } catch (error) {
    loginView.setMessage("error", getErrorMessage(error, "Unable to continue as patron."));
  } finally {
    loginView.setPending(false);
  }
}

async function handleAddBook(payload) {
  inventoryView.setPending(true);
  inventoryView.setMessage("", "");

  try {
    const book = await addBook(payload);
    inventoryView.setMessage("success", `Added "${book.title}" to inventory.`);
    inventoryView.clearForm();
    refreshInventoryViews();
  } catch (error) {
    inventoryView.setMessage("error", getErrorMessage(error, "Unable to add the book."));
  } finally {
    inventoryView.setPending(false);
  }
}

async function handleUpdateBook(payload) {
  inventoryView.setEditPending(true);
  inventoryView.setEditMessage("", "");

  try {
    const book = await updateBook(payload);
    inventoryView.setEditMessage("success", `Updated "${book.title}".`);
    inventoryView.clearEditForm();
    refreshInventoryViews();
  } catch (error) {
    inventoryView.setEditMessage(
      "error",
      getErrorMessage(error, "Unable to update the book.")
    );
  } finally {
    inventoryView.setEditPending(false);
  }
}

async function handleRemoveBook(payload) {
  inventoryView.setEditMessage("", "");

  try {
    await removeBook(payload);
    inventoryView.setMessage("success", "Removed book from inventory.");
    inventoryView.clearEditForm();
    refreshInventoryViews();
  } catch (error) {
    inventoryView.setMessage("error", getErrorMessage(error, "Unable to remove the book."));
  }
}

async function handleLoadPatron(rawPatronBarcode) {
  circulationView.setPatronPending(true);
  circulationView.clearBanner();

  try {
    const session = await loadPatronSession(rawPatronBarcode, {
      includeDetails: true,
      guestUid: state.session?.access === ACCESS_MODE.guest ? state.session.uid : null,
    });
    applyActiveSession(session);
    circulationView.clearPatronInput();
    circulationView.focusCheckoutInput();
    circulationView.clearNameInput();

    const patronName = session.patron.name || "patron";
    circulationView.showBanner(
      "success",
      session.createdOnLoad
        ? `Created ${patronName} and opened the session.`
        : `Loaded ${patronName}.`
    );
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to load patron."));
  } finally {
    circulationView.setPatronPending(false);
  }
}

async function handleSavePatronProfile({ name, email }) {
  if (!state.activePatronBarcode) {
    circulationView.showBanner("error", "Load a patron before saving a profile.");
    return;
  }

  circulationView.setProfilePending(true);
  circulationView.setProfileMessage("", "");
  circulationView.clearBanner();

  try {
    await updatePatronProfile({
      patronBarcode: state.activePatronBarcode,
      name,
      email,
    });

    state.patronNameCache.set(state.activePatronBarcode, name);

    const session = await loadPatronSession(state.activePatronBarcode, {
      includeDetails: true,
      guestUid: state.session?.access === ACCESS_MODE.guest ? state.session.uid : null,
    });

    state.profileRequired = false;
    applyActiveSession(session);
    circulationView.clearNameInput();
    circulationView.closeProfileModal();
    circulationView.showBanner("success", "Saved patron profile.");
  } catch (error) {
    circulationView.setProfileMessage(
      "error",
      getErrorMessage(error, "Unable to save the patron profile.")
    );
  } finally {
    circulationView.setProfilePending(false);
  }
}

async function refreshActivePatronSession() {
  if (!state.activePatronBarcode) {
    return;
  }

  try {
    const session = await loadPatronSession(state.activePatronBarcode, {
      includeDetails: true,
      guestUid: state.session?.access === ACCESS_MODE.guest ? state.session.uid : null,
    });
    applyActiveSession(session);
    return session;
  } catch (error) {
    circulationView.showBanner(
      "error",
      getErrorMessage(error, "Unable to refresh the patron session.")
    );
  }

  return null;
}

async function handleEndPatron() {
  if (!state.activePatronBarcode) {
    return;
  }

  if (state.session?.access === ACCESS_MODE.guest) {
    try {
      await clearGuestSessionPatron({ guestUid: state.session.uid });
    } catch (error) {
      circulationView.showBanner(
        "error",
        getErrorMessage(error, "Unable to clear the patron session.")
      );
      return;
    }
  }

  state.activePatronBarcode = null;
  state.profileRequired = false;
  state.activeSession = null;
  circulationView.clearPatronSession();
  circulationView.showBanner("info", "Patron session ended.");
  circulationView.focusPatronInput();
}

async function handleCheckout(rawBookBarcode) {
  if (!hasCirculationAccess()) {
    circulationView.showBanner(
      "error",
      "Sign in or continue as patron before processing circulation."
    );
    return;
  }

  if (!state.activePatronBarcode) {
    circulationView.showBanner("error", "Load a patron session before checking out books.");
    return;
  }

  if (state.profileRequired) {
    circulationView.showBanner("error", "Complete the patron profile before checkout.");
    return;
  }

  circulationView.setCheckoutPending(true);

  try {
    const result = await checkoutOrPlaceHold({
      patronBarcode: state.activePatronBarcode,
      bookBarcode: rawBookBarcode,
      actorUid: state.session.uid,
    });

    circulationView.showBanner(result.status, result.message);
    circulationView.clearCheckoutInput();
    await refreshActivePatronSession();
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to process checkout."));
  } finally {
    circulationView.setCheckoutPending(false);
    circulationView.setCheckoutEnabled(
      Boolean(state.session && state.activePatronBarcode && !state.profileRequired)
    );
  }
}

async function handleSendPatronReceipt() {
  if (!state.activePatronBarcode) {
    circulationView.showBanner("error", "Load a patron session before emailing.");
    return;
  }

  const session = (await refreshActivePatronSession()) || state.activeSession;

  if (!session) {
    return;
  }

  if (!session.patron.email) {
    circulationView.showBanner("error", "Add an email address before sending.");
    circulationView.openProfileModal({
      required: false,
      name: session.patron.name,
      email: session.patron.email,
    });
    return;
  }

  circulationView.setReceiptPending(true);
  circulationView.clearBanner();

  try {
    await sendPatronReceipt({
      patron: session.patron,
      loans: session.activeLoans,
      holds: session.activeHolds,
    });
    circulationView.showBanner("success", "Email sent.");
  } catch (error) {
    circulationView.showBanner(
      "error",
      getErrorMessage(error, "Unable to send the email.")
    );
  } finally {
    circulationView.setReceiptPending(false);
  }
}

async function handleReturn(rawBookBarcode) {
  if (!state.session) {
    circulationView.showBanner("error", "Sign in before processing circulation.");
    return;
  }

  circulationView.setReturnPending(true);

  try {
    const result = await returnBook({
      bookBarcode: rawBookBarcode,
      actorUid: state.session.uid,
      guestMode: state.session?.access === ACCESS_MODE.guest,
    });

    circulationView.showBanner(result.status, result.message);
    circulationView.clearReturnInput();
    await refreshActivePatronSession();

    if (
      result.action === "return_auto_checkout" &&
      isAdminSession() &&
      result.autoCheckout?.patronBarcode
    ) {
      try {
        const autoSession = await loadPatronSession(result.autoCheckout.patronBarcode, {
          includeDetails: true,
        });

        if (autoSession?.patron?.email) {
          const patronName = autoSession.patron.name || "patron";
          const bookTitle = result.autoCheckout.bookTitle || "your hold";

          await sendPatronReceipt({
            patron: autoSession.patron,
            loans: autoSession.activeLoans,
            holds: autoSession.activeHolds,
            subject: `Your hold is ready: ${bookTitle}`,
            headline: `Your hold is ready. "${bookTitle}" has been checked out to you.`,
            highlightHoldTitle: bookTitle,
          });

          circulationView.showBanner(
            "success",
            `${result.message} Email sent to ${patronName}.`
          );
        }
      } catch {
        // Keep the return banner; hold-ready email failures should not block returns.
      }
    }
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to process return."));
  } finally {
    circulationView.setReturnPending(false);
  }
}
