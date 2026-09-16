// Alarm thresholds for flagging out-of-range vital sign readings in the
// Vital Signs table -- elderly/nursing-home baseline ranges, not
// diagnosis-specific. "critical" = needs attention now (red), "warning" =
// trending out of range (amber). Anything else is normal (no flag).
export type VitalSeverity = "critical" | "warning" | null;

function classify(value: number | null, criticalLow: number, warningLow: number, warningHigh: number, criticalHigh: number): VitalSeverity {
  if (value === null) return null;
  if (value < criticalLow || value > criticalHigh) return "critical";
  if (value < warningLow || value > warningHigh) return "warning";
  return null;
}

export function flagSystolic(value: number | null): VitalSeverity {
  return classify(value, 90, 100, 160, 180);
}

export function flagDiastolic(value: number | null): VitalSeverity {
  return classify(value, 55, 60, 100, 110);
}

export function flagHeartRate(value: number | null): VitalSeverity {
  return classify(value, 45, 50, 110, 130);
}

export function flagTemperature(value: number | null): VitalSeverity {
  return classify(value, 35, 35.5, 37.9, 39);
}

// Low SpO2 only -- there's no clinically meaningful "too high" here.
export function flagSpo2(value: number | null): VitalSeverity {
  if (value === null) return null;
  if (value < 90) return "critical";
  if (value < 95) return "warning";
  return null;
}

// DXT (capillary blood glucose, mmol/L) -- hypo/hyperglycemia thresholds.
export function flagDxt(value: number | null): VitalSeverity {
  return classify(value, 3, 4, 11, 15);
}

type Vital = {
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  dxt: number | null;
};

// Row-level severity: critical if any field is critical, warning if any
// field is warning (and none critical), else null.
export function flagVital(v: Vital): VitalSeverity {
  const flags = [
    flagSystolic(v.systolic_bp),
    flagDiastolic(v.diastolic_bp),
    flagHeartRate(v.heart_rate),
    flagTemperature(v.temperature),
    flagSpo2(v.spo2),
    flagDxt(v.dxt),
  ];
  if (flags.includes("critical")) return "critical";
  if (flags.includes("warning")) return "warning";
  return null;
}

export function vitalFlagClass(severity: VitalSeverity): string {
  if (severity === "critical") return "bg-red-50 text-red-700 font-semibold";
  if (severity === "warning") return "bg-amber-50 text-amber-800 font-medium";
  return "";
}

export function vitalRowClass(severity: VitalSeverity): string {
  if (severity === "critical") return "bg-red-50/60 hover:bg-red-50";
  if (severity === "warning") return "bg-amber-50/60 hover:bg-amber-50";
  return "hover:bg-gray-50";
}
