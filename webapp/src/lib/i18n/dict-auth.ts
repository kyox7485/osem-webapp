// Bahasa Malaysia translations for the login / forgot-password /
// reset-password flow, and the resident-scoped Medical Progress Notes
// module under residents/[id]/progress-notes. English text is the key --
// see translate.ts. Strings already covered by dict-common.ts are not
// repeated here.
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

  // Progress Notes (resident-scoped) page
  Unknown: "Tidak diketahui",
  "Medical Progress Notes": "Nota Perkembangan Perubatan",
  "Review notes": "Semak nota",
  "New entry": "Entri baharu",
  "Medical plan": "Pelan perubatan",
  "Nursing plan": "Pelan kejururawatan",
  "No progress notes yet.": "Belum ada nota perkembangan.",

  // Resident dashboard panel
  "Medical / surgical history": "Sejarah perubatan / pembedahan",
  "Current medication list": "Senarai ubat semasa",
  "Known allergy": "Alahan diketahui",
  "TCA notes": "Nota TCA",
  "Recent vitals": "Vital terkini",
  "No vitals recorded yet.": "Belum ada vital direkodkan.",
  Date: "Tarikh",
  BP: "BP",
  HR: "HR",
  Temp: "Suhu",
  SpO2: "SpO2",
  "Last ordered plans": "Pelan terakhir ditetapkan",
  "Medical / treatment plan": "Pelan perubatan / rawatan",
  "Diet plan": "Pelan diet",
  "Dressing plan": "Pelan pembalutan",
  "Monitoring plan": "Pelan pemantauan",
  "Physio plan": "Pelan fisioterapi",
  "None recorded.": "Tiada direkodkan.",
  "No entry yet": "Belum ada entri",

  // New note form
  "Progress note": "Nota perkembangan",
  "Physical examination": "Pemeriksaan fizikal",
  "Feeding plan": "Pelan pemakanan",
  "Entered by": "Dimasukkan oleh",
  "Select who's entering this": "Pilih siapa yang memasukkan ini",
};
