import {
  FINE_CENTS,
  getBookStatusLabel,
  formatCurrency,
  formatDate,
  setFeedbackMessage,
  toDate,
} from "./shared.js";

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

function getDueLabel(book) {
  if (!book?.currentDueAt) {
    return "—";
  }
  return formatDate(book.currentDueAt);
}

function getLateFeeLabel(book) {
  const dueDate = toDate(book?.currentDueAt);
  if (!dueDate) {
    return "—";
  }
  const isOverdue = new Date() > dueDate;
  return isOverdue ? formatCurrency(FINE_CENTS) : "—";
}

export function createInventoryView({ onAddBook, onSearch, onUpdateBook, onRemoveBook }) {
  const form = document.getElementById("add-book-form");
  const barcodeInput = document.getElementById("book-barcode");
  const titleInput = document.getElementById("book-title");
  const submitButton = document.getElementById("add-book-submit");
  const searchInput = document.getElementById("inventory-search");
  const feedback = document.getElementById("inventory-feedback");
  const tableBody = document.getElementById("inventory-body");
  const emptyState = document.getElementById("inventory-empty");
  const editForm = document.getElementById("edit-book-form");
  const editBarcodeInput = document.getElementById("edit-book-barcode");
  const editTitleInput = document.getElementById("edit-book-title");
  const editSubmit = document.getElementById("edit-book-submit");
  const editCancel = document.getElementById("edit-book-cancel");
  const editFeedback = document.getElementById("inventory-edit-feedback");

  let editingBarcode = null;
  let booksByBarcode = new Map();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onAddBook({
      barcode: barcodeInput.value,
      title: titleInput.value,
    });
  });

  searchInput.addEventListener("input", () => {
    onSearch(searchInput.value);
  });

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editingBarcode) {
        return;
      }

      await onUpdateBook({
        originalBarcode: editingBarcode,
        barcode: editBarcodeInput.value,
        title: editTitleInput.value,
      });
    });
  }

  if (editCancel) {
    editCancel.addEventListener("click", () => {
      hideEditForm();
    });
  }

  if (tableBody) {
    tableBody.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const barcode = button.dataset.barcode;
      const action = button.dataset.action;
      const book = booksByBarcode.get(barcode);

      if (!book) {
        return;
      }

      if (action === "edit") {
        showEditForm(book);
        return;
      }

      if (action === "remove") {
        const confirmed = window.confirm(
          `Remove "${book.title}" from inventory? This cannot be undone.`
        );
        if (!confirmed) {
          return;
        }
        await onRemoveBook({ barcode: book.barcode });
      }
    });
  }

  function showEditForm(book) {
    if (!editForm) {
      return;
    }

    editingBarcode = book.barcode;
    editBarcodeInput.value = book.barcode;
    editTitleInput.value = book.title;
    editForm.hidden = false;
    editBarcodeInput.focus();
    if (editFeedback) {
      setFeedbackMessage(editFeedback, "", "");
    }
  }

  function hideEditForm() {
    if (!editForm) {
      return;
    }

    editingBarcode = null;
    editForm.hidden = true;
    editForm.reset();
    if (editFeedback) {
      setFeedbackMessage(editFeedback, "", "");
    }
  }

  return {
    clearForm() {
      form.reset();
      barcodeInput.focus();
    },
    clearEditForm() {
      hideEditForm();
    },
    setPending(isPending) {
      barcodeInput.disabled = isPending;
      titleInput.disabled = isPending;
      submitButton.disabled = isPending;
      submitButton.textContent = isPending ? "Adding..." : "Add to inventory";
    },
    setEditPending(isPending) {
      if (!editForm) {
        return;
      }

      editBarcodeInput.disabled = isPending;
      editTitleInput.disabled = isPending;
      editSubmit.disabled = isPending;
      editSubmit.textContent = isPending ? "Saving..." : "Save changes";
      if (editCancel) {
        editCancel.disabled = isPending;
      }
    },
    setMessage(kind, message) {
      setFeedbackMessage(feedback, kind, message);
    },
    setEditMessage(kind, message) {
      if (editFeedback) {
        setFeedbackMessage(editFeedback, kind, message);
      }
    },
    getSearchQuery() {
      return searchInput.value;
    },
    renderBooks(books, patronNameMap = new Map()) {
      tableBody.replaceChildren();
      booksByBarcode = new Map(books.map((book) => [book.barcode, book]));

      if (!books.length) {
        emptyState.textContent = searchInput.value.trim()
          ? "No books match the current search."
          : "Inventory will appear here once books are added.";
        emptyState.hidden = false;
        return;
      }

      emptyState.hidden = true;

      books.forEach((book) => {
        const row = document.createElement("tr");
        appendCell(row, book.barcode);
        appendCell(row, book.title);
        appendCell(row, createStatusPill(book.status));
        appendCell(row, getDueLabel(book));
        appendCell(row, getLateFeeLabel(book));
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
        const actions = document.createElement("div");
        actions.className = "table-actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "button button--ghost button--small";
        editButton.dataset.action = "edit";
        editButton.dataset.barcode = book.barcode;
        editButton.textContent = "Edit";
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "button button--ghost button--small";
        removeButton.dataset.action = "remove";
        removeButton.dataset.barcode = book.barcode;
        removeButton.textContent = "Remove";
        actions.append(editButton, removeButton);
        appendCell(row, actions);
        tableBody.append(row);
      });
    },
  };
}
