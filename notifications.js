function buildReceiptText({ patron, loans, holds }) {
  const patronName = patron.name || "patron";
  const patronLine = `${patronName} (${patron.barcode})`;

  const loanLines = loans.length
    ? loans.map((loan, index) => {
        const title = loan.bookTitle || "Unknown title";
        return `${index + 1}. ${title} — ${loan.bookBarcode}`;
      })
    : ["No active loans."];

  const holdLines = holds.length
    ? holds.map((hold, index) => {
        const title = hold.bookTitle || "Unknown title";
        return `${index + 1}. ${title} — ${hold.bookBarcode}`;
      })
    : ["No active holds."];

  return [
    `Hello ${patronName},`,
    "",
    `Patron: ${patronLine}`,
    "",
    "Active loans:",
    ...loanLines,
    "",
    "Active holds:",
    ...holdLines,
    "",
    "Thank you,",
    "Grand Oak Athenaeum",
  ].join("\n");
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
  const text = buildReceiptText({ patron, loans, holds });

  const templateParams = {
    to_name: patron.name || "Patron",
    to_email: email,
    subject,
    message: text,
    patron_barcode: patron.barcode || "",
  };

  await window.emailjs.send(serviceId, templateId, templateParams);
}
