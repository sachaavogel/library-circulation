import {
  signInAdmin,
  signInGuest,
  signOutSession,
  watchLibrarySession,
} from "./auth.js";
import { checkoutOrPlaceHold, returnBook } from "./circulation.js";
import { firebaseConfigReady } from "./firebase-init.js";
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
  loadPatronSession,
  updatePatronName,
} from "./patrons.js";
import { ACCESS_MODE, TAB, getErrorMessage } from "./shared.js";

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
  inventoryUnsubscribe: null,
  circulationInventoryQuery: "",
};

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
  onSaveName: handleSavePatronName,
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
  sessionDetail.textContent = "Sign in as admin or continue as guest.";
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
  circulationView.clearPatronSession();
  circulationView.clearBanner();
  circulationView.setHomeVisible(true);

  if (admin) {
    loginView.hide();
    loginView.resetPassword();
    appShell.hidden = false;
    adminEmail.textContent =
      admin.access === ACCESS_MODE.guest ? "Guest mode" : admin.email || admin.uid;
    sessionLabel.textContent =
      admin.access === ACCESS_MODE.guest ? "Guest session" : "Admin authenticated";
    sessionDetail.textContent =
      admin.access === ACCESS_MODE.guest
        ? "Circulation enabled. Inventory changes require admin sign-in."
        : `Role: ${admin.role}`;
    signOutButton.textContent =
      admin.access === ACCESS_MODE.guest ? "Exit guest" : "Sign out";
    syncAccessModeUi();

    beginInventoryWatch();

    if (isAdminSession()) {
      selectTab(state.activeTab);
    } else {
      inventoryView.setMessage("", "");
      selectTab(TAB.circulation);
    }

    return;
  }

  adminEmail.textContent = "admin";
  sessionLabel.textContent = "Signed out";
  sessionDetail.textContent = "Sign in as admin or continue as guest.";
  signOutButton.textContent = "Sign out";
  appShell.hidden = true;
  loginView.show();
  loginView.focus();
  inventoryView.setMessage("", "");
  circulationView.setReturnVisible(true);
  inventoryTabButton.hidden = false;

  if (state.inventoryUnsubscribe) {
    state.inventoryUnsubscribe();
    state.inventoryUnsubscribe = null;
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
  inventoryView.renderBooks(searchInventory(query));
}

function handleCirculationInventorySearch(query) {
  state.circulationInventoryQuery = query;
  refreshInventoryViews();
}

function refreshInventoryViews() {
  const inventoryResults = searchInventory(inventoryView.getSearchQuery());
  inventoryView.renderBooks(inventoryResults);

  const circulationResults = searchInventory(state.circulationInventoryQuery);
  circulationView.renderInventory(circulationResults, getInventoryStats());
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
    loginView.setMessage("error", getErrorMessage(error, "Unable to continue as guest."));
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
    state.activePatronBarcode = session.patron.barcode;
    circulationView.renderPatronSession(session);
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

async function handleSavePatronName(rawName) {
  if (!state.activePatronBarcode) {
    circulationView.showBanner("error", "Load a patron before saving a name.");
    return;
  }

  circulationView.setNamePending(true);
  circulationView.clearBanner();

  try {
    await updatePatronName({
      patronBarcode: state.activePatronBarcode,
      name: rawName,
    });

    const session = await loadPatronSession(state.activePatronBarcode, {
      includeDetails: true,
      guestUid: state.session?.access === ACCESS_MODE.guest ? state.session.uid : null,
    });

    circulationView.renderPatronSession(session);
    circulationView.clearNameInput();
    circulationView.showBanner("success", "Saved patron name.");
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to save patron name."));
  } finally {
    circulationView.setNamePending(false);
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
    circulationView.renderPatronSession(session);
  } catch (error) {
    circulationView.showBanner(
      "error",
      getErrorMessage(error, "Unable to refresh the patron session.")
    );
  }
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
        getErrorMessage(error, "Unable to clear the guest session.")
      );
      return;
    }
  }

  state.activePatronBarcode = null;
  circulationView.clearPatronSession();
  circulationView.showBanner("info", "Patron session ended.");
  circulationView.focusPatronInput();
}

async function handleCheckout(rawBookBarcode) {
  if (!hasCirculationAccess()) {
    circulationView.showBanner("error", "Sign in or continue as guest before processing circulation.");
    return;
  }

  if (!state.activePatronBarcode) {
    circulationView.showBanner("error", "Load a patron session before checking out books.");
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
    circulationView.setCheckoutEnabled(Boolean(state.session && state.activePatronBarcode));
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
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to process return."));
  } finally {
    circulationView.setReturnPending(false);
  }
}
