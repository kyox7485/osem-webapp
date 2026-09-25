function getLatestMedicationStock() {

  const medicationID =
      getConfigValue("MedicationModuleID");

  const ss =
      SpreadsheetApp.openById(medicationID);

  const sheet =
      ss.getSheetByName(
          CONFIG.MEDICATION_STOCK_SHEET
      );

  const data =
      sheet.getDataRange().getValues();

  const header =
      data.shift();

  const stockIDCol =
      header.indexOf("StockID");

  const rxCol =
      header.indexOf("RxOrderID");

  const dateCol =
      header.indexOf("StockDate");

  let latest = {};

  data.forEach(function(row){

      const rx =
          row[rxCol];

      const stockDate =
          parseStockDate_(row[dateCol]);

      if(
          !latest[rx] ||
          stockDate >
          latest[rx]._date
      ){

          let obj = {};

          header.forEach(function(name,index){

              obj[name] =
                  row[index];

          });

          obj._date =
              stockDate;

          latest[rx] =
              obj;

      }

  });

  //------------------------------------------------
  // Replace the stored snapshot with LIVE values.
  //
  // The sheet's Balance / Days Remaining are what they were when the stock
  // event was recorded (rows are events, never daily). Every report here
  // (family, familyrequest, purchase, medsummary) must use today's
  // forecast instead, so it is applied once, at the source.
  // RecordedBalance keeps the value actually written in the sheet.
  //------------------------------------------------

  const medicationOrders =
      getMedicationOrders();

  const trackingMethods =
      getStockUnitTrackingMethods();

  return Object.values(latest).map(function(stock){

      const forecast =
          getLiveStockForecast_(
              stock,
              medicationOrders[stock.RxOrderID],
              trackingMethods
          );

      stock.RecordedBalance = stock.Balance;
      stock.Balance = forecast.balance;
      stock["Daily Usage"] = forecast.dailyUsage;
      stock["Days Remaining"] = forecast.daysRemaining;
      stock.TrackingMethod = forecast.tracking;

      return stock;

  });

}

//====================================================
// LIVE STOCK FORECAST
//
// Mirrors webapp/src/lib/medication-stock.ts — keep the two in sync.
//
// Count units: balance decreases by (Dose x number of Administration Times)
// on every dosing day AFTER the stock event, up to today. Dosing days use the
// medication chart's own rule, shouldPrepareMedicineOnDay (CalendarEngine.gs).
//
// Not forecast (Daily Usage / Days Remaining = ""): Estimate units, PRN, or
// stock counted in a different unit from the order's dose unit. Their
// balance is exactly what was last recorded.
//====================================================

const STOCK_FORECAST_MAX_DAYS = 3650;

const STOCK_DOSES_PER_DAY_FALLBACK = {
  OD: 1, OM: 1, ON: 1, BD: 2, TDS: 3, QID: 4,
  EOD: 1, "Every 3 Days": 1, "Selected Days": 1
};

function getLiveStockForecast_(stock, medication, trackingMethods){

    const unit =
        String(stock.Unit || "").trim();

    const recorded =
        Number(stock.Balance);

    const result = {
        tracking: trackingMethods[unit] || "",
        balance: stock.Balance,
        dailyUsage: "",
        daysRemaining: "",
        forecast: false
    };

    if(result.tracking != "Count") return result;
    if(!medication || isPRNMedication(medication)) return result;
    if(isNaN(recorded)) return result;
    if(!stock._date || isNaN(stock._date.getTime())) return result;

    if(
        String(medication["Unit"] || "").trim().toLowerCase() !=
        unit.toLowerCase()
    ) return result;

    const perDay =
        parseAdministrationTimes(
            medication["Administration Times"]
        ).length ||
        STOCK_DOSES_PER_DAY_FALLBACK[medication["Frequency"]] ||
        0;

    const dose =
        Number(medication["Dose"]);

    if(!perDay || !(dose > 0)) return result;

    // Deducted on each dosing day by the forecast below.
    const usage =
        Math.round(dose * perDay * 100) / 100;

    const tz =
        Session.getScriptTimeZone();

    const eventDay =
        stockDayStart_(stock._date, tz);

    const today =
        stockDayStart_(new Date(), tz);

    //------------------------------------------------
    // Consumption since the event (event day itself = recorded balance)
    //------------------------------------------------

    let consumed = 0;

    for(
        let d = stockAddDays_(eventDay, 1);
        d <= today;
        d = stockAddDays_(d, 1)
    ){

        if(stockIsDosingDay_(medication, d)){
            consumed += usage;
        }

    }

    const balance =
        Math.max(
            0,
            Math.round((recorded - consumed) * 100) / 100
        );

    //------------------------------------------------
    // Days remaining: walk the schedule from tomorrow to find the last dose
    // the balance still covers; Days Remaining = days from today to that
    // dose (9 tablets of 1 Tablet EOD = 18). If the order's End Date passes
    // first, the supply outlasts the order, so "" (no refill needed).
    //------------------------------------------------

    const end =
        medication["End Date"]
            ? parseStockDate_(medication["End Date"])
            : null;

    let left = balance;
    let lastDose = 0;
    let outlastsOrder = false;

    for(let i = 1; i <= STOCK_FORECAST_MAX_DAYS; i++){

        const d = stockAddDays_(today, i);

        if(end && !isNaN(end.getTime()) && d > end){
            outlastsOrder = true;
            break;
        }

        if(stockIsDosingDay_(medication, d)){

            if(left + 1e-9 < usage) break;

            left -= usage;
            lastDose = i;

        }

    }

    const daysRemaining =
        outlastsOrder ? "" : lastDose;

    result.balance = balance;
    // Shown as Daily Usage: average per calendar day (EOD = half).
    result.dailyUsage =
        Math.round(usage * stockDosingDayFraction_(medication) * 100) / 100;
    result.daysRemaining = daysRemaining;
    result.forecast = true;

    return result;

}

