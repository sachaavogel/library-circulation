import {
  getBookStatusLabel,
  setFeedbackMessage,
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

export function createInventoryView({ onAddBook, onSearch }) {
  const form = document.getElementById("add-book-form");
  const barcodeInput = document.getElementById("book-barcode");
  const titleInput = document.getElementById("book-title");
  const submitButton = document.getElementById("add-book-submit");
  const searchInput = document.getElementById("inventory-search");
  const feedback = document.getElementById("inventory-feedback");
  const tableBody = document.getElementById("inventory-body");
  const emptyState = document.getElementById("inventory-empty");

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

  return {
    clearForm() {
      form.reset();
      barcodeInput.focus();
    },
    setPending(isPending) {
      barcodeInput.disabled = isPending;
      titleInput.disabled = isPending;
      submitButton.disabled = isPending;
      submitButton.textContent = isPending ? "Adding..." : "Add to inventory";
    },
    setMessage(kind, message) {
      setFeedbackMessage(feedback, kind, message);
    },
    getSearchQuery() {
      return searchInput.value;
    },
    renderBooks(books) {
      tableBody.replaceChildren();

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
        appendCell(row, book.currentPatronBarcode || "—");
        tableBody.append(row);
      });
    },
  };
}
