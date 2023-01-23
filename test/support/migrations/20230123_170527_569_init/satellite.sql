
/*---------------------------------------------
Below are templated triggers added by Satellite
---------------------------------------------*/


-- These are toggles for turning the triggers on and off
DROP TABLE IF EXISTS _electric_trigger_settings;
CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);


