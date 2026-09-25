function getMedicationPriority(dosageForm, frequency) {

  dosageForm = String(dosageForm || "").trim().toUpperCase();
  frequency = String(frequency || "").trim().toUpperCase();

  //-------------------------------------------------
  // PRN always last
  //-------------------------------------------------

  if (
    frequency.includes("PRN") ||
    frequency.includes("WHEN REQUIRED")
  ) {
    return {
      section: "PRN MEDICATION",
      priority: 900
    };
  }

  //-------------------------------------------------
  // External Medicines
  //-------------------------------------------------

  if (
    [
      "CREAM",
      "OINTMENT",
      "GEL",
      "LOTION",
      "PATCH",
      "SPRAY"
    ].includes(dosageForm)
  ) {

    return {
      section: "EXTERNAL MEDICATION",
      priority: 300
    };

  }

  //-------------------------------------------------
  // Eye / Ear / Nose
  //-------------------------------------------------

  if (
    dosageForm.includes("EYE") ||
    dosageForm.includes("EAR") ||
    dosageForm.includes("NASAL")
  ) {

    return {
      section: "EYE / EAR / NASAL",
      priority: 400
    };

  }

  //-------------------------------------------------
  // Inhalers
  //-------------------------------------------------

  if (
    dosageForm.includes("INHAL") ||
    dosageForm.includes("TURBUHALER") ||
    dosageForm.includes("RESPIMAT") ||
    dosageForm.includes("NEB")
  ) {

    return {
      section: "INHALATION",
      priority: 500
    };

  }

  //-------------------------------------------------
  // Injection
  //-------------------------------------------------

  if (
    dosageForm.includes("INJECTION") ||
    dosageForm == "SC" ||
    dosageForm == "IM" ||
    dosageForm == "IV"
  ) {

    return {
      section: "INJECTION",
      priority: 600
    };

  }

  //-------------------------------------------------
  // Oral Medication
  //-------------------------------------------------

  let freqPriority = 50;

  switch (frequency) {

    case "OD":
    case "OM":
      freqPriority = 10;
      break;

    case "BD":
      freqPriority = 20;
      break;

    case "TDS":
      freqPriority = 30;
      break;

    case "QID":
      freqPriority = 40;
      break;

    case "EOD":
      freqPriority = 45;
      break;

    case "ON":
      freqPriority = 60;
      break;

  }

  return {

    section: "REGULAR MEDICATION",

    priority: freqPriority

  };

}

