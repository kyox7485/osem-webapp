function getMedicationChartUrl(residentID) {

  const baseUrl =
      getConfigValue("WebAppURL");

  const today = new Date();

  const year = today.getFullYear();

  const month = today.getMonth() + 1;

  return (
      baseUrl +
      "?residentID=" + encodeURIComponent(residentID) +
      "&year=" + year +
      "&month=" + month
  );

}

function getBranchMedicationChartUrl(
    branch,
    year,
    month
){

    const baseUrl =
        getConfigValue("WebAppURL");

    return(

        baseUrl +

        "?action=branchchart" +

        "&branch=" +

        encodeURIComponent(branch) +

        "&year=" +

        year +

        "&month=" +

        month

    );

}

function launchBranchMedicationChart(
    branch,
    year,
    month
){

    return getBranchMedicationChartUrl(

        branch,

        year,

        month

    );

}