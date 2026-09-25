function getResidentsByBranch(branch){

    const residents =
        getResidents();

    return Object.values(residents)
        .filter(function(resident){

            return resident.Branch == branch &&
                   resident.Status == "Active";

        })
        .sort(function(a,b){

            return a.Residents.localeCompare(
                b.Residents
            );

        });

}