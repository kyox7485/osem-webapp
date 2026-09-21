import { dictCommon } from "./dict-common";
import { dictResidents } from "./dict-residents";
import { dictStaff } from "./dict-staff";
import { dictAccounts } from "./dict-accounts";
import { dictClinical } from "./dict-clinical";
import { dictPhysio } from "./dict-physio";
import { dictAuth } from "./dict-auth";
import { dictMedication } from "./dict-medication";

// Each dict-*.ts file owns one module's strings (English -> Bahasa
// Malaysia) so they can be authored independently without merge
// conflicts; this file just combines them into the one lookup translate()
// uses.
export const msDictionary: Record<string, string> = {
  ...dictCommon,
  ...dictResidents,
  ...dictStaff,
  ...dictAccounts,
  ...dictClinical,
  ...dictPhysio,
  ...dictAuth,
  ...dictMedication,
};
