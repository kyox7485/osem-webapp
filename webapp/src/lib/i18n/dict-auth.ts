// Bahasa Malaysia translations for the login / forgot-password /
// reset-password flow. The resident-scoped Medical Progress Notes module
// (residents/[id]/progress-notes) reuses the same clinical vocabulary as
// the main Clinical module, so those strings live in dict-clinical.ts --
// keeping a second copy here previously let this file's wording drift out
// of sync with it. English text is the key -- see translate.ts. Strings
// already covered by dict-common.ts are not repeated here.
export const dictAuth: Record<string, string> = {
  // Login page
  "Sign in with your branch account": "Log masuk dengan akaun cawangan anda",
  Email: "E-mel",
  Password: "Kata laluan",
  "Signing in...": "Sedang log masuk...",
  "Sign in": "Log masuk",
  "Forgot password?": "Lupa kata laluan?",

  // Forgot password page
  "Reset your password": "Tetapkan semula kata laluan anda",
  "Enter your account email and we'll send you a reset link.":
    "Masukkan e-mel akaun anda dan kami akan menghantar pautan tetapan semula.",
  "Check your email for a link to reset your password.":
    "Semak e-mel anda untuk pautan menetapkan semula kata laluan.",
  "Back to sign in": "Kembali ke log masuk",
  "Sending...": "Menghantar...",
  "Send reset link": "Hantar pautan tetapan semula",

  // Reset password page
  "This invite/reset link is invalid or has expired. Request a new one.":
    "Pautan jemputan/tetapan semula ini tidak sah atau telah tamat tempoh. Minta pautan baharu.",
  "This reset link is invalid or has expired. Request a new one from the login page.":
    "Pautan tetapan semula ini tidak sah atau telah tamat tempoh. Minta pautan baharu daripada halaman log masuk.",
  "Password must be at least 6 characters.": "Kata laluan mesti sekurang-kurangnya 6 aksara.",
  "Passwords don't match.": "Kata laluan tidak sepadan.",
  "Set a new password": "Tetapkan kata laluan baharu",
  "Password updated. Redirecting...": "Kata laluan telah dikemas kini. Mengalihkan...",
  "Checking your reset link...": "Menyemak pautan tetapan semula anda...",
  "New password": "Kata laluan baharu",
  "Confirm password": "Sahkan kata laluan",
  "Set new password": "Tetapkan kata laluan baharu",
};
