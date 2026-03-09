import { setFeedbackMessage } from "./shared.js";

export function createLoginView({ onSubmit, onGuestSubmit }) {
  const root = document.getElementById("login-panel");
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const submitButton = document.getElementById("login-submit");
  const guestButton = document.getElementById("guest-submit");
  const feedback = document.getElementById("login-feedback");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onSubmit({
      email: emailInput.value,
      password: passwordInput.value,
    });
  });

  guestButton.addEventListener("click", async () => {
    await onGuestSubmit();
  });

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    focus() {
      emailInput.focus();
    },
    resetPassword() {
      passwordInput.value = "";
    },
    setPending(isPending) {
      submitButton.disabled = isPending;
      guestButton.disabled = isPending;
      emailInput.disabled = isPending;
      passwordInput.disabled = isPending;
      submitButton.textContent = isPending ? "Signing in..." : "Sign in";
      guestButton.textContent = isPending ? "Please wait..." : "Continue as guest";
    },
    setMessage(kind, message) {
      setFeedbackMessage(feedback, kind, message);
    },
    disableForSetup(message) {
      emailInput.disabled = true;
      passwordInput.disabled = true;
      submitButton.disabled = true;
      guestButton.disabled = true;
      submitButton.textContent = "Sign in";
      guestButton.textContent = "Continue as guest";
      setFeedbackMessage(feedback, "info", message);
    },
  };
}
