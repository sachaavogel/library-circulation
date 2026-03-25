import {
  FINE_CENTS,
  formatTimestamp,
  formatCurrency,
  formatDate,
  getBookStatusLabel,
  getLoanDueDate,
  setFeedbackMessage,
  toDate,
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

function getBookDueLabel(book) {
  if (!book?.currentDueAt) {
    return "—";
  }
  return formatDate(book.currentDueAt);
}

function getBookLateFeeLabel(book) {
  const dueDate = toDate(book?.currentDueAt);
  if (!dueDate) {
    return "—";
  }
  const isOverdue = new Date() > dueDate;
  return isOverdue ? formatCurrency(FINE_CENTS) : "—";
}

function buildLoanMeta(loan, now) {
  const parts = [];
  const dueDate = getLoanDueDate(loan, now);
  const dueLabel = formatDate(dueDate);
  if (dueLabel && dueLabel !== "—") {
    parts.push(`Due ${dueLabel}`);
  }

  const checkedOutLabel = formatTimestamp(loan.checkedOutAt);
  if (checkedOutLabel && checkedOutLabel !== "—") {
    parts.push(`Checked out ${checkedOutLabel}`);
  }

  const isOverdue = dueDate ? now > dueDate : false;
  if (isOverdue) {
    const feeLabel = formatCurrency(FINE_CENTS);
    parts.push(`Late fee ${feeLabel}`);
  }

  return parts.length ? parts.join(" • ") : "—";
}

export function createCirculationView({
  onLoadPatron,
  onCheckout,
  onReturn,
  onSaveProfile,
  onSendReceipt,
  onEndPatron,
  onHomeSearch,
  onHomeFilterChange,
}) {
  const patronForm = document.getElementById("patron-form");
  const patronInput = document.getElementById("patron-barcode");
  const patronSubmit = document.getElementById("patron-submit");

  const homePanel = document.getElementById("circulation-home");
  const homeSearch = document.getElementById("circulation-inventory-search");
  const homeStatusFilter = document.getElementById("circulation-filter-status");
  const homeTableBody = document.getElementById("circulation-inventory-body");
  const homeEmpty = document.getElementById("circulation-inventory-empty");
  const totalBooks = document.getElementById("circulation-total-books");
  const availableBooks = document.getElementById("circulation-available-books");
  const checkedOutBooks = document.getElementById("circulation-checkedout-books");
  const holdBooks = document.getElementById("circulation-hold-books");

  const endSessionButton = document.getElementById("end-patron-session");
  const editProfileButton = document.getElementById("edit-patron-profile");
  const emailInfoButton = document.getElementById("email-patron-info");
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
  const activeFeeTotal = document.getElementById("active-fee-total");
  const activeLoansList = document.getElementById("active-loans-list");
  const activeHoldsList = document.getElementById("active-holds-list");
  const recentLoansList = document.getElementById("recent-loans-list");

  const profileModal = document.getElementById("patron-profile-modal");
  const profileForm = document.getElementById("patron-profile-form");
  const profileNameInput = document.getElementById("patron-profile-name");
  const profileEmailInput = document.getElementById("patron-profile-email");
  const profileSubmit = document.getElementById("patron-profile-submit");
  const profileCancel = document.getElementById("patron-profile-cancel");
  const profileFeedback = document.getElementById("patron-profile-feedback");
  const profileSubtitle = document.getElementById("patron-profile-subtitle");
  const profileBackdrop = profileModal?.querySelector("[data-action='close']");

  let guestMode = false;
  let profileRequired = false;
  let currentPatron = null;

  patronForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onLoadPatron(patronInput.value);
  });

  if (homeSearch && onHomeSearch) {
    homeSearch.addEventListener("input", () => {
      onHomeSearch(homeSearch.value);
    });
  }

  if (onHomeFilterChange && homeStatusFilter) {
    const emitFilters = () => {
      onHomeFilterChange({
        status: homeStatusFilter?.value || "all",
      });
    };

    if (homeStatusFilter) {
      homeStatusFilter.addEventListener("change", emitFilters);
    }
  }

  if (profileForm) {
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await onSaveProfile({
        name: profileNameInput.value,
        email: profileEmailInput.value,
      });
    });
  }

  if (endSessionButton && onEndPatron) {
    endSessionButton.addEventListener("click", async () => {
      await onEndPatron();
    });
  }

  if (editProfileButton) {
    editProfileButton.addEventListener("click", () => {
      openProfileModal({
        required: false,
        name: currentPatron?.name || "",
        email: currentPatron?.email || "",
      });
    });
  }

  if (emailInfoButton && onSendReceipt) {
    emailInfoButton.addEventListener("click", async () => {
      await onSendReceipt();
    });
  }

  if (profileCancel) {
    profileCancel.addEventListener("click", () => {
      if (!profileRequired) {
        closeProfileModal();
      }
    });
  }

  if (profileBackdrop) {
    profileBackdrop.addEventListener("click", () => {
      if (!profileRequired) {
        closeProfileModal();
      }
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
      if (profileNameInput) {
        profileNameInput.value = "";
      }
      if (profileEmailInput) {
        profileEmailInput.value = "";
      }
    },
    setPatronPending(isPending) {
      patronInput.disabled = isPending;
      patronSubmit.disabled = isPending;
      patronSubmit.textContent = isPending ? "Loading..." : "Load patron";
    },
    setProfilePending(isPending) {
      if (!profileForm) {
        return;
      }
      profileNameInput.disabled = isPending;
      profileEmailInput.disabled = isPending;
      profileSubmit.disabled = isPending;
      profileSubmit.textContent = isPending ? "Saving..." : "Save profile";
      if (profileCancel) {
        profileCancel.disabled = isPending;
      }
    },
    setReceiptPending(isPending) {
      if (!emailInfoButton) {
        return;
      }
      emailInfoButton.disabled = isPending;
      emailInfoButton.textContent = isPending ? "Sending..." : "Email info";
    },
    setReceiptEnabled(isEnabled) {
      if (!emailInfoButton) {
        return;
      }
      emailInfoButton.disabled = !isEnabled;
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
    openProfileModal(options = {}) {
      openProfileModal(options);
    },
    closeProfileModal() {
      closeProfileModal();
    },
    setCheckoutEnabled(isEnabled) {
      checkoutInput.disabled = !isEnabled;
      checkoutSubmit.disabled = !isEnabled;
    },
    setProfileMessage(kind, message) {
      if (profileFeedback) {
        setFeedbackMessage(profileFeedback, kind, message);
      }
    },
    setGuestMode(isGuest) {
      guestMode = isGuest;
      if (guestMode) {
        this.setHomeVisible(false);
      }
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
      if (activeFeeTotal) {
        activeFeeTotal.textContent = formatCurrency(0);
      }
      currentPatron = null;
      closeProfileModal();
      if (editProfileButton) {
        editProfileButton.hidden = true;
      }
      if (emailInfoButton) {
        emailInfoButton.hidden = true;
        emailInfoButton.textContent = "Email info";
        emailInfoButton.disabled = true;
      }
      renderList(activeLoansList, [], "No patron session open.");
      renderList(activeHoldsList, [], "No patron session open.");
      if (recentLoansList) {
        renderList(recentLoansList, [], "No patron session open.");
      }
      this.setCheckoutEnabled(false);
      if (!guestMode) {
        this.setHomeVisible(true);
      } else {
        this.setHomeVisible(false);
      }
      if (endSessionButton) {
        endSessionButton.hidden = true;
      }
    },
    renderPatronSession(session) {
      const now = new Date();
      currentPatron = session.patron;
      patronLabel.textContent = session.patron.name || "Name required";
      patronCreated.textContent = session.createdOnLoad
        ? `Created new patron record. Barcode ${session.patron.barcode}.`
        : `Barcode ${session.patron.barcode} • Last seen ${formatTimestamp(session.patron.lastSeenAt)}`;
      activeLoanCount.textContent = String(session.activeLoans.length);
      activeHoldCount.textContent = String(session.activeHolds.length);
      if (activeFeeTotal) {
        const feeTotalCents = session.activeLoans.reduce((total, loan) => {
          const dueDate = getLoanDueDate(loan, now);
          const isOverdue = dueDate ? now > dueDate : false;
          const appliedFee = Number(loan.fineCents || 0);
          if (appliedFee > 0) {
            return total + appliedFee;
          }
          if (isOverdue) {
            return total + FINE_CENTS;
          }
          return total;
        }, 0);
        activeFeeTotal.textContent = formatCurrency(feeTotalCents);
      }

      profileRequired = Boolean(session.needsProfile);
      if (profileRequired) {
        openProfileModal({
          required: true,
          name: session.patron.name,
          email: session.patron.email,
        });
      } else {
        closeProfileModal();
      }

      renderList(
        activeLoansList,
        session.activeLoans.map((loan) =>
          buildRecordItem({
            title: loan.bookTitle,
            meta: buildLoanMeta(loan, now),
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

      if (recentLoansList) {
        renderList(
          recentLoansList,
          session.recentLoans.map((loan) =>
            buildRecordItem({
              title: loan.bookTitle,
              meta: `${loan.status} • ${formatTimestamp(loan.checkedOutAt)}`,
            })
          ),
          "No recent activity."
        );
      }

      this.setCheckoutEnabled(!profileRequired);
      this.setHomeVisible(false);
      if (endSessionButton) {
        endSessionButton.hidden = false;
      }
      if (editProfileButton) {
        editProfileButton.hidden = profileRequired;
      }
      if (emailInfoButton) {
        emailInfoButton.hidden = false;
        emailInfoButton.disabled = profileRequired || !session.patron.email;
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
    renderInventory(books, stats, patronNameMap = new Map()) {
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
        appendCell(row, getBookDueLabel(book));
        appendCell(row, getBookLateFeeLabel(book));
        const patronBarcode = book.currentPatronBarcode;
        const patronName = patronBarcode
          ? patronNameMap.get(patronBarcode) || ""
          : "";
        const patronLabelText = patronBarcode
          ? patronName
            ? `${patronName} (${patronBarcode})`
            : patronBarcode
          : "—";
        appendCell(row, patronLabelText);
        homeTableBody.append(row);
      });
    },
    getHomeSearchQuery() {
      return homeSearch?.value ?? "";
    },
  };

  function openProfileModal({ required = false, name = "", email = "" } = {}) {
    if (!profileModal) {
      return;
    }

    profileRequired = required;
    profileModal.hidden = false;
    profileNameInput.value = name || "";
    profileEmailInput.value = email || "";
    if (profileSubtitle) {
      profileSubtitle.textContent = required
        ? "First scan requires a name and email for notifications."
        : "Update the patron name or email.";
    }
    if (profileCancel) {
      profileCancel.hidden = required;
    }
    if (profileFeedback) {
      setFeedbackMessage(profileFeedback, "", "");
    }
    profileNameInput.focus();
  }

  function closeProfileModal() {
    if (!profileModal) {
      return;
    }

    profileModal.hidden = true;
    if (profileFeedback) {
      setFeedbackMessage(profileFeedback, "", "");
    }
  }
}
