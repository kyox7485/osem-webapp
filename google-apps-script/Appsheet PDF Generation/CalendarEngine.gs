function getDaysInMonth(year, month){

  return new Date(
      year,
      month,
      0
  ).getDate();

}

function shouldPrepareMedicineOnDay(
    medication,
    year,
    month,
    day
){

    const current =
        new Date(year, month - 1, day);

    const start =
        new Date(medication["Start Date"]);

    let end =
        medication["End Date"];

    // Outside treatment period
    if(current < start){

        return false;

    }

    if(end != ""){

        end = new Date(end);

        if(current > end){

            return false;

        }

    }

    const frequency =
        medication["Frequency"] || "";

    // Daily frequencies
    if(
        frequency == "OD" ||
        frequency == "BD" ||
        frequency == "TDS" ||
        frequency == "QID" ||
        frequency == "ON" ||
        frequency == "PRN"
    ){

        return true;

    }

    // Every Other Day (EOD)
    if(frequency == "EOD"){

        const daysFromStart =
            Math.floor(
                (current - start) /
                (1000 * 60 * 60 * 24)
            );

        return daysFromStart % 2 == 0;

    }

    // Every 3 Days
    if(frequency == "Every 3 Days"){

        const daysFromStart =
            Math.floor(
                (current - start) /
                (1000 * 60 * 60 * 24)
            );

        return daysFromStart % 3 == 0;

    }

    // Selected Days OR Others
    if(
        frequency == "Selected Days" ||
        frequency == "Others"
    ){

        const weekday =
            Utilities.formatDate(
                current,
                Session.getScriptTimeZone(),
                "EEEE"
            );

        const dosingDays =
            medication["Dosing Days"] || "";

        if(Array.isArray(dosingDays)){

            return dosingDays.includes(weekday);

        }

        return String(dosingDays)
            .split(",")
            .map(function(day){

                return day.trim();

            })
            .includes(weekday);

    }

    // Default
    return true;

}

function testCalendar(){

    Logger.log(
        getDaysInMonth(
            2026,
            8
        )
    );

}

function getInactiveDays(medication, year, month) {

  const daysInMonth = getDaysInMonth(year, month);

  let inactiveDays = [];

  for (let day = 1; day <= daysInMonth; day++) {

    if (!shouldPrepareMedicineOnDay(medication, year, month, day)) {

      inactiveDays.push(day);

    }

  }

  return inactiveDays;

}

function getInvalidMonthDays(year, month) {

  const daysInMonth = getDaysInMonth(year, month);

  let invalidDays = [];

  for (let day = daysInMonth + 1; day <= 31; day++) {

    invalidDays.push(day);

  }

  return invalidDays;

}

function normalizeTime(value){

    if(value == null || value == ""){

        return "";

    }

    // Already a Date object
    if(value instanceof Date){

        return Utilities.formatDate(
            value,
            Session.getScriptTimeZone(),
            "HH:mm"
        );

    }

    let text = String(value)
        .trim()
        .toUpperCase();

    // Remove spaces
    text = text.replace(/\s+/g,"");

    // Match formats like:
    // 03:00AM
    // 3:00AM
    // 03:00PM
    // 3:00PM

    const match =
        text.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);

    if(match){

        let hour = Number(match[1]);
        const minute = match[2];
        const ampm = match[3];

        if(ampm == "AM"){

            if(hour == 12){

                hour = 0;

            }

        }else{

            if(hour != 12){

                hour += 12;

            }

        }

        return (
            ("0"+hour).slice(-2) +
            ":" +
            minute
        );

    }

    // Already HH:mm
    if(text.match(/^\d{2}:\d{2}$/)){

        return text;

    }

    return text;

}

function parseOtherTimes(value){

    if(value == null || value == ""){

        return [];

    }

    return String(value)
        .split(",")
        .map(function(time){

            return normalizeTime(time);

        })
        .filter(function(time){

            return time != "";

        });

}

function parseAdministrationTimes(value){

    if(value == null || value == ""){
        return [];
    }

    // AppSheet EnumList normally reaches Apps Script
    // as a comma-separated value when stored in Google Sheets.
    return String(value)
        .split(",")
        .map(function(time){

            return normalizeTime(time);

        })
        .filter(function(time){

            return time != "";

        });

}