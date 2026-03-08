import { signInAdmin, signOutAdmin, watchAdminSession } from "./auth.js";
import { checkoutOrPlaceHold, returnBook } from "./circulation.js";
import { firebaseConfigReady } from "./firebase-init.js";
import { addBook, searchInventory, watchInventory } from "./inventory.js";
import { createCirculationView } from "./circulation-view.js";
import { createInventoryView } from "./inventory-view.js";
import { createLoginView } from "./login-view.js";
import { loadPatronSession } from "./patrons.js";
import { TAB, getErrorMessage } from "./shared.js";

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
  admin: null,
  activeTab: TAB.inventory,
  activePatronBarcode: null,
  inventoryUnsubscribe: null,
};

const loginView = createLoginView({
  onSubmit: handleLogin,
});

const inventoryView = createInventoryView({
  onAddBook: handleAddBook,
  onSearch: handleInventorySearch,
});

const circulationView = createCirculationView({
  onLoadPatron: handleLoadPatron,
  onCheckout: handleCheckout,
  onReturn: handleReturn,
});

inventoryTabButton.addEventListener("click", () => selectTab(TAB.inventory));
circulationTabButton.addEventListener("click", () => selectTab(TAB.circulation));
signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;

  try {
    await signOutAdmin();
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
  sessionDetail.textContent = "Sign in with a seeded admin account to begin.";
  loginView.focus();

  watchAdminSession(handleAuthChange, (error) => {
    loginView.setMessage("error", getErrorMessage(error));
  });
}

function selectTab(tabName) {
  state.activeTab = tabName;

  const inventoryActive = tabName === TAB.inventory;

  inventorySection.hidden = !inventoryActive;
  circulationSection.hidden = inventoryActive;

  inventoryTabButton.classList.toggle("tab-button--active", inventoryActive);
  inventoryTabButton.setAttribute("aria-selected", String(inventoryActive));

  circulationTabButton.classList.toggle("tab-button--active", !inventoryActive);
  circulationTabButton.setAttribute("aria-selected", String(!inventoryActive));
}

function handleAuthChange(admin) {
  state.admin = admin;

  if (admin) {
    loginView.hide();
    loginView.resetPassword();
    appShell.hidden = false;
    adminEmail.textContent = admin.email || admin.uid;
    sessionLabel.textContent = "Admin authenticated";
    sessionDetail.textContent = `Role: ${admin.role}`;
    beginInventoryWatch();
    selectTab(state.activeTab);
    return;
  }

  adminEmail.textContent = "admin";
  sessionLabel.textContent = "Signed out";
  sessionDetail.textContent = "Sign in with a seeded admin account to begin.";
  appShell.hidden = true;
  loginView.show();
  loginView.focus();
  inventoryView.setMessage("", "");
  circulationView.clearBanner();
  circulationView.clearPatronSession();
  state.activePatronBarcode = null;

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
      inventoryView.renderBooks(searchInventory(inventoryView.getSearchQuery()));
    },
    (error) => {
      inventoryView.setMessage("error", getErrorMessage(error, "Unable to load inventory."));
    }
  );
}

function handleInventorySearch(query) {
  inventoryView.renderBooks(searchInventory(query));
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

async function handleAddBook(payload) {
  inventoryView.setPending(true);
  inventoryView.setMessage("", "");

  try {
    const book = await addBook(payload);
    inventoryView.setMessage("success", `Added "${book.title}" to inventory.`);
    inventoryView.clearForm();
    inventoryView.renderBooks(searchInventory(inventoryView.getSearchQuery()));
  } catch (error) {
    inventoryView.setMessage("error", getErrorMessage(error, "Unable to add the book."));
  } finally {
    inventoryView.setPending(false);
  }
}

async function handleLoadPatron(rawPatronBarcode) {
  circulationView.setPatronPending(true);
  circulationView.clearBanner();

  try {
    const session = await loadPatronSession(rawPatronBarcode);
    state.activePatronBarcode = session.patron.barcode;
    circulationView.renderPatronSession(session);
    circulationView.clearPatronInput();
    circulationView.focusCheckoutInput();

    circulationView.showBanner(
      "success",
      session.createdOnLoad
        ? `Created patron ${session.patron.barcode} and opened the session.`
        : `Loaded patron ${session.patron.barcode}.`
    );
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to load patron."));
  } finally {
    circulationView.setPatronPending(false);
  }
}

async function refreshActivePatronSession() {
  if (!state.activePatronBarcode) {
    return;
  }

  try {
    const session = await loadPatronSession(state.activePatronBarcode);
    circulationView.renderPatronSession(session);
  } catch (error) {
    circulationView.showBanner(
      "error",
      getErrorMessage(error, "Unable to refresh the patron session.")
    );
  }
}

async function handleCheckout(rawBookBarcode) {
  if (!state.admin) {
    circulationView.showBanner("error", "Sign in before processing circulation.");
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
      adminUid: state.admin.uid,
    });

    circulationView.showBanner(result.status, result.message);
    circulationView.clearCheckoutInput();
    await refreshActivePatronSession();
  } catch (error) {
    circulationView.showBanner("error", getErrorMessage(error, "Unable to process checkout."));
  } finally {
    circulationView.setCheckoutPending(false);
    circulationView.setCheckoutEnabled(Boolean(state.admin && state.activePatronBarcode));
  }
}

async function handleReturn(rawBookBarcode) {
  if (!state.admin) {
    circulationView.showBanner("error", "Sign in before processing circulation.");
    return;
  }

  circulationView.setReturnPending(true);

  try {
    const result = await returnBook({
      bookBarcode: rawBookBarcode,
      adminUid: state.admin.uid,
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
