// Malaysian IC numbers (MyKad) encode date of birth as the first 6 digits,
// YYMMDD. There's no century digit, so it has to be inferred: MyKad only
// started issuing in the 1990s, so a YY greater than the current two-digit
// year is assumed 19YY, otherwise 20YY (e.g. "00" -> 2000, not 1900).
export function ageFromMalaysianIC(icNumber: string, today: Date = new Date()): number | null {
  const digits = icNumber.replace(/\D/g, "");
  if (digits.length < 6) return null;

  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const currentYearShort = today.getFullYear() % 100;
  const century = yy <= currentYearShort ? 2000 : 1900;
  const birthDate = new Date(century + yy, mm - 1, dd);
  if (birthDate.getMonth() !== mm - 1) return null; // rejects invalid dates like Feb 30

  let age = today.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!hasHadBirthdayThisYear) age--;

  return age >= 0 ? age : null;
}
