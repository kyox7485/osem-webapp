// Bahasa Malaysia translations for the global nav/header, sign-in flow, and
// other strings shared across every page (buttons, generic labels).
// English text is the key -- see translate.ts.
export const dictCommon: Record<string, string> = {
  // Nav
  Residents: "Penghuni",
  Clinical: "Klinikal",
  Physiotherapy: "Fisioterapi",
  Staff: "Kakitangan",
  Accounts: "Akaun",
  "Sign out": "Log keluar",
  "All branches": "Semua cawangan",
  "OSEM home": "Laman utama OSEM",

  // Account-not-linked screen
  "Account not set up": "Akaun belum disediakan",
  "You're signed in, but this login isn't linked to a user account yet. Ask an admin to add you under Accounts, then sign out and back in.":
    "Anda telah log masuk, tetapi log masuk ini belum dikaitkan dengan akaun pengguna. Minta pentadbir menambah anda di bawah Akaun, kemudian log keluar dan log masuk semula.",

  // Common buttons / states used across many forms
  Save: "Simpan",
  Cancel: "Batal",
  Clear: "Kosongkan",
  Saving: "Menyimpan",
  "Saving...": "Menyimpan...",
  Edit: "Sunting",
  Delete: "Padam",
  Add: "Tambah",
  Remove: "Buang",
  Back: "Kembali",
  Print: "Cetak",
  Close: "Tutup",
  Loading: "Memuatkan",
  "Loading...": "Memuatkan...",
  Search: "Cari",
  Filter: "Tapis",
  Actions: "Tindakan",
  Status: "Status",
  Active: "Aktif",
  Inactive: "Tidak aktif",
  Yes: "Ya",
  No: "Tidak",
  "--": "--",
  "All residents": "Semua penghuni",
  "Select resident": "Pilih penghuni",
  "Select staff": "Pilih kakitangan",
  Resident: "Penghuni",
  "Start date": "Tarikh mula",
  "End date": "Tarikh tamat",
  "Click to view": "Klik untuk lihat",
  PDF: "PDF",

  // Language switcher itself -- option text is language names, shown as-is
  // regardless of current language, so not run through t().
  Language: "Bahasa",

  // Header theme toggle + sidebar rail
  Theme: "Tema",
  "Theme: {mode}": "Tema: {mode}",
  Light: "Cerah",
  Dark: "Gelap",
  System: "Sistem",
  "Collapse sidebar": "Kecilkan bar sisi",
  "Expand sidebar": "Kembangkan bar sisi",

  // Unsaved-changes guard dialog
  "Unsaved changes": "Perubahan belum disimpan",
  "You have unsaved changes. What would you like to do?":
    "Anda mempunyai perubahan yang belum disimpan. Apa yang anda ingin lakukan?",
  "Exit Without Saving": "Keluar Tanpa Menyimpan",
  "Save & Exit": "Simpan & Keluar",
  "Failed to save changes": "Gagal menyimpan perubahan",
  "Save failed. Please try again.": "Simpan gagal. Sila cuba lagi.",
  "This form can't be saved automatically.": "Borang ini tidak boleh disimpan secara automatik.",
};