// Share of calendar days that are dosing days: EOD = 1/2, Every 3 Days = 1/3,
// Mon/Wed/Fri = 3/7. Same as dosingDayFraction in medication-stock.ts.
function stockDosingDayFraction_(medication){

    const weekdays =
        ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

    const dosingDays =
        String(medication["Dosing Days"] || "");

    const days =
        dosingDays.split(",")
            .map(function(d){ return d.trim(); })
            .filter(function(d){ return weekdays.indexOf(d) >= 0; });

    const weekdayShare =
        days.length > 0 && dosingDays.indexOf("Everyday") < 0
            ? days.length / 7
            : 1;

    const frequency =
        medication["Frequency"];

    const interval =
        frequency == "EOD" ? 2 : frequency == "Every 3 Days" ? 3 : 1;

    return weekdayShare / interval;

}

function stockIsDosingDay_(medication, date){

    return shouldPrepareMedicineOnDay(
        medication,
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate()
    );

}

function stockDayStart_(date, tz){

    const ymd =
        Utilities.formatDate(date, tz, "yyyy-MM-dd").split("-");

    return new Date(
        Number(ymd[0]),
        Number(ymd[1]) - 1,
        Number(ymd[2])
    );

}

function stockAddDays_(date, n){

    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + n
    );

}

// StockDate may be a real Date cell or text "DD/MM/YYYY HH:mm[:ss]".
// Never pass that text to new Date() — it reads DD/MM as MM/DD.
function parseStockDate_(value){

    if(value instanceof Date) return value;

    const text =
        String(value || "").trim();

    const m =
        text.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
        );

    if(m){

        return new Date(
            Number(m[3]),
            Number(m[2]) - 1,
            Number(m[1]),
            Number(m[4] || 0),
            Number(m[5] || 0),
            Number(m[6] || 0)
        );

    }

    return new Date(text);

}

function getTrackingMethod(unit){

    const medicationID =
        getConfigValue("MedicationModuleID");

    const ss =
        SpreadsheetApp.openById(
            medicationID
        );

    const sheet =
        ss.getSheetByName(
            CONFIG.STOCK_UNIT_SHEET
        );

    const data =
        sheet.getDataRange().getValues();

    const header =
        data.shift();

    const unitCol =
        header.indexOf("Unit");

    const methodCol =
        header.indexOf("Tracking Method");

    for(const row of data){

        if(row[unitCol] == unit){

            return row[methodCol];

        }

    }

    return "";

}

function testLatestMedicationStock() {

  const latest = getLatestMedicationStock();

  Logger.log("Total latest records: " + latest.length);

  latest.forEach(function(stock) {

    Logger.log(
      stock.RxOrderID +
      " | " +
      stock.ResidentID +
      " | " +
      stock.Balance +
      " " +
      stock.Unit +
      " | " +
      stock.StockDate
    );

  });

}

function buildStockStatus(stock){

    const trackingMethod =
        getTrackingMethod(stock.Unit);

    if(trackingMethod == "Estimate"){

        return "📦 " +
            stock.Balance +
            " " +
            stock.Unit +
            "(s) In Stock";

    }

    // Count unit that cannot be forecast (PRN, or stock counted in a
    // different unit from the dose): show the quantity for reference.
    if(stock["Days Remaining"] === ""){

        return "📦 " +
            stock.Balance +
            " " +
            stock.Unit +
            "(s) In Stock";

    }

    const days =
        Number(stock["Days Remaining"]);

    if(days < 7){

        return "🔴 " +
            Math.round(days) +
            " Days Left";

    }

    if(days < 14){

        return "🟠 " +
            Math.round(days) +
            " Days Left";

    }

    return "🟢 " +
        Math.round(days) +
        " Days Left";

}

function testBuildStockStatus(){

    const purchaseList =
        getPurchaseList();

    purchaseList.forEach(function(item){

        Logger.log(

            item.resident.Residents +

            " | " +

            buildStockStatus(
                item.stock
            )

        );

    });

}