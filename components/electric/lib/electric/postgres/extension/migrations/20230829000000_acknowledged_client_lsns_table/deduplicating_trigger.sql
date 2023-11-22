CREATE OR REPLACE FUNCTION electric.upsert_acknowledged_client_lsn()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    SECURITY DEFINER
AS $function$
BEGIN
    RAISE DEBUG 'Trigger % executed by operation % at depth % (tx %)', TG_NAME, TG_OP, pg_trigger_depth(), pg_current_xact_id();
    RAISE DEBUG '  Given OLD %', to_json(OLD);
    RAISE DEBUG '  Given NEW %', to_json(NEW);

    INSERT INTO electric.acknowledged_client_lsns AS t
        VALUES (NEW.client_id, NEW.lsn)
        ON CONFLICT (client_id) DO UPDATE 
            SET lsn = NEW.lsn
            WHERE t.lsn IS DISTINCT FROM NEW.lsn;

    RETURN NULL;
END;
$function$;

CREATE OR REPLACE TRIGGER upsert_acknowledged_client_lsn
BEFORE INSERT ON electric.acknowledged_client_lsns
FOR EACH ROW
WHEN (electric.__session_replication_role() = 'replica' AND pg_trigger_depth() < 1)
EXECUTE FUNCTION electric.upsert_acknowledged_client_lsn();

ALTER TABLE electric.acknowledged_client_lsns ENABLE ALWAYS TRIGGER upsert_acknowledged_client_lsn;
