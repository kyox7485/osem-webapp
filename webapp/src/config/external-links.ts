import type { Rights } from "@/lib/current-user";

export type ExternalLink = {
  label: string;
  url: string;
  description: string;
  // Minimum rights level required to see this link.
  // Omit (or use "STAFF") to show to everyone.
  minRights?: Rights;
};

// ─── Edit here to add / remove / reorder links ───────────────────────────────
// Each entry is shown as a card on the External Links page.
// minRights: "MODERATOR" → visible to Moderator + Admin only
//            "ADMIN"     → visible to Admin only
//            (omitted)   → visible to everyone
// ─────────────────────────────────────────────────────────────────────────────
export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    label: "Grocery Expenses Monitoring System",
    url: "https://script.google.com/macros/s/AKfycbw8WJ4skH-Y3woN8kl2xxrJSJ_XVuWk4kdtUE9xL2_xKMKgGJ9dte6xXSUxgO3V6tko/exec",
    description: "Track and monitor grocery expenses across the branch.",
  },
  {
    label: "Incident Reports",
    url: "https://docs.google.com/forms/d/15KTaHzBV_HpbayjkyWCKxcAD0i-ky4QdFCshjCcr7Eo/edit?usp=drive_web&ouid=101137960050929940724",
    description: "Submit a new incident report.",
  },
  {
    label: "Incident Reports Review",
    url: "https://script.google.com/macros/s/AKfycbzbkZbJg85NjIn55XtP7nnV5GrKFeMA4TW6geze-ZcrSBuDvRVkXwhs2cSvL8HK4ZXzag/exec",
    description: "Review and manage submitted incident reports.",
  },
  {
    label: "Enquiry Form",
    url: "https://script.google.com/macros/s/AKfycbxKL8j3pooKg0Ma1DqtkbYxol9snLadQt_M8Po8HrDZYZXNtyy4ORY4u-65H4BTTVxa/exec",
    description: "Handle incoming enquiries from prospective residents or families.",
  },
  {
    label: "Maintenance Report",
    url: "https://docs.google.com/forms/d/149iSlEYw0b4s2iqXiglBJ99hpWx40j6F6p-vWJlnDck",
    description: "Submit a new maintenance report.",
  },
  {
    label: "Service Agreement Generator",
    url: "https://script.google.com/macros/s/AKfycbz_fs8w-ve4i4dJ60KEBmuelXJXAvWdohdDdhglc6WjHqloRGTpR2ndfvL7mAWl81BneQ/exec",
    description: "Generate service agreement documents.",
    minRights: "MODERATOR",
  },
  {
    label: "Token Generator",
    url: "https://script.google.com/macros/s/AKfycbxvkIsilvXKAqB4J6HgSeFQ5GOdksL4c2rsrj3NYQdrQlXoPcTyS9oBwTFOI5I1arJy/exec",
    description: "Generate staff appreciation tokens.",
    minRights: "ADMIN",
  },
];
