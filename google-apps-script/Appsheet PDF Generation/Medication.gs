/*
const TIME_COLUMN = {

  "08:00": "Time_0800",
  "12:00": "Time_1200",
  "18:00": "Time_1800",
  "22:00": "Time_2200"

};
*/

function getMedication(
    residentID,
    servingTime
){
    loadMedicationCache();

    servingTime = normalizeTime(servingTime);

    return getResidentMedication(
        residentID
    ).filter(function(med){

        const times =
            parseAdministrationTimes(
                med["Administration Times"]
            );

        return times.indexOf(servingTime) !== -1;

    });
}

function buildMedicineDescription(medication){

  const dosageForm = medication["Dosage Form"] || "";
  const brandName = medication["Brand Name"] || "";
  const activeIngredient = medication["Active Ingredient"] || "";
  const dose = medication["Dose"] || "";
  const unit = medication["Unit"] || "";
  const frequency = medication["Frequency"] || "";

  let medicineName = "";

  if(brandName != ""){

    medicineName =
      dosageForm +
      " " +
      brandName +
      " (" +
      activeIngredient +
      ")";

  }else{

    medicineName =
      dosageForm +
      " " +
      activeIngredient;

  }

  return (
      medicineName +
      " " +
      dose +
      " " +
      unit +
      " " +
      frequency
  ).trim();

}

function getResidentMedication(residentID){

    loadMedicationCache();

    return RESIDENT_MEDICATION_CACHE[
        residentID
    ] || [];

}

function groupMedicationBySession(medications){

    const sessions = {};

    medications.forEach(function(med){

        const times =
            parseAdministrationTimes(
                med["Administration Times"]
            );

        times.forEach(function(time){

            if(!sessions[time]){
                sessions[time] = [];
            }

            sessions[time].push(med);

        });

    });

    return sessions;
}

function getMedicationOrders(){

    loadMedicationCache();

    return MEDICATION_ORDER_CACHE;

}

function testMedicationOrders(){

    const orders =
        getMedicationOrders();

    Logger.log(
        orders["10ea2020"]
    );

}

function isPRNMedication(medication){

    return String(
        medication["Frequency"] || ""
    ).trim().toUpperCase() == "PRN";

}


function getResidentPRNMedication(residentID){

    return getResidentMedication(
        residentID
    ).filter(function(med){

        return isPRNMedication(med);

    });

}


function getResidentRegularMedication(residentID){

    return getResidentMedication(
        residentID
    ).filter(function(med){

        return !isPRNMedication(med);

    });

}