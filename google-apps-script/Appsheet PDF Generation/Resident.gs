function getResidents(){

    loadResidentCache();

    return RESIDENT_CACHE;

}

function getResident(residentID){

    loadResidentCache();

    return RESIDENT_CACHE[
        residentID
    ] || null;

}
function testResidents(){

    const residents =
        getResidents();

    Logger.log(
        residents["AMN-14"]
    );

}