-- Call Bell: resident name snapshot per call.
-- resident_nickname = Wenze CALL_RECORDING_BEAN.NICK_NAME, i.e. the resident
-- name the receiver had on the bell when the call happened. It is NOT derived
-- from cb_assignments, so later re-assignments never change call history.
-- (resident_name_snapshot holds CALL_RECORDING_BEAN.NAME = the bell/call number.)
alter table cb_call_logs add column if not exists resident_nickname text;
