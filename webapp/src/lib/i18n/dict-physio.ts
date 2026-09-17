// Bahasa Malaysia translations for the Physiotherapy module (inpatient +
// outpatient assessment forms, review notes, body chart, and scoring
// sections). English text is the key -- see translate.ts. Strings already
// covered by dict-common.ts (e.g. "Cancel", "Resident", "Select staff",
// "Saving...", "Remove") are not repeated here.
export const dictPhysio: Record<string, string> = {
  // page.tsx
  Patient: "Pesakit",
  "not found.": "tidak dijumpai.",
  "Access denied.": "Akses ditolak.",

  // assessment-review.tsx
  "No physiotherapy assessments yet.": "Belum ada penilaian fisioterapi.",
  "Documented by": "Didokumenkan oleh",
  Score: "Skor",
  "Current History": "Sejarah Semasa",
  "Past Medical History": "Sejarah Perubatan Lampau",
  "Social History": "Sejarah Sosial",
  "Body Chart Findings": "Dapatan Carta Badan",
  "Physical Examination": "Pemeriksaan Fizikal",
  Power: "Kekuatan",
  Tone: "Tonus",
  ROM: "Julat Gerakan",
  Reflexes: "Refleks",
  "Impression / Analysis": "Impresi / Analisis",
  "Plan & Intervention": "Pelan & Intervensi",
  Evaluation: "Penilaian",
  "Treatment Compliance": "Pematuhan Rawatan",

  // assessment-tabs.tsx
  "Review Notes": "Semak Nota",
  "New Entry": "Entri Baharu",
  "Select a": "Pilih",
  patient: "pesakit",
  resident: "penduduk",
  "above to add a new entry.": "di atas untuk menambah entri baharu.",

  // body-diagram.tsx -- anatomical hotspot labels
  "Body chart (front, side and back views)": "Carta badan (pandangan hadapan, sisi dan belakang)",
  Head: "Kepala",
  Neck: "Leher",
  "Right Shoulder": "Bahu Kanan",
  "Left Shoulder": "Bahu Kiri",
  Chest: "Dada",
  "Right Upper Arm": "Lengan Atas Kanan",
  "Left Upper Arm": "Lengan Atas Kiri",
  Abdomen: "Abdomen",
  "Right Elbow": "Siku Kanan",
  "Left Elbow": "Siku Kiri",
  "Right Hip": "Pinggul Kanan",
  "Left Hip": "Pinggul Kiri",
  "Right Forearm": "Lengan Bawah Kanan",
  "Left Forearm": "Lengan Bawah Kiri",
  "Right Hand": "Tangan Kanan",
  "Left Hand": "Tangan Kiri",
  "Right Thigh": "Peha Kanan",
  "Left Thigh": "Peha Kiri",
  "Right Knee": "Lutut Kanan",
  "Left Knee": "Lutut Kiri",
  "Right Lower Leg": "Betis Kanan",
  "Left Lower Leg": "Betis Kiri",
  "Right Ankle": "Buku Lali Kanan",
  "Left Ankle": "Buku Lali Kiri",
  "Right Foot": "Kaki Kanan",
  "Left Foot": "Kaki Kiri",
  "Upper Back": "Belakang Atas",
  "Lower Back": "Belakang Bawah",
  "Right Shoulder (Back)": "Bahu Kanan (Belakang)",
  "Left Shoulder (Back)": "Bahu Kiri (Belakang)",
  "Right Elbow (Back)": "Siku Kanan (Belakang)",
  "Left Elbow (Back)": "Siku Kiri (Belakang)",
  "Right Hip (Back)": "Pinggul Kanan (Belakang)",
  "Left Hip (Back)": "Pinggul Kiri (Belakang)",
  "Right Knee (Back)": "Lutut Kanan (Belakang)",
  "Left Knee (Back)": "Lutut Kiri (Belakang)",
  "Right Ankle (Back)": "Buku Lali Kanan (Belakang)",
  "Left Ankle (Back)": "Buku Lali Kiri (Belakang)",
  "Right Shoulder (Side)": "Bahu Kanan (Sisi)",
  "Left Shoulder (Side)": "Bahu Kiri (Sisi)",
  "Right Elbow (Side)": "Siku Kanan (Sisi)",
  "Left Elbow (Side)": "Siku Kiri (Sisi)",
  "Right Hand (Side)": "Tangan Kanan (Sisi)",
  "Left Hand (Side)": "Tangan Kiri (Sisi)",
  "Right Hip (Side)": "Pinggul Kanan (Sisi)",
  "Left Hip (Side)": "Pinggul Kiri (Sisi)",
  "Right Knee (Side)": "Lutut Kanan (Sisi)",
  "Left Knee (Side)": "Lutut Kiri (Sisi)",
  "Right Ankle (Side)": "Buku Lali Kanan (Sisi)",
  "Left Ankle (Side)": "Buku Lali Kiri (Sisi)",

  // care-setting-tabs.tsx
  Inpatient: "Pesakit Dalam",
  Outpatient: "Pesakit Luar",

  // new-op-patient-form.tsx
  "Patient name is required": "Nama pesakit diperlukan",
  "Failed to register patient": "Gagal mendaftarkan pesakit",
  "New patient": "Pesakit baharu",
  "Register new outpatient": "Daftar pesakit luar baharu",
  "Patient name": "Nama pesakit",
  "IC number": "Nombor IC",
  Age: "Umur",
  Gender: "Jantina",
  Contact: "Hubungan",
  "Registering...": "Mendaftar...",
  "Register patient": "Daftar pesakit",

  // new-physio-assessment-form.tsx
  "Please select who documented this assessment": "Sila pilih siapa yang mendokumenkan penilaian ini",
  "Failed to save assessment": "Gagal menyimpan penilaian",
  "Save Assessment": "Simpan Penilaian",

  // resident-picker.tsx
  "Couldn't save the current assessment. Fix the error above, or discard your changes to switch anyway.":
    "Tidak dapat menyimpan penilaian semasa. Betulkan ralat di atas, atau buang perubahan anda untuk bertukar juga.",
  Select: "Pilih",
  "Unsaved changes": "Perubahan belum disimpan",
  "This assessment has unsaved changes. Save it before switching":
    "Penilaian ini mempunyai perubahan yang belum disimpan. Simpan sebelum bertukar",
  "Discard changes": "Buang perubahan",
  "Save & switch": "Simpan & tukar",

  // score-select.tsx
  "Not assessed": "Belum dinilai",

  // sections/balance-section.tsx
  Balance: "Keseimbangan",
  assessed: "dinilai",
  "Sitting - Static": "Duduk - Statik",
  "Sitting - Dynamic": "Duduk - Dinamik",
  "Standing - Static": "Berdiri - Statik",
  "Standing - Dynamic": "Berdiri - Dinamik",

  // sections/body-chart-section.tsx
  "Body Chart / Anatomical Findings": "Carta Badan / Dapatan Anatomi",
  findings: "dapatan",
  finding: "dapatan",
  "Tap a point on the diagram to add a finding": "Ketik satu titik pada gambar rajah untuk menambah dapatan",
  "Finding / comment...": "Dapatan / komen...",
  "Add finding": "Tambah dapatan",
  "Recorded findings": "Dapatan yang direkodkan",
  "No findings recorded yet.": "Belum ada dapatan direkodkan.",

  // sections/compliance-signoff.tsx
  "Treatment Compliance & Documentation": "Pematuhan Rawatan & Dokumentasi",
  "Treatment Compliance & Completion": "Pematuhan & Penyelesaian Rawatan",
  "Select compliance": "Pilih pematuhan",
  "Documented By": "Didokumenkan Oleh",

  // sections/coordination-section.tsx
  Coordination: "Koordinasi",
  "Upper Limb": "Anggota Atas",
  "Lower Limb": "Anggota Bawah",
  Right: "Kanan",
  Left: "Kiri",

  // sections/examination-section.tsx
  'Power, Tone, ROM and Reflexes -- leave any field "Not assessed" where not applicable. Tap a body part to record it.':
    "Kekuatan, Tonus, Julat Gerakan dan Refleks -- biarkan mana-mana medan \"Belum dinilai\" jika tidak berkenaan. Ketik bahagian badan untuk merekodkannya.",

  // sections/functional-section.tsx
  "Functional Assessment": "Penilaian Fungsian",
  "Supine → Side lying": "Melentang → Mengiring",
  "Side lying → Sitting": "Mengiring → Duduk",
  "Sitting → Standing": "Duduk → Berdiri",
  "Sit at edge of bed": "Duduk di tepi katil",
  Ambulation: "Ambulasi",

  // sections/narrative-section.tsx
  "Physiotherapist impression / analysis...": "Impresi / analisis ahli fisioterapi...",

  // sections/resident-info-section.tsx
  "Assessment Information": "Maklumat Penilaian",
  Date: "Tarikh",
  "Type of Treatment": "Jenis Rawatan",
  "Select treatment type": "Pilih jenis rawatan",
  "Credit Hours": "Jam Kredit",

  // sections/score-summary.tsx
  "Score Summary": "Ringkasan Skor",
  "Current Score": "Skor Semasa",
  "Previous Score": "Skor Sebelumnya",

  // sections/subjective-section.tsx
  "Subjective Assessment": "Penilaian Subjektif",
  "Chief Complaint": "Aduan Utama",
  "from resident record": "daripada rekod penduduk",
};
