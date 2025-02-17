DROP TABLE temp_values;

CREATE TEMP TABLE temp_values ( value text[]);

DO
$do$
BEGIN 
   FOR i IN 1..40000 LOOP
      INSERT INTO temp_values (value)
      SELECT ARRAY(
        SELECT floor(random() * 100)::text
        FROM generate_series(1, 5)
      );
   END LOOP;
END
$do$;

EXPLAIN ANALYZE
SELECT *
FROM temp_values
WHERE ARRAY(
    SELECT floor(random() * 100)::text
    FROM generate_series(1, 100)
) @> value;

