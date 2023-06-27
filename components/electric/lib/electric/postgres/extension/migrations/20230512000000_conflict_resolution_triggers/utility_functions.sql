-- Utility function
CREATE OR REPLACE FUNCTION electric.format_every(arr TEXT[], format_pattern TEXT)
    RETURNS TEXT[]
    STABLE PARALLEL SAFE
    RETURNS NULL ON NULL INPUT
    LANGUAGE SQL AS $$
    SELECT array_agg(format(format_pattern, val)) FROM unnest(arr) AS val;
    $$;

-- Utility function
CREATE OR REPLACE FUNCTION electric.format_every_and_join(arr TEXT[], format_pattern TEXT, joiner TEXT DEFAULT ', ')
    RETURNS TEXT
    STABLE PARALLEL SAFE
    RETURNS NULL ON NULL INPUT
    LANGUAGE SQL AS $$
    SELECT array_to_string(array_agg(format(format_pattern, val, ordinality)), joiner) FROM unnest(arr) WITH ORDINALITY AS val;
    $$;

-- Utility function
CREATE OR REPLACE FUNCTION electric.zip_format_every_and_join(arr1 TEXT[], arr2 TEXT[], format_pattern TEXT, joiner TEXT DEFAULT ', ')
    RETURNS TEXT
    STABLE PARALLEL SAFE
    RETURNS NULL ON NULL INPUT
    LANGUAGE SQL AS $$
    SELECT array_to_string(array_agg(format(format_pattern, x, y, ordinality)), joiner) FROM unnest(arr1, arr2) WITH ORDINALITY AS val(x, y, ordinality);
    $$;

CREATE OR REPLACE FUNCTION electric.append_string_unless_empty(str1 TEXT, str2 TEXT, joiner TEXT DEFAULT ', ')
    RETURNS TEXT
    STABLE PARALLEL SAFE
    CALLED ON NULL INPUT
    LANGUAGE PLPGSQL AS $$
    BEGIN
        IF str2 IS NOT NULL AND str2 != '' THEN
            RETURN str1 || joiner || str2;
        ELSE
            RETURN str1;
        END IF;
    END
    $$;