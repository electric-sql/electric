CREATE TYPE electric.unbounded_tag AS (
  timestamp TIMESTAMP WITH TIME ZONE,
  source_id varchar(255)
);

CREATE DOMAIN electric.tag AS electric.unbounded_tag
    CHECK (VALUE IS NULL OR (VALUE).timestamp IS NOT NULL);


CREATE OR REPLACE FUNCTION electric.tag_operator_eq(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN first.timestamp = second.timestamp AND first.source_id IS NOT DISTINCT FROM second.source_id;


CREATE OR REPLACE FUNCTION electric.tag_operator_neq(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN first.timestamp <> second.timestamp OR first.source_id IS DISTINCT FROM second.source_id;


CREATE OR REPLACE FUNCTION electric.tag_operator_lt(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURN first.timestamp < second.timestamp
           OR (first.timestamp = second.timestamp
               AND (first.source_id IS NOT NULL AND second.source_id IS NULL
                    OR (first.source_id IS NOT NULL AND second.source_id IS NOT NULL AND first.source_id < second.source_id)));


CREATE OR REPLACE FUNCTION electric.tag_operator_gt(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN first.timestamp > second.timestamp
           OR (first.timestamp = second.timestamp
               AND (first.source_id IS NULL AND second.source_id IS NOT NULL
                    OR (first.source_id IS NOT NULL AND second.source_id IS NOT NULL AND first.source_id > second.source_id)));


CREATE OR REPLACE FUNCTION electric.tag_operator_gte(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN first.timestamp > second.timestamp
           OR (first.timestamp = second.timestamp
               AND (first.source_id IS NULL AND second.source_id IS NOT NULL
                    OR first.source_id IS NOT DISTINCT FROM second.source_id)
                    OR (first.source_id IS NOT NULL AND second.source_id IS NOT NULL AND first.source_id > second.source_id));


CREATE OR REPLACE FUNCTION electric.tag_operator_lte(first electric.tag, second electric.tag) RETURNS boolean
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN first.timestamp < second.timestamp
           OR (first.timestamp = second.timestamp
               AND (first.source_id IS NOT NULL AND second.source_id IS NULL
                    OR first.source_id IS NOT DISTINCT FROM second.source_id)
                    OR (first.source_id IS NOT NULL AND second.source_id IS NOT NULL AND first.source_id < second.source_id));

CREATE OPERATOR = (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_eq,
    COMMUTATOR = =,
    NEGATOR = <>,
    RESTRICT = eqsel,
    JOIN = eqjoinsel,
    HASHES,
    MERGES
);


CREATE OPERATOR <> (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_neq,
    COMMUTATOR = <>,
    NEGATOR = =,
    RESTRICT = neqsel,
    JOIN = neqjoinsel
);


CREATE OPERATOR < (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_lt,
    COMMUTATOR = >,
    NEGATOR = >=,
    RESTRICT = scalarltsel,
    JOIN = scalarltjoinsel
);


CREATE OPERATOR > (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_gt,
    COMMUTATOR = <,
    NEGATOR = <=,
    RESTRICT = scalargtsel,
    JOIN = scalargtjoinsel
);



CREATE OPERATOR >= (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_gte,
    COMMUTATOR = <=,
    NEGATOR = <,
    RESTRICT = scalargtsel,
    JOIN = scalargtjoinsel
);


CREATE OPERATOR <= (
    LEFTARG = electric.tag,
    RIGHTARG = electric.tag,
    FUNCTION = electric.tag_operator_lte,
    COMMUTATOR = >=,
    NEGATOR = >,
    RESTRICT = scalarltsel,
    JOIN = scalarltjoinsel
);


CREATE OR REPLACE FUNCTION electric.tag_operator_cmp(first electric.tag, second electric.tag) RETURNS integer
    LANGUAGE SQL
    IMMUTABLE PARALLEL SAFE
    COST 1
    RETURNS NULL ON NULL INPUT
    RETURN CASE
        WHEN first = second then 0
        WHEN first < second then -1
        ELSE 1
    END;


CREATE OPERATOR CLASS btree__electric_tag_ops
    DEFAULT FOR TYPE electric.tag USING btree AS
        OPERATOR 1 <,
        OPERATOR 2 <=,
        OPERATOR 3 =,
        OPERATOR 4 >=,
        OPERATOR 5 >,
        FUNCTION 1 electric.tag_operator_cmp(electric.tag, electric.tag);