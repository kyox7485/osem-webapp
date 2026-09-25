//====================================================
// branchreport.gs
//====================================================
//
// Branch medication chart generation.
//
// IMPORTANT:
//
// This file controls the MULTI-RESIDENT generation
// and branch-wide progress.
//
// PDF assembly is intentionally kept compatible
// with the ORIGINAL working PDF workflow.
//
// Progress:
//
//     5%   Loading page
//     10%  Preparing residents
//     15%  Start chart generation
//
//     15% → 50%
//          ALL regular + PRN pages across
//          ALL residents
//
//     50%  Branch chart generation completed
//
// PDFengine / report wrapper then continues:
//
//     50%  Creating temporary workbook
//     70%  Preparing report pages
//     78%  Finalising layout
//     82%  Generating PDF
//     95%  Cleanup
//     98%  Preparing PDF
//     100% PDF ready
//
//====================================================


//====================================================
// GET ACTIVE RESIDENTS BY BRANCH
//====================================================

function getResidentsByBranch(
    branch
){

    const residents =
        getResidents();


    let result =
        [];


    Object.keys(
        residents
    ).forEach(
        function(id){

            const resident =
                residents[id];


            if(

                resident.Branch ==
                branch

                &&

                String(
                    resident.Status
                )
                .trim()
                .toUpperCase() ==
                "ACTIVE"

            ){

                result.push(
                    resident
                );

            }

        }
    );


    //------------------------------------------------
    // Sort by resident name
    //------------------------------------------------

    result.sort(
        function(a,b){

            return String(
                a.Residents || ""
            ).localeCompare(
                String(
                    b.Residents || ""
                )
            );

        }
    );


    return result;

}


//====================================================
// TEST RESIDENT LIST
//====================================================

function testBranchResidents(){

    const residents =
        getResidentsByBranch(
            "ALMA"
        );


    Logger.log(
        "Total active residents: " +
        residents.length
    );


    residents.forEach(
        function(resident){

            Logger.log(
                resident.Residents
            );

        }
    );

}


//====================================================
// CALCULATE TOTAL CHART PAGES FOR ENTIRE BRANCH
//====================================================
//
// This MUST happen BEFORE resident #1 starts.
//
// Regular pages:
//
//     getPreparationSessions()
//
// PRN pages:
//
//     ceil(PRN medication count / 3)
//
// Total:
//
//     regular pages + PRN pages
//
//====================================================

function calculateBranchTotalChartPages(
    residents
){

    let totalPages =
        0;


    residents.forEach(
        function(resident){

            try{

                //------------------------------------------------
                // Regular medication pages
                //------------------------------------------------

                const sessions =
                    getPreparationSessions(
                        resident.ResidentID
                    );


                //------------------------------------------------
                // PRN medications
                //------------------------------------------------

                const prnMedications =
                    getResidentPRNMedication(
                        resident.ResidentID
                    );


                //------------------------------------------------
                // PRN pages
                //------------------------------------------------

                const prnPages =
                    Math.ceil(

                        prnMedications.length /

                        PRN_PER_PAGE

                    );


                //------------------------------------------------
                // Add to branch total
                //------------------------------------------------

                totalPages +=

                    sessions.length +

                    prnPages;


                Logger.log(

                    "Page count | " +

                    resident.Residents +

                    " | Regular: " +

                    sessions.length +

                    " | PRN: " +

                    prnPages +

                    " | Total: " +

                    (
                        sessions.length +
                        prnPages
                    )

                );

            }
            catch(err){

                //------------------------------------------------
                // Do not let one resident prevent the
                // branch total from being calculated.
                //------------------------------------------------

                Logger.log(

                    "Unable to calculate page count for " +

                    resident.Residents +

                    ": " +

                    err

                );

            }

        }
    );


    Logger.log(
        "TOTAL BRANCH CHART PAGES = " +
        totalPages
    );


    return totalPages;

}


//====================================================
// TEST TOTAL PAGE CALCULATION
//====================================================

function testCalculateBranchTotalPages(){

    const residents =
        getResidentsByBranch(
            "ALMA"
        );


    const totalPages =
        calculateBranchTotalChartPages(
            residents
        );


    Logger.log(
        "===================================="
    );


    Logger.log(
        "Branch: ALMA"
    );


    Logger.log(
        "Residents: " +
        residents.length
    );


    Logger.log(
        "Total chart pages: " +
        totalPages
    );


    Logger.log(
        "===================================="
    );

}


//====================================================
// GENERATE BRANCH MEDICATION CHARTS
//====================================================
//
// IMPORTANT:
//
// This function DOES NOT create a temporary workbook.
//
// It generates chart sheets in the ACTIVE spreadsheet,
// exactly like the old working version.
//
// generateBranchMedicationChartPdf() will later:
//
//     1. createTemporaryWorkbook(report)
//     2. removeNonReportSheets()
//     3. export PDF
//
// This preserves the old working PDF architecture.
//====================================================

