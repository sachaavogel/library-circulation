function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReceiptMessage({ loans, holds }) {
  const loanLines = loans.length
    ? loans.map((loan, index) => {
        const title = loan.bookTitle || "Unknown title";
        return `${index + 1}. ${title}`;
      })
    : ["No active loans."];

  const holdLines = holds.length
    ? holds.map((hold, index) => {
        const title = hold.bookTitle || "Unknown title";
        return `${index + 1}. ${title}`;
      })
    : ["No active holds."];

  return ["Active loans:", ...loanLines, "", "Active holds:", ...holdLines].join("\n");
}

function buildReceiptListText(items, emptyLabel) {
  if (!items.length) {
    return emptyLabel;
  }

  return items
    .map((item) => {
      const title = item.bookTitle || "Unknown title";
      return `- ${title}`;
    })
    .join("\n");
}

function buildReceiptListHtml(items, emptyLabel) {
  if (!items.length) {
    return `<li>${escapeHtml(emptyLabel)}</li>`;
  }

  return items
    .map((item) => {
      const title = item.bookTitle || "Unknown title";
      return `<li>${escapeHtml(title)}</li>`;
    })
    .join("");
}

function getEmailJsConfig() {
  const config = window.LIBRARY_CATALOG_EMAILJS_CONFIG || {};
  const publicKey = String(config.publicKey || "").trim();
  const serviceId = String(config.serviceId || "").trim();
  const templateId = String(config.templateId || "").trim();

  if (!publicKey || publicKey.startsWith("YOUR_")) {
    throw new Error("EmailJS public key is missing. Update index.html.");
  }
  if (!serviceId || serviceId.startsWith("YOUR_")) {
    throw new Error("EmailJS service ID is missing. Update index.html.");
  }
  if (!templateId || templateId.startsWith("YOUR_")) {
    throw new Error("EmailJS template ID is missing. Update index.html.");
  }

  if (!window.emailjs || typeof window.emailjs.init !== "function") {
    throw new Error("EmailJS SDK failed to load.");
  }

  return {
    publicKey,
    serviceId,
    templateId,
  };
}

let emailJsReady = false;

export async function sendPatronReceipt({ patron, loans, holds }) {
  const email = String(patron?.email || "").trim();
  if (!email) {
    throw new Error("Patron email is required to send a receipt.");
  }

  const { publicKey, serviceId, templateId } = getEmailJsConfig();

  if (!emailJsReady) {
    window.emailjs.init({ publicKey });
    emailJsReady = true;
  }

  const subject = "Your Grand Oak Athenaeum loans and holds";
  const text = buildReceiptMessage({ loans, holds });
  const loansHtml = buildReceiptListHtml(loans, "No active loans.");
  const holdsHtml = buildReceiptListHtml(holds, "No active holds.");
  const loansText = buildReceiptListText(loans, "No active loans.");
  const holdsText = buildReceiptListText(holds, "No active holds.");

  const templateParams = {
    to_name: patron.name || "Patron",
    to_email: email,
    subject,
    message: text,
    loans_html: loansHtml,
    holds_html: holdsHtml,
    loans_text: loansText,
    holds_text: holdsText,
    loansText,
    holdsText,
    loan_text: loansText,
    hold_text: holdsText,
    loans: loansText,
    holds: holdsText,
  };

  await window.emailjs.send(serviceId, templateId, templateParams);
}
