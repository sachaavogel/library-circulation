import {
  formatTimestamp,
  getBookStatusLabel,
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

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className =
    status === "checked_out"
      ? "status-pill status-pill--checked-out"
      : "status-pill status-pill--available";
  pill.textContent = getBookStatusLabel(status);
  return pill;
}

function appendCell(row, content) {
  const cell = document.createElement("td");

  if (content instanceof Node) {
    cell.append(content);
  } else {
    cell.textContent = content;
  }

  row.append(cell);
}

export function createCirculationView({
  onLoadPatron,
  onCheckout,
  onReturn,
  onSaveName,
  onEndPatron,
  onHomeSearch,
}) {
  const patronForm = document.getElementById("patron-form");
  const patronInput = document.getElementById("patron-barcode");
  const patronSubmit = document.getElementById("patron-submit");

  const homePanel = document.getElementById("circulation-home");
  const homeSearch = document.getElementById("circulation-inventory-search");
  const homeTableBody = document.getElementById("circulation-inventory-body");
  const homeEmpty = document.getElementById("circulation-inventory-empty");
  const totalBooks = document.getElementById("circulation-total-books");
  const availableBooks = document.getElementById("circulation-available-books");
  const checkedOutBooks = document.getElementById("circulation-checkedout-books");
  const holdBooks = document.getElementById("circulation-hold-books");

  const nameForm = document.getElementById("patron-name-form");
  const nameInput = document.getElementById("patron-name-input");
  const nameSubmit = document.getElementById("patron-name-submit");
  const nameHelp = document.getElementById("patron-name-help");

  const endSessionButton = document.getElementById("end-patron-session");
  const patronSessionPanel = document.getElementById("patron-session");

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

  if (homeSearch && onHomeSearch) {
    homeSearch.addEventListener("input", () => {
      onHomeSearch(homeSearch.value);
    });
  }

  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onSaveName(nameInput.value);
  });

  if (endSessionButton && onEndPatron) {
    endSessionButton.addEventListener("click", async () => {
      await onEndPatron();
    });
  }

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
    clearNameInput() {
      nameInput.value = "";
    },
    setPatronPending(isPending) {
      patronInput.disabled = isPending;
      patronSubmit.disabled = isPending;
      patronSubmit.textContent = isPending ? "Loading..." : "Load patron";
    },
    setNamePending(isPending) {
      nameInput.disabled = isPending;
      nameSubmit.disabled = isPending;
      nameSubmit.textContent = isPending ? "Saving..." : "Save name";
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
    showNamePrompt() {
      nameForm.hidden = false;
      nameHelp.hidden = false;
      nameInput.focus();
    },
    hideNamePrompt() {
      nameForm.hidden = true;
      nameHelp.hidden = true;
      nameInput.value = "";
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
      this.hideNamePrompt();
      renderList(activeLoansList, [], "No patron session open.");
      renderList(activeHoldsList, [], "No patron session open.");
      this.setCheckoutEnabled(false);
      this.setHomeVisible(true);
      if (endSessionButton) {
        endSessionButton.hidden = true;
      }
    },
    renderPatronSession(session) {
      patronLabel.textContent = session.patron.name || "Name needed";
      patronCreated.textContent = session.createdOnLoad
        ? "Created new patron record on this scan."
        : `Last seen ${formatTimestamp(session.patron.lastSeenAt)}`;
      activeLoanCount.textContent = String(session.activeLoans.length);
      activeHoldCount.textContent = String(session.activeHolds.length);

      if (session.needsName) {
        this.showNamePrompt();
      } else {
        this.hideNamePrompt();
      }

      renderList(
        activeLoansList,
        session.activeLoans.map((loan) =>
          buildRecordItem({
            title: loan.bookTitle,
            meta: `${loan.bookBarcode} • checked out ${formatTimestamp(loan.checkedOutAt)}`,
          })
        ),
        "No active loans."
      );

      renderList(
        activeHoldsList,
        session.activeHolds.map((hold) =>
          buildRecordItem({
            title: hold.bookTitle,
            meta: `${hold.bookBarcode} • hold #${hold.position} • queued ${formatTimestamp(hold.createdAt)}`,
          })
        ),
        "No queued holds."
      );

      this.setCheckoutEnabled(true);
      this.setHomeVisible(false);
      if (endSessionButton) {
        endSessionButton.hidden = false;
      }
    },
    setHomeVisible(isVisible) {
      if (homePanel) {
        homePanel.hidden = !isVisible;
      }
      if (patronSessionPanel) {
        patronSessionPanel.hidden = isVisible;
      }
    },
    renderInventory(books, stats) {
      if (totalBooks) {
        totalBooks.textContent = String(stats.total ?? 0);
      }
      if (availableBooks) {
        availableBooks.textContent = String(stats.available ?? 0);
      }
      if (checkedOutBooks) {
        checkedOutBooks.textContent = String(stats.checkedOut ?? 0);
      }
      if (holdBooks) {
        holdBooks.textContent = String(stats.onHold ?? 0);
      }

      if (!homeTableBody || !homeEmpty) {
        return;
      }

      homeTableBody.replaceChildren();

      if (!books.length) {
        homeEmpty.textContent = homeSearch?.value?.trim()
          ? "No books match the current search."
          : "Inventory will appear here once books are added.";
        homeEmpty.hidden = false;
        return;
      }

      homeEmpty.hidden = true;

      books.forEach((book) => {
        const row = document.createElement("tr");
        appendCell(row, book.barcode);
        appendCell(row, book.title);
        appendCell(row, createStatusPill(book.status));
        appendCell(row, book.currentPatronBarcode || "—");
        homeTableBody.append(row);
      });
    },
    getHomeSearchQuery() {
      return homeSearch?.value ?? "";
    },
  };
}
