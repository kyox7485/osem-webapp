const STANDARD_SESSIONS = [

  {
    time: "08:00",
    title: "08:00 Morning Medication Preparation"
  },

  {
    time: "12:00",
    title: "12:00 Noon Medication Preparation"
  },

  {
    time: "18:00",
    title: "18:00 Evening Medication Preparation"
  },

  {
    time: "22:00",
    title: "22:00 Night Medication Preparation"
  }

];

function getPreparationSessions(residentID){

    const medications =
        getResidentRegularMedication(residentID);

    const grouped =
        groupMedicationBySession(medications);

    let sessions = [];

    // Add standard sessions first
    STANDARD_SESSIONS.forEach(function(session){

        if(
            grouped[session.time] &&
            grouped[session.time].length > 0
        ){

            sessions.push({

                time: session.time,

                title: session.title,

                medications: grouped[session.time]

            });

        }

    });

    // Add custom sessions
    Object.keys(grouped).forEach(function(time){

        const isStandard =
            STANDARD_SESSIONS.some(function(session){

                return session.time == time;

            });

        if(!isStandard){

            sessions.push({

                time: time,

                title: time + " Medication Preparation",

                medications: grouped[time]

            });

        }

    });

    // Sort chronologically by actual time
    sessions.sort(function(a, b){

        return timeToMinutes(a.time) - timeToMinutes(b.time);

    });

    return sessions;

}


function timeToMinutes(time){

    if(!time){
        return 9999;
    }

    time = String(time).trim().toUpperCase();

    // Format: HH:mm
    if(time.indexOf(":") !== -1){

        const parts = time.split(":");

        return (
            parseInt(parts[0], 10) * 60 +
            parseInt(parts[1], 10)
        );

    }

    // Format: 0800AM / 0600PM
    const match =
        time.match(/^(\d{2})(\d{2})(AM|PM)$/);

    if(match){

        let hour =
            parseInt(match[1], 10);

        const minute =
            parseInt(match[2], 10);

        const ampm =
            match[3];

        if(ampm === "AM"){

            if(hour === 12){
                hour = 0;
            }

        }else{

            if(hour !== 12){
                hour += 12;
            }

        }

        return hour * 60 + minute;

    }

    return 9999;
}

function timeToMinutes(time){

    if(!time){
        return 9999;
    }

    time = String(time).trim().toUpperCase();

    // Format: HH:mm
    if(time.indexOf(":") !== -1){

        const parts = time.split(":");

        return (
            parseInt(parts[0], 10) * 60 +
            parseInt(parts[1], 10)
        );

    }

    // Format: 0800AM / 0600PM
    const match =
        time.match(/^(\d{2})(\d{2})(AM|PM)$/);

    if(match){

        let hour =
            parseInt(match[1], 10);

        const minute =
            parseInt(match[2], 10);

        const ampm =
            match[3];

        if(ampm === "AM"){

            if(hour === 12){
                hour = 0;
            }

        }else{

            if(hour !== 12){
                hour += 12;
            }

        }

        return hour * 60 + minute;

    }

    return 9999;
}