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

function normalizeTitleMatch(value) {
  return String(value || "").trim().toLowerCase();
}

function prioritizeItems(items, highlightTitle) {
  if (!highlightTitle) {
    return { items, highlightIndex: -1 };
  }

  const matchValue = normalizeTitleMatch(highlightTitle);
  const highlightIndex = items.findIndex(
    (item) => normalizeTitleMatch(item.bookTitle) === matchValue
  );

  if (highlightIndex <= 0) {
    return { items, highlightIndex };
  }

  return {
    items: [
      items[highlightIndex],
      ...items.slice(0, highlightIndex),
      ...items.slice(highlightIndex + 1),
    ],
    highlightIndex: 0,
  };
}

function buildReceiptListText(items, emptyLabel, options = {}) {
  if (!items.length) {
    return emptyLabel;
  }

  const { highlightTitle, highlightLabel = "Ready now:" } = options;
  const { items: sortedItems, highlightIndex } = prioritizeItems(items, highlightTitle);

  return sortedItems
    .map((item, index) => {
      const title = item.bookTitle || "Unknown title";
      if (highlightTitle && index === highlightIndex) {
        return `${highlightLabel} ${title}`;
      }
      return title;
    })
    .join("\n");
}

function buildReceiptListHtml(items, emptyLabel, options = {}) {
  if (!items.length) {
    return `<li style="color:#64748b;font-style:italic;">${escapeHtml(emptyLabel)}</li>`;
  }

  const { highlightTitle, highlightLabel = "Ready now:" } = options;
  const { items: sortedItems, highlightIndex } = prioritizeItems(items, highlightTitle);

  return sortedItems
    .map((item, index) => {
      const title = item.bookTitle || "Unknown title";
      if (highlightTitle && index === highlightIndex) {
        return `<li><span style="display:inline-block;margin-right:6px;padding:2px 6px;border-radius:999px;background:#1d4ed8;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(
          highlightLabel
        )}</span>${escapeHtml(title)}</li>`;
      }
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

export async function sendPatronReceipt({
  patron,
  loans,
  holds,
  subject,
  headline,
  highlightHoldTitle,
} = {}) {
  const email = String(patron?.email || "").trim();
  if (!email) {
    throw new Error("Patron email is required to send a receipt.");
  }

  const { publicKey, serviceId, templateId } = getEmailJsConfig();

  if (!emailJsReady) {
    window.emailjs.init({ publicKey });
    emailJsReady = true;
  }

  const finalSubject =
    String(subject || "").trim() || "Your Grand Oak Athenaeum loans and holds";
  const finalHeadline =
    String(headline || "").trim() || "Here is your current circulation summary.";
  const text = buildReceiptMessage({ loans, holds });
  const loansHtml = buildReceiptListHtml(loans, "No active loans.");
  const holdsHtml = buildReceiptListHtml(holds, "No active holds.", {
    highlightTitle: highlightHoldTitle,
  });
  const loansText = buildReceiptListText(loans, "No active loans.");
  const holdsText = buildReceiptListText(holds, "No active holds.", {
    highlightTitle: highlightHoldTitle,
  });

  const templateParams = {
    to_name: patron.name || "Patron",
    to_email: email,
    subject: finalSubject,
    headline: finalHeadline,
    headline_text: finalHeadline,
    message: text,
    loans_html: loansHtml,
    holds_html: holdsHtml,
    loansHtml: loansHtml,
    holdsHtml: holdsHtml,
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
