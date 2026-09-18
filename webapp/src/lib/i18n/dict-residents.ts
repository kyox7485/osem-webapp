// Bahasa Malaysia translations for the Residents module (list, view, new,
// edit pages and the shared resident form). English text is the key -- see
// translate.ts. Strings already covered by dict-common.ts (e.g. "Residents",
// "Edit", "Back", "Filter", "Clear", "Status", "--") are not repeated here.
export const dictResidents: Record<string, string> = {
  "New resident": "Penghuni baharu",
  "No residents found.": "Tiada penghuni dijumpai.",
  Name: "Nama",
  IC: "No. KP",
  "Search by name...": "Cari mengikut nama...",
  "Search by IC...": "Cari mengikut No. KP...",
  Branch: "Cawangan",
  // RESIDENT_STATUS_OPTIONS -- ACTIVE already covered by dict-accounts.ts's
  // shared "ACTIVE" key.
  DISCHARGED: "Discaj",
  DECEASED: "Meninggal Dunia",
  "TRANSFERRED OUT": "Dipindah Keluar",

  "Basic details": "Butiran asas",
  "Resident ID": "ID Penghuni",
  "IC number": "Nombor KP",
  "Passport No.": "No. Pasport",
  Age: "Umur",
  Gender: "Jantina",
  "Marital status": "Status perkahwinan",
  // MARITAL_STATUS_OPTIONS (src/lib/types.ts) has "Windowed" instead of
  // "Widowed" -- looks like a source typo, not something to silently
  // "fix" here since it'd break any resident row already storing that
  // exact string. Translated by its clear intended meaning instead.
  Single: "Bujang",
  Married: "Berkahwin",
  Windowed: "Balu / Duda",
  Divorced: "Bercerai",
  Nationality: "Kewarganegaraan",

  Admission: "Kemasukan",
  "Care type": "Jenis penjagaan",
  "24-Hour Care": "Penjagaan 24 Jam",
  Daycare: "Jagaan Harian",
  "Admission date": "Tarikh kemasukan",
  "Discharge date": "Tarikh discaj",
  "Transfer from": "Dipindahkan dari",
  Home: "Rumah",
  Hospital: "Hospital",
  "Nursing Home": "Rumah Jagaan",
  Others: "Lain-lain",
  "Accompanied by": "Ditemani oleh",
  Self: "Sendiri",
  Family: "Keluarga",
  Friends: "Rakan",
  "Social Worker": "Pekerja Sosial",
  Paramedic: "Paramedik",
  "Emergency contact": "Kenalan kecemasan",

  Care: "Penjagaan",
  Mobility: "Mobiliti",
  "Walking Independent": "Berjalan Berdikari",
  "Walking Aid": "Bantuan Berjalan",
  Wheelchair: "Kerusi Roda",
  Bedbound: "Terlantar di Katil",
  Hygiene: "Kebersihan",
  "Self Toileting": "Tandas Sendiri",
  Urinal: "Bekas Kencing",
  Bedpan: "Bedpan",
  "Commode Chair": "Kerusi Tandas",
  Pampers: "Lampin Pakai Buang",
  "Diet type": "Jenis diet",
  "Feeding type": "Jenis pemakanan",

  "Clinical notes": "Nota klinikal",
  Allergy: "Alahan",
  "Past medical condition": "Sejarah perubatan lampau",
  "Assessment and summary": "Penilaian dan ringkasan",
  "Current medication list": "Senarai ubat semasa",
  "TCA notes": "Nota TCA",

  "Select a branch": "Pilih cawangan",
  "e.g. Jasmin (Daughter) - 012-4948717": "cth. Jasmin (Anak perempuan) - 012-4948717",
  "e.g. MOPD 1/12/2026, SOPD 21/11/2026": "cth. MOPD 1/12/2026, SOPD 21/11/2026",

  "Reviewed by": "Disemak oleh",
  "Select a branch first": "Pilih cawangan dahulu",

  "Save changes": "Simpan perubahan",
  "Create resident": "Cipta penghuni",
  // "Guna pakai" is a formal/legalistic phrase (as in "guna pakai polisi") --
  // too stiff for a plain filter-apply button. "Guna" alone is the
  // everyday word Malaysian apps use here.
  Apply: "Guna",
};
