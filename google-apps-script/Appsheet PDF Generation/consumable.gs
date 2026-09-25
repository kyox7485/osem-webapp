let CONSUMABLE_MASTER_CACHE = null;
let RESIDENT_CONSUMABLE_CACHE = null;

function loadConsumableCache(){

    if(CONSUMABLE_MASTER_CACHE){

        return;

    }

    Logger.log("Loading consumable cache...");

    const consumableID =
        getConfigValue("ConsumableModuleID");

    const ss =
        SpreadsheetApp.openById(
            consumableID
        );

    //------------------------------------------------
    // Consumable Master
    //------------------------------------------------

    const masterSheet =
        ss.getSheetByName(
            CONFIG.CONSUMABLE_MASTER_SHEET
        );

    if(!masterSheet){

        throw new Error(
            "Sheet not found : " +
            CONFIG.CONSUMABLE_MASTER_SHEET
        );

    }

    const masterData =
        masterSheet
            .getDataRange()
            .getValues();

    const masterHeader =
        masterData.shift();

    CONSUMABLE_MASTER_CACHE = {};

    masterData.forEach(function(row){

        let item = {};

        masterHeader.forEach(function(name,index){

            item[name] = row[index];

        });

        CONSUMABLE_MASTER_CACHE[
            item["ConsumableID"]
        ] = item;

    });

    //------------------------------------------------
    // Resident Consumables
    //------------------------------------------------

    const residentSheet =
        ss.getSheetByName(
            CONFIG.CONSUMABLE_RESIDENT_SHEET
        );

    if(!residentSheet){

        throw new Error(
            "Sheet not found : " +
            CONFIG.CONSUMABLE_RESIDENT_SHEET
        );

    }

    const residentData =
        residentSheet
            .getDataRange()
            .getValues();

    const residentHeader =
        residentData.shift();

    RESIDENT_CONSUMABLE_CACHE = {};

    residentData.forEach(function(row){

        let consumable = {};

        residentHeader.forEach(function(name,index){

            consumable[name] = row[index];

        });

        //------------------------------------------------
        // Attach master
        //------------------------------------------------

        consumable.Master =
            CONSUMABLE_MASTER_CACHE[
                consumable["ConsumableID"]
            ];

        //------------------------------------------------
        // Calculate Suggested Restock
        //------------------------------------------------

        if(
            consumable.Master &&
            consumable.Master["RestockRequired"] == "Yes"
        ){

            const maxStock =
                Number(
                    consumable.Master["MaxStock"]
                ) || 0;

            const currentStock =
                Number(
                    consumable["CurrentStock"]
                ) || 0;

            consumable.SuggestedRestock =
                Math.max(
                    0,
                    maxStock - currentStock
                );

        }else{

            consumable.SuggestedRestock = "";

        }

        //------------------------------------------------

        const residentID =
            consumable["ResidentID"];

        if(
            !RESIDENT_CONSUMABLE_CACHE[
                residentID
            ]
        ){

            RESIDENT_CONSUMABLE_CACHE[
                residentID
            ] = [];

        }

        RESIDENT_CONSUMABLE_CACHE[
            residentID
        ].push(
            consumable
        );

    });

}

function getResidentConsumables(residentID){

    loadConsumableCache();

    return RESIDENT_CONSUMABLE_CACHE[
        residentID
    ] || [];

}

function getResidentFamilyConsumables(residentID){

    return getResidentConsumables(
        residentID
    ).filter(function(item){

        return (
            item["Supplier"] == "Family"
        );

    });

}

function getConsumableMaster(){

    loadConsumableCache();

    return CONSUMABLE_MASTER_CACHE;

}

function buildConsumableDescription(item){

    return (

        item.Master["Consumable"]

        +

        " - "

        +

        item["CurrentStock"]

        +

        " "

        +

        item.Master["Unit"]

    );

}

function testConsumables(){

    const items =
        getResidentConsumables(
            "AMN-14"
        );

    Logger.log(
        "Consumables = " +
        items.length
    );

    items.forEach(function(item){

        Logger.log("----------------");

        Logger.log(
            item.Master["Consumable"]
        );

        Logger.log(
            "Supplier : " +
            item["Supplier"]
        );

        Logger.log(
            "Current : " +
            item["CurrentStock"] +
            " " +
            item.Master["Unit"]
        );

        Logger.log(
            "Suggested : " +
            item.SuggestedRestock
        );

    });

}

function testConsumableSheets(){

    const consumableID =
        getConfigValue(
            "ConsumableModuleID"
        );

    const ss =
        SpreadsheetApp.openById(
            consumableID
        );

    ss.getSheets().forEach(function(sheet){

        Logger.log(
            sheet.getName()
        );

    });

}

function testConsumableConfig(){

    Logger.log(
        CONFIG.CONSUMABLE_MASTER_SHEET
    );

    Logger.log(
        CONFIG.CONSUMABLE_RESIDENT_SHEET
    );

}

function getResidentRestockConsumables(residentID){

    return getResidentFamilyConsumables(
        residentID
    ).filter(function(item){

        return (

            item.Master["RestockRequired"] == "Yes"

            &&

            item.SuggestedRestock > 0

        );

    });

}

function buildConsumableReminderData(residentID){

    const items =
        getResidentRestockConsumables(
            residentID
        );

    return items.map(function(item){

        return {

            consumable:
                item.Master["Consumable"],

            currentStock:
                item["CurrentStock"],

            unit:
                item.Master["Unit"],

            suggestedRestock:
                item.SuggestedRestock

        };

    });

}