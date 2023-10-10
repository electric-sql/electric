-- https://linear.app/electric-sql/issue/VAX-1172/ddlx-parser-fails-to-parse-table-name-publicitems
-- re-enable after this fix:
-- ALTER TABLE "public"."Items" ENABLE ELECTRIC;

CALL electric.electrify('public."Items"');
