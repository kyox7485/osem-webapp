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
  "Out of stock": "Stok habis",
  days: "hari",
  "{days} days left": "Baki {days} hari",
  "Not recorded yet": "Belum direkodkan",
  Forecast: "Jangkaan",
  "Last counted": "Kiraan terakhir",
  "Last counted (estimate)": "Anggaran terakhir",
  "Quantity received": "Kuantiti diterima",
  "Counted balance": "Baki sebenar",
  "Enter only the newly received quantity. The new balance is calculated for you.": "Masukkan kuantiti yang baru diterima sahaja. Baki baharu akan dikira secara automatik.",
  "Enter what is physically there now. This replaces the forecast.": "Masukkan jumlah sebenar yang ada sekarang. Ini akan menggantikan jangkaan.",
  "Countable — balance is forecast": "Boleh dikira — baki dijangkakan",
  "Estimate — not forecast": "Anggaran — tidak dijangkakan",
  mL: "mL",
  Bottle: "Botol",
  Tube: "Tiub",
  Jar: "Balang",
  Cannister: "Kanister",
  Pump: "Pam",
  Pen: "Pen",
  "Stock is recorded in {unit}. Use Stock Count to change the unit.": "Stok direkodkan dalam {unit}. Gunakan Kiraan Stok untuk tukar unit.",
  "Estimate units are never reduced automatically. Daily usage and days remaining show as —.": "Unit anggaran tidak dikurangkan secara automatik. Penggunaan harian dan baki hari akan ditunjukkan sebagai —.",
  "The order is dosed in {unit}, so usage cannot be forecast in this unit.": "Pesanan ini menggunakan dos dalam {unit}, jadi penggunaan tidak boleh dijangkakan dalam unit ini.",
  "Registered By": "Direkodkan Oleh",
  "Current balance": "Baki semasa",
  "New balance": "Baki baharu",
  "No stock records for this order yet.": "Tiada rekod stok untuk pesanan ini lagi.",
  "Stock Date": "Tarikh Stok",
  "Entry Type": "Jenis Rekod",
  "Stock Balance": "Baki Stok",
  "Daily Usage": "Penggunaan Harian",
  "Days Remaining": "Baki Hari",
  "Daily usage and days remaining are as calculated when each entry was recorded.": "Penggunaan harian dan baki hari adalah mengikut kiraan pada masa rekod didaftarkan.",
  "Resident {n} of {total}": "Penghuni {n} daripada {total}",
  "Select a resident to review their medication stock.": "Pilih penghuni untuk semak stok ubat mereka.",
  "Forecast from the medication order since the last stock entry, not a physical count.": "Jangkaan berdasarkan pesanan ubat sejak rekod stok terakhir, bukan kiraan sebenar.",
  "Last dose {date}": "Dos terakhir {date}",
  "Print PDF": "Cetak PDF",
  "Stock Summary": "Ringkasan Stok",
  "All medicines in one table, any supplier": "Semua ubat dalam satu jadual, mana-mana pembekal",
  "OSEM Purchase List": "Senarai Pembelian OSEM",
  "Internal: OSEM-supplied medicines to restock": "Dalaman: ubat bekalan OSEM yang perlu ditambah",
  "Family Medicine Reminder": "Peringatan Ubat Keluarga",
  "Bilingual restock notice for the family": "Notis tambah stok dwibahasa untuk keluarga",
  "Nothing to generate: this resident has no active medication orders.":
    "Tiada rekod untuk dijana: penghuni ini tidak mempunyai pesanan ubat yang aktif.",
  "Nothing to generate: this resident has no active OSEM-supplied medicine.":
    "Tiada rekod untuk dijana: penghuni ini tidak mempunyai ubat aktif yang dibekalkan OSEM.",
  "Nothing to generate: this resident has no active family-supplied medicine.":
    "Tiada rekod untuk dijana: penghuni ini tidak mempunyai ubat aktif yang dibekalkan keluarga.",
  "Entry Date/Time": "Tarikh/Masa Rekod",
  "Change it to record a count or delivery from an earlier time.": "Ubah untuk masukkan kiraan atau penghantaran pada tarikh/masa yang lebih awal.",
  "Back-dated entry. {n} later entries are not recalculated.": "Rekod bertarikh lampau. {n} rekod yang lebih baru tidak dikira semula.",
  "Back-dated entry. The balance is calculated as at this date/time.": "Rekod bertarikh lampau. Baki dikira berdasarkan tarikh/masa ini.",
  "Entry date/time cannot be in the future": "Tarikh/masa rekod tidak boleh melebihi masa sekarang",
  "Balance at entry time": "Baki pada masa rekod",
  "No doses left after today": "Stok akan habis selepas hari ini",
  "Enough until order ends": "Cukup sehingga pesanan tamat",
  "Order ends {date}": "Pesanan tamat {date}",
  "No active medication orders.": "Tiada pesanan ubat aktif.",
  "Dosage / Frequency": "Dos / Kekerapan",
  "Current Balance": "Baki Semasa",
  "Last Stock Date": "Tarikh Stok Terakhir",
  "Last Registered By": "Didaftarkan Terakhir Oleh",
  "Saved to the Google Sheet. It will appear here after the automatic sync (about 1 minute).": "Disimpan ke Google Sheet. Ia akan dipaparkan di sini selepas penyegerakan automatik (lebih kurang 1 minit).",
  "Stock saved.": "Stok disimpan.",
  "Family Medication Reminder": "Peringatan Ubat Keluarga",
  "Family Medication Reminder opened in a new tab.": "Peringatan Ubat Keluarga dibuka dalam tab baharu.",
  "The browser blocked the new tab. Please allow pop-ups for this site and try again.": "Pelayar menyekat tab baharu. Sila benarkan pop-up untuk laman ini dan cuba lagi.",
  Previous: "Sebelumnya",
  Next: "Seterusnya",
  HQ: "HQ",
  "A valid quantity is required": "Sila masukkan kuantiti yang sah",
  "Unit is required": "Sila pilih unit",
  "Registered By is required": "Sila pilih nama petugas yang mendaftarkan",

  // Purchase (branch-wide restock order sheet)
  Purchase: "Pembelian",
  "Medication Purchase List": "Senarai Pembelian Ubat",
  "One list for the whole branch: every OSEM-supplied medicine that needs restocking, grouped by resident.":
    "Satu senarai untuk seluruh cawangan: semua ubat bekalan OSEM yang perlu ditambah stok, disusun mengikut penghuni.",
  "Add another item": "Tambah item lain",
  "Select a resident…": "Pilih penghuni…",
  "Select a medicine…": "Pilih ubat…",
  "Other…": "Lain-lain…",
  "Item name": "Nama item",
  "Enter the medicine name…": "Masukkan nama ubat…",
  "Every item must be assigned to one resident before it can be added.":
    "Setiap item mesti diberikan kepada seorang penghuni sebelum ia boleh ditambah.",
  "Reset review": "Tetapkan semula semakan",
  "Generate purchase list PDF": "Jana PDF senarai pembelian",
  "Review reset to the calculated values.": "Semakan telah ditetapkan semula kepada nilai yang dikira.",
  "Purchase list downloaded.": "Senarai pembelian telah dimuat turun.",
  "Could not generate the PDF.": "Tidak dapat menjana PDF.",
  "There is nothing to generate.": "Tiada apa untuk dijana.",
  "No medicine needs restocking at this branch right now.":
    "Tiada ubat yang perlu ditambah stok di cawangan ini buat masa ini.",
  "Could not load the purchase list for this branch.":
    "Senarai pembelian untuk cawangan ini tidak dapat dimuatkan.",
  "Please select the staff member who prepared this list.":
    "Sila pilih petugas yang menyediakan senarai ini.",
  "Prepared By": "Disediakan Oleh",
  "This medicine is already on the purchase list.":
    "Ubat ini sudah ada dalam senarai pembelian.",
  "e.g. 1 Tablet twice daily": "cth. 1 Tablet dua kali sehari",
  "Balance adjusted": "Baki diselaraskan",
  "Added manually": "Ditambah secara manual",
  "Reset to calculated": "Set semula kepada nilai kira",
  "Not forecast": "Tiada ramalan",
  items: "item",
  residents: "penghuni",
  units: "unit",
  "units to order": "unit untuk ditempah",
  "Nothing to generate: there are no items to order.":
    "Tiada rekod untuk dijana: tiada item yang perlu ditempah.",
  "Countable balances are forecasts from the prescription since the last stock count, not a physical count. Editing here does not change any stock record.":
    "Baki yang boleh dikira adalah jangkaan berdasarkan preskripsi sejak kiraan stok terakhir, bukan kiraan sebenar. Perubahan di sini tidak akan mengubah mana-mana rekod stok.",
};
