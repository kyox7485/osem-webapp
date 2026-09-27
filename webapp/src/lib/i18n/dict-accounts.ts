// Bahasa Malaysia translations for the Accounts admin screens
// (list, new, view, edit, account form, set-password form).
// English text is the key -- see translate.ts.
// Strings already covered by dict-common.ts (Save, Cancel, Edit, Status,
// --, etc.) are NOT repeated here.
export const dictAccounts: Record<string, string> = {
  Accounts: "Akaun",
  "Who can log in, and what they can do -- separate from the staff roster.":
    "Siapa yang boleh log masuk, dan apa yang mereka boleh lakukan -- berasingan daripada senarai kakitangan.",
  "New account": "Akaun baharu",
  Username: "Nama pengguna",
  Branch: "Cawangan",
  Rights: "Hak akses",

  "Creating this sends an email invite so the person sets their own password.":
    "Membuat akaun ini akan menghantar jemputan e-mel supaya orang itu menetapkan kata laluan sendiri.",
  "Select a branch": "Pilih cawangan",
  "Select rights": "Pilih hak akses",
  "Save changes": "Simpan perubahan",
  "Create account & send invite": "Cipta akaun & hantar jemputan",

  // Rights levels (RIGHTS_OPTIONS literal values). The stored value stays
  // English in the database forever -- only these display labels change.
  // Title case rather than ALL-CAPS so the three read as a set, and so
  // "MODERATOR" no longer shows untranslated.
  ADMIN: "Pentadbir",
  MODERATOR: "Moderator",
  STAFF: "Kakitangan",

  // Status values (STAFF_STATUS_OPTIONS literal values) -- same title-case
  // treatment as the rights levels above.
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",

  // Set password form
  "Set new password": "Tetapkan kata laluan baharu",
  "Sets it directly -- no email involved. Not stored anywhere; tell the person once.":
    "Menetapkannya secara terus -- tanpa e-mel. Tidak disimpan di mana-mana; beritahu orang itu sekali sahaja.",
  "New password (min 6 characters)": "Kata laluan baharu (minimum 6 aksara)",
  "Password updated.": "Kata laluan telah dikemas kini.",
  "Set password": "Tetapkan kata laluan",

  // Accounts list -- edit dialog
  "Edit account": "Sunting akaun",
  "Edit account information for": "Sunting maklumat akaun untuk",
};
