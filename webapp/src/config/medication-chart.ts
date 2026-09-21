// Public URL for the medication-chart Google Apps Script Web App.
// This is a deployed, public /exec endpoint — not a secret.
// It is safe to import into client components and construct URLs in the browser.
// The actual chart generation happens entirely inside the Apps Script; the web
// app only builds the URL and opens it in a new tab.
export const MEDICATION_CHART_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyBJUE80EEurezlNKhMA_hz_73epFHO7FLSwXuX-5DzFhsAeTtia45oMnY4uvZS9or1tQ/exec";
