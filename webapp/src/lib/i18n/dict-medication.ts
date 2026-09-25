// Bahasa Malaysia translations for the Medication module (orders + charts).
export const dictMedication: Record<string, string> = {
  Medication: "Ubat",
  Orders: "Pesanan",
  Charts: "Carta",
  "New Order": "Pesanan Baharu",
  "New Medication Order": "Pesanan Ubat Baharu",
  "Edit Medication Order": "Sunting Pesanan Ubat",
  "Medication Orders": "Pesanan Ubat",
  "No orders found.": "Tiada pesanan dijumpai.",
  "No orders match the current filter.": "Tiada pesanan sepadan dengan penapis semasa.",
  "Search by resident, drug...": "Cari mengikut penghuni, ubat...",
  "All statuses": "Semua status",
  order: "pesanan",
  orders: "pesanan",
  "active order": "pesanan aktif",
  "active orders": "pesanan aktif",

  // Drug info
  "Drug Information": "Maklumat Ubat",
  "Active Ingredient": "Bahan Aktif",
  "Brand Name": "Nama Jenama",
  "Dosage Form": "Bentuk Dos",
  "e.g. amlodipine 5mg": "cth. amlodipine 5mg",

  // Dosage form options
  Tablet: "Tablet",
  Capsule: "Kapsul",
  Powder: "Serbuk",
  Syrup: "Sirap",
  Cream: "Krim",
  Ointment: "Salap",
  Lotion: "Losyen",
  Gel: "Gel",
  Patch: "Tampalan",
  "Ear Drop": "Titisan Telinga",
  "Eye Drop": "Titisan Mata",
  "S/C Injection": "Suntikan S/C",
  "I/M Injection": "Suntikan I/M",
  "Neb.": "Neb.",
  Inhaler: "Penyedut",

  // Unit options
  // "Tablet" and "Capsule" covered above
  Sachet: "Saset",
  Unit: "Unit",
  Application: "Sapuan",
  Ampoule: "Ampul",
  Puff: "Puff",
  Drop: "Titisan",

  // Frequency options
  PRN: "PRN",
  EOD: "Setiap 2 Hari",
  "Every 3 Days": "Setiap 3 Hari",
  "Selected Days": "Hari Terpilih",

  // Day options
  Everyday: "Setiap Hari",
  Monday: "Isnin",
  Tuesday: "Selasa",
  Wednesday: "Rabu",
  Thursday: "Khamis",
  Friday: "Jumaat",
  Saturday: "Sabtu",
  Sunday: "Ahad",

  // Dosing
  Dosing: "Pengedosan",
  Dose: "Dos",
  Frequency: "Kekerapan",
  "Administration Times": "Masa Pentadbiran",
  "Dosing Days": "Hari Pengedosan",
  Dosage: "Dos / Ubat",
  "Not required for PRN frequency.": "Tidak diperlukan untuk kekerapan PRN.",
  "Select a frequency first.": "Pilih kekerapan dahulu.",

  // Clinical
  Indication: "Indikasi",
  Instruction: "Arahan",

  // Duration & Dates
  "Duration & Dates": "Tempoh & Tarikh",
  "Duration Type": "Jenis Tempoh",
  "Start Date": "Tarikh Mula",
  "End Date": "Tarikh Tamat",
  "Long Term": "Jangka Panjang",
  "Short Term": "Jangka Pendek",

  // Personnel
  Personnel: "Kakitangan",
  "Ordered By": "Dipesan Oleh",
  "Noted By": "Dicatatkan Oleh",
  "Supplied By": "Dibekalkan Oleh",
  "OSEM Medical Team": "Pasukan Perubatan OSEM",
  Family: "Keluarga",
  OSEM: "OSEM",
  "Select a resident first.": "Pilih penghuni dahulu.",

  // Status
  "Order Status": "Status Pesanan",
  Active: "Aktif",
  Discontinued: "Dihentikan",
  Completed: "Selesai",
  "On Hold": "Ditangguhkan",

  // Discontinue
  "Discontinue Order": "Hentikan Pesanan",
  "Are you sure you want to discontinue this order for":
    "Adakah anda pasti ingin menghentikan pesanan ini untuk",
  "This action cannot be undone.": "Tindakan ini tidak boleh dibatalkan.",
  "Confirm Discontinue": "Sahkan Penghentian",
  "Discontinuing...": "Menghentikan...",
  Discontinue: "Hentikan",

  // Reference
  Reference: "Rujukan",
  "Order ID": "ID Pesanan",
  "Previous Order ID": "ID Pesanan Sebelumnya",

  // Form actions / messages
  "Create Order": "Cipta Pesanan",
  "Save Changes": "Simpan Perubahan",
  "Save and Exit": "Simpan dan Keluar",
  // "Exit Without Saving" (exact case) is the global unsaved-changes-dialog's
  // key, owned by dict-common.ts -- don't redefine it here with different
  // wording, or whichever dict-*.ts spreads last in translations.ts wins
  // silently for the whole app, not just this module.
  "Unsaved Changes": "Perubahan Belum Disimpan",
  "You have unsaved changes. What would you like to do?":
    "Anda mempunyai perubahan yang belum disimpan. Apakah yang ingin anda lakukan?",
  "Order submitted successfully.": "Pesanan berjaya diserahkan.",
  "Redirecting...": "Mengalih hala...",
  "Edit order": "Sunting pesanan",
  "Restart order": "Mulakan semula pesanan",

  // Placeholders
  Optional: "Pilihan",
  "e.g. Atorvastatin": "cth. Atorvastatin",
  "e.g. Tablet, Syrup, Cream": "cth. Tablet, Sirap, Krim",
  "e.g. 10, 2.5, 100/45": "cth. 10, 2.5, 100/45",
  "e.g. mg, ml, mcg": "cth. mg, ml, mcg",
  "e.g. OD, BD, TDS, PRN": "cth. OD, BD, TDS, PRN",
  "e.g. 8am, 8am/8pm": "cth. 8pg, 8pg/8mlm",
  "e.g. Daily, Mon/Wed/Fri": "cth. Setiap hari, Isn/Rab/Jum",
  "e.g. Hypertension": "cth. Hipertensi",
  "e.g. Take after meal": "cth. Ambil selepas makan",
  "Search by name or ID...": "Cari mengikut nama atau ID...",
  "Others (please specify)": "Lain-lain (nyatakan)",
  "Please specify...": "Sila nyatakan...",
  "Select dosage form": "Pilih bentuk dos",
  "Select unit": "Pilih unit",
  "Select frequency": "Pilih kekerapan",

  // Table headers
  Drug: "Ubat",

  // Detail modal
  Close: "Tutup",
  Clinical: "Klinikal",

  // Coming soon
  "Coming soon.": "Akan datang.",

  // ── Stock ──────────────────────────────────────────────────────────────────
  Stock: "Stok",
  "Stock Count": "Kiraan Stok",
  "Stock Received": "Stok Diterima",
  "Order Changed": "Pesanan Diubah",
  "View History": "Lihat Sejarah",
  "Stock History": "Sejarah Stok",
  "Out of stock": "Kehabisan stok",
  "{days} days left": "Baki {days} hari",
  "Not recorded yet": "Belum direkodkan",
  Forecast: "Ramalan",
  "Last counted": "Kiraan terakhir",
  "Last counted (estimate)": "Kiraan terakhir (anggaran)",
  "Quantity received": "Kuantiti diterima",
  "Counted balance": "Baki dikira",
  "Enter only the newly received quantity. The new balance is calculated for you.": "Masukkan kuantiti yang baru diterima sahaja. Baki baharu dikira secara automatik.",
  "Enter what is physically there now. This replaces the forecast.": "Masukkan jumlah fizikal yang ada sekarang. Ini menggantikan ramalan.",
  "Countable — balance is forecast": "Boleh dikira — baki diramal",
  "Estimate — not forecast": "Anggaran — tidak diramal",
  mL: "mL",
  Bottle: "Botol",
  Tube: "Tiub",
  Jar: "Balang",
  Cannister: "Kanister",
  Pump: "Pam",
  Pen: "Pen",
  "Stock is recorded in {unit}. Use Stock Count to change the unit.": "Stok direkodkan dalam {unit}. Gunakan Kiraan Stok untuk menukar unit.",
  "Estimate units are never reduced automatically. Daily usage and days remaining show as —.": "Unit anggaran tidak dikurangkan secara automatik. Penggunaan harian dan baki hari dipaparkan sebagai —.",
  "The order is dosed in {unit}, so usage cannot be forecast in this unit.": "Pesanan didoskan dalam {unit}, jadi penggunaan tidak boleh diramal dalam unit ini.",
  "Registered By": "Didaftarkan Oleh",
  "Current balance": "Baki semasa",
  "New balance": "Baki baharu",
  "No stock records for this order yet.": "Belum ada rekod stok untuk pesanan ini.",
  "Stock Date": "Tarikh Stok",
  "Entry Type": "Jenis Entri",
  "Stock Balance": "Baki Stok",
  "Daily Usage": "Penggunaan Harian",
  "Days Remaining": "Baki Hari",
  "Daily usage and days remaining are as calculated when each entry was recorded.": "Penggunaan harian dan baki hari adalah seperti yang dikira semasa setiap entri direkodkan.",
  "Resident {n} of {total}": "Penghuni {n} daripada {total}",
  "Select a resident to review their medication stock.": "Pilih penghuni untuk menyemak stok ubat mereka.",
  "Forecast from the medication order since the last stock entry, not a physical count.": "Ramalan daripada pesanan ubat sejak entri stok terakhir, bukan kiraan fizikal.",
  "Last dose {date}": "Dos terakhir {date}",
  "Print PDF": "Cetak PDF",
  "Stock Summary": "Ringkasan Stok",
  "All medicines in one table, any supplier": "Semua ubat dalam satu jadual, mana-mana pembekal",
  "OSEM Purchase List": "Senarai Pembelian OSEM",
  "Internal: OSEM-supplied medicines to restock": "Dalaman: ubat bekalan OSEM yang perlu ditambah",
  "Family Medicine Reminder": "Peringatan Ubat Keluarga",
  "Bilingual restock notice for the family": "Notis tambah stok dwibahasa untuk keluarga",
  "Nothing to generate: this resident has no active medication orders.":
    "Tiada apa untuk dijana: penghuni ini tiada pesanan ubat aktif.",
  "Nothing to generate: this resident has no active OSEM-supplied medicine.":
    "Tiada apa untuk dijana: penghuni ini tiada ubat aktif yang dibekalkan oleh OSEM.",
  "Nothing to generate: this resident has no active family-supplied medicine.":
    "Tiada apa untuk dijana: penghuni ini tiada ubat aktif yang dibekalkan oleh keluarga.",
  "Entry Date/Time": "Tarikh/Masa Entri",
  "Change it to record a count or delivery from an earlier time.": "Ubah untuk merekod kiraan atau penerimaan pada masa yang lebih awal.",
  "Back-dated entry. {n} later entries are not recalculated.": "Entri tarikh terdahulu. {n} entri selepasnya tidak dikira semula.",
  "Back-dated entry. The balance is calculated as at this date/time.": "Entri tarikh terdahulu. Baki dikira pada tarikh/masa ini.",
  "Entry date/time cannot be in the future": "Tarikh/masa entri tidak boleh pada masa hadapan",
  "Balance at entry time": "Baki pada masa entri",
  "No doses left after today": "Tiada dos selepas hari ini",
  "Enough until order ends": "Cukup sehingga pesanan tamat",
  "Order ends {date}": "Pesanan tamat {date}",
  "No active medication orders.": "Tiada pesanan ubat aktif.",
  "Dosage / Frequency": "Dos / Kekerapan",
  "Current Balance": "Baki Semasa",
  "Last Stock Date": "Tarikh Stok Terakhir",
  "Last Registered By": "Didaftarkan Terakhir Oleh",
  "Saved to the Google Sheet. It will appear here after the automatic sync (about 1 minute).": "Disimpan ke Google Sheet. Ia akan dipaparkan di sini selepas penyegerakan automatik (kira-kira 1 minit).",
  "Stock saved.": "Stok disimpan.",
  "Family Medication Reminder": "Peringatan Ubat Keluarga",
  "Family Medication Reminder opened in a new tab.": "Peringatan Ubat Keluarga dibuka dalam tab baharu.",
  "The browser blocked the new tab. Please allow pop-ups for this site and try again.": "Pelayar menyekat tab baharu. Sila benarkan pop-up untuk laman ini dan cuba lagi.",
  Previous: "Sebelumnya",
  Next: "Seterusnya",
  HQ: "HQ",
  "A valid quantity is required": "Kuantiti yang sah diperlukan",
  "Unit is required": "Unit diperlukan",
  "Registered By is required": "Didaftarkan Oleh diperlukan",

  // Purchase (branch-wide restock order sheet)
  Purchase: "Pembelian",
  "Medication Purchase List": "Senarai Pembelian Ubat",
  "One list for the whole branch: every OSEM-supplied medicine that needs restocking, grouped by resident.":
    "Satu senarai untuk seluruh cawangan: setiap ubat bekalan OSEM yang perlu ditambah, dikelompokkan mengikut penghuni.",
  "Add another item": "Tambah item lain",
  "Select a resident…": "Pilih penghuni…",
  "Select a medicine…": "Pilih ubat…",
  "Other…": "Lain-lain…",
  "Item name": "Nama item",
  "Enter the medicine name…": "Masukkan nama ubat…",
  "Every item must be assigned to one resident before it can be added.":
    "Setiap item mesti diberikan kepada seorang penghuni sebelum ia boleh ditambah.",
  "Reset review": "Set semula semakan",
  "Generate purchase list PDF": "Jana PDF senarai pembelian",
  "Review reset to the calculated values.": "Semakan diset semula kepada nilai yang dikira.",
  "Purchase list downloaded.": "Senarai pembelian telah dimuat turun.",
  "Could not generate the PDF.": "Tidak dapat menjana PDF.",
  "There is nothing to generate.": "Tiada apa untuk dijana.",
  "No medicine needs restocking at this branch right now.":
    "Tiada ubat yang perlu ditambah di cawangan ini buat masa ini.",
  "Added manually": "Ditambah secara manual",
  "Reset to calculated": "Set semula kepada nilai kira",
  "Not forecast": "Tiada ramalan",
  items: "item",
  residents: "penghuni",
  units: "unit",
  "units to order": "unit untuk ditempah",
  "Nothing to generate: there are no items to order.":
    "Tiada apa untuk dijana: tiada item untuk ditempah.",
  "Countable balances are forecasts from the prescription since the last stock count, not a physical count. Editing here does not change any stock record.":
    "Baki yang dikira ialah ramalan daripada preskripsi sejak kiraan stok terakhir, bukan kiraan fizikal. Suntingan di sini tidak mengubah sebarang rekod stok.",
};
