function doGet(e){

    const action =
        e.parameter.action || "chart";

    const executionId =
        Utilities.getUuid();

    const reportTitle =
        getReportTitle(action);

    setGenerationProgress(
        executionId,
        5,
        "Starting " + reportTitle + "..."
    );

    const template =
        HtmlService
            .createTemplateFromFile(
                "Loading"
            );

    template.action =
        action;

    template.reportTitle =
        reportTitle;

    template.residentID =
        e.parameter.residentID || "";

    template.branch =
        e.parameter.branch || "";

    template.year =
        e.parameter.year || "";

    template.month =
        e.parameter.month || "";

    template.executionId =
        executionId;

    return template
        .evaluate()
        .setTitle(
            reportTitle
        )
        .setXFrameOptionsMode(
            HtmlService.XFrameOptionsMode.ALLOWALL
        );
}