function generateBranchMedicationCharts(

    branch,

    year,

    month,

    executionId

){

    //------------------------------------------------
    // Get residents
    //------------------------------------------------

    const residents =
        getResidentsByBranch(
            branch
        );


    const totalResidents =
        residents.length;


    if(
        totalResidents === 0
    ){

        throw new Error(

            "No active residents found for branch: " +

            branch

        );

    }


    //------------------------------------------------
    // Calculate TOTAL pages FIRST
    //------------------------------------------------

    const totalPages =
        calculateBranchTotalChartPages(
            residents
        );


    if(
        totalPages === 0
    ){

        throw new Error(

            "No medication chart pages found for branch: " +

            branch

        );

    }


    //------------------------------------------------
    // Shared progress state
    //------------------------------------------------

    const branchProgressState = {

        completedPages:
            0,

        totalPages:
            totalPages,

        residentNumber:
            0,

        totalResidents:
            totalResidents

    };


    //------------------------------------------------
    // 10%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        10,

        "Preparing " +

        totalResidents +

        " residents...",

        {

            residentNumber:
                0,

            totalResidents:
                totalResidents

        }

    );


    //------------------------------------------------
    // 15%
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        15,

        "Starting branch medication chart generation...",

        {

            residentNumber:
                0,

            totalResidents:
                totalResidents

        }

    );


    //------------------------------------------------
    // ALL generated sheets
    //------------------------------------------------

    const generatedSheets = [];


    //------------------------------------------------
    // Process residents
    //------------------------------------------------

    residents.forEach(

        function(
            resident,
            index
        ){

            const residentNumber =
                index + 1;


            //------------------------------------------------
            // Update resident number
            //------------------------------------------------

            branchProgressState.residentNumber =
                residentNumber;


            //------------------------------------------------
            // Current progress
            //------------------------------------------------

            const currentProgress =
                calculateMedicationChartProgress(

                    branchProgressState.completedPages,

                    branchProgressState.totalPages

                );


            //------------------------------------------------
            // Show resident
            //------------------------------------------------

            setGenerationProgress(

                executionId,

                currentProgress,

                "Preparing resident " +

                residentNumber +

                " of " +

                totalResidents +

                ": " +

                resident.Residents,

                {

                    residentNumber:
                        residentNumber,

                    totalResidents:
                        totalResidents

                }

            );


            //------------------------------------------------
            // Generate resident charts
            //------------------------------------------------

            try{

                const report =
                    generateResidentMedicationCharts(

                        resident.ResidentID,

                        year,

                        month,

                        executionId,

                        branchProgressState

                    );


                //------------------------------------------------
                // Add sheets
                //------------------------------------------------

                report.sheets.forEach(

                    function(sheet){

                        generatedSheets.push(
                            sheet
                        );

                    }

                );


                //------------------------------------------------
                // Current progress
                //------------------------------------------------

                const progress =
                    calculateMedicationChartProgress(

                        branchProgressState.completedPages,

                        branchProgressState.totalPages

                    );


                //------------------------------------------------
                // Resident completed
                //------------------------------------------------

                setGenerationProgress(

                    executionId,

                    progress,

                    "Resident " +

                    residentNumber +

                    " of " +

                    totalResidents +

                    " completed.",

                    {

                        residentNumber:
                            residentNumber,

                        totalResidents:
                            totalResidents

                    }

                );

            }
            catch(err){

                //------------------------------------------------
                // Log error
                //------------------------------------------------

                Logger.log(

                    "Resident skipped: " +

                    resident.Residents +

                    " | " +

                    err

                );


                //------------------------------------------------
                // Do not increase completedPages
                //------------------------------------------------

                const progress =
                    calculateMedicationChartProgress(

                        branchProgressState.completedPages,

                        branchProgressState.totalPages

                    );


                setGenerationProgress(

                    executionId,

                    progress,

                    "Resident " +

                    residentNumber +

                    " of " +

                    totalResidents +

                    " skipped.",

                    {

                        residentNumber:
                            residentNumber,

                        totalResidents:
                            totalResidents

                    }

                );

            }

        }

    );


    //------------------------------------------------
    // All pages completed
    //------------------------------------------------

    setGenerationProgress(

        executionId,

        50,

        "All branch medication charts generated.",

        {

            residentNumber:
                totalResidents,

            totalResidents:
                totalResidents

        }

    );


    //------------------------------------------------
    // Return ONLY the generated sheets
    //
    // No temp file here.
    //------------------------------------------------

    return {

        branch:
            branch,

        year:
            year,

        month:
            month,

        executionId:
            executionId,
        
        totalResidents:
            totalResidents,

        sheets:
            generatedSheets

    };

}


//====================================================
// TEST BRANCH GENERATION
//====================================================

function testGenerateBranchCharts(){

    const executionId =
        generateExecutionId();


    const report =
        generateBranchMedicationCharts(

            "ALMA",

            2026,

            9,

            executionId

        );


    Logger.log(
        "===================================="
    );


    Logger.log(
        "Branch chart generation complete."
    );


    Logger.log(
        "Generated sheets: " +
        report.sheets.length
    );


    report.sheets.forEach(
        function(sheet){

            Logger.log(
                sheet.getName()
            );

        }
    );


    Logger.log(
        "===================================="
    );

}


//====================================================
// INSPECT RESIDENTS
//====================================================

function inspectResidents(){

    const residents =
        getResidents();


    Object.keys(
        residents
    )
    .slice(
        0,
        10
    )
    .forEach(
        function(id){

            const r =
                residents[id];


            Logger.log(
                "----------------"
            );


            Logger.log(
                "ResidentID : " +
                r.ResidentID
            );


            Logger.log(
                "Name       : " +
                r.Residents
            );


            Logger.log(
                "Branch     : " +
                r.Branch
            );


            Logger.log(
                "Status     : " +
                r.Status
            );

        }
    );

}