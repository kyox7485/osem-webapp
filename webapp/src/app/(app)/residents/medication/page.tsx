import { redirect } from "next/navigation";

export default function MedicationPage() {
  redirect("/residents/medication/orders");
}
