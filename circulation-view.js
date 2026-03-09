import {
  formatTimestamp,
  setFeedbackMessage,
} from "./shared.js";

function buildRecordItem({ title, meta }) {
  const item = document.createElement("li");
  item.className = "record-list__item";

  const titleElement = document.createElement("span");
  titleElement.className = "record-list__title";
  titleElement.textContent = title;

  const metaElement = document.createElement("span");
  metaElement.className = "record-list__meta";
  metaElement.textContent = meta;

  item.append(titleElement, metaElement);
  return item;
}

function renderList(root, items, emptyText) {
  root.replaceChildren();

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "record-list__empty";
    emptyItem.textContent = emptyText;
    root.append(emptyItem);
    return;
  }

  items.forEach((item) => root.append(item));
}

export function createCirculationView({
  onLoadPatron,
  onCheckout,
  onReturn,
}) {
  const patronForm = document.getElementById("patron-form");
  const patronInput = document.getElementById("patron-barcode");
  const patronSubmit = document.getElementById("patron-submit");

  const checkoutForm = document.getElementById("checkout-form");
  const checkoutInput = document.getElementById("checkout-book-barcode");
  const checkoutSubmit = document.getElementById("checkout-submit");

  const returnForm = document.getElementById("return-form");
  const returnInput = document.getElementById("return-book-barcode");
  const returnSubmit = document.getElementById("return-submit");

  const banner = document.getElementById("circulation-banner");
  const patronLabel = document.getElementById("active-patron-label");
  const patronCreated = document.getElementById("active-patron-created");
  const activeLoanCount = document.getElementById("active-loan-count");
  const activeHoldCount = document.getElementById("active-hold-count");
  const activeLoansList = document.getElementById("active-loans-list");
  const activeHoldsList = document.getElementById("active-holds-list");

  patronForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onLoadPatron(patronInput.value);
  });

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onCheckout(checkoutInput.value);
  });

  returnForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onReturn(returnInput.value);
  });

  return {
    focusPatronInput() {
      patronInput.focus();
    },
    focusCheckoutInput() {
      checkoutInput.focus();
    },
    clearPatronInput() {
      patronInput.value = "";
    },
    clearCheckoutInput() {
      checkoutInput.value = "";
    },
    clearReturnInput() {
      returnInput.value = "";
    },
    setPatronPending(isPending) {
      patronInput.disabled = isPending;
      patronSubmit.disabled = isPending;
      patronSubmit.textContent = isPending ? "Loading..." : "Load patron";
    },
    setCheckoutPending(isPending) {
      checkoutInput.disabled = isPending;
      checkoutSubmit.disabled = isPending;
      checkoutSubmit.textContent = isPending ? "Processing..." : "Process checkout";
    },
    setReturnPending(isPending) {
      returnInput.disabled = isPending;
      returnSubmit.disabled = isPending;
      returnSubmit.textContent = isPending ? "Processing..." : "Process return";
    },
    setReturnVisible(isVisible) {
      returnForm.hidden = !isVisible;

      if (!isVisible) {
        returnInput.disabled = true;
        returnSubmit.disabled = true;
        returnSubmit.textContent = "Process return";
        returnInput.value = "";
        return;
      }

      returnInput.disabled = false;
      returnSubmit.disabled = false;
      returnSubmit.textContent = "Process return";
    },
    setCheckoutEnabled(isEnabled) {
      checkoutInput.disabled = !isEnabled;
      checkoutSubmit.disabled = !isEnabled;
    },
    showBanner(kind, message) {
      setFeedbackMessage(banner, kind, message);
    },
    clearBanner() {
      setFeedbackMessage(banner, "", "");
    },
    clearPatronSession() {
      patronLabel.textContent = "No patron loaded";
      patronCreated.textContent = "";
      activeLoanCount.textContent = "0";
      activeHoldCount.textContent = "0";
      renderList(activeLoansList, [], "No patron session open.");
      renderList(activeHoldsList, [], "No patron session open.");
      this.setCheckoutEnabled(false);
    },
    renderPatronSession(session) {
      patronLabel.textContent = session.patron.barcode;
      patronCreated.textContent = session.createdOnLoad
        ? session.detailsLimited
          ? "Created new patron record on this scan. Guest mode hides detailed loan and hold lists."
          : "Created new patron record on this scan."
        : session.detailsLimited
          ? `Last seen ${formatTimestamp(session.patron.lastSeenAt)}. Guest mode hides detailed loan and hold lists.`
          : `Last seen ${formatTimestamp(session.patron.lastSeenAt)}`;
      activeLoanCount.textContent = String(session.patron.activeLoanCount || 0);
      activeHoldCount.textContent = String(session.patron.activeHoldCount || 0);

      renderList(
        activeLoansList,
        session.activeLoans.map((loan) =>
          buildRecordItem({
            title: loan.bookTitle,
            meta: `${loan.bookBarcode} • checked out ${formatTimestamp(loan.checkedOutAt)}`,
          })
        ),
        session.detailsLimited ? "Guest mode hides detailed loan list." : "No active loans."
      );

      renderList(
        activeHoldsList,
        session.activeHolds.map((hold) =>
          buildRecordItem({
            title: hold.bookTitle,
            meta: `${hold.bookBarcode} • hold #${hold.position} • queued ${formatTimestamp(hold.createdAt)}`,
          })
        ),
        session.detailsLimited ? "Guest mode hides detailed hold list." : "No queued holds."
      );

      this.setCheckoutEnabled(true);
    },
  };
}
