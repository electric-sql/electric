-- preprocessed by pgsqlpp for PG=14
--
--  DDL eXtractor functions
--  version 0.23 lacanoid@ljudmila.org
--
---------------------------------------------------

SET client_min_messages = warning;

---------------------------------------------------

---------------------------------------------------
--  Helpers for digesting system catalogs
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_identify(
  IN oid,  
  OUT oid oid, OUT classid regclass, 
  OUT name name,  OUT namespace name,  
  OUT owner name, OUT sql_kind text, 
  OUT sql_identifier text, OUT acl aclitem[])
 RETURNS record LANGUAGE sql AS $function$
  WITH 
  rel_kind(k,v) AS (
         VALUES ('r','TABLE'),
                ('p','TABLE'),
                ('v','VIEW'),
                ('i','INDEX'),
                ('I','INDEX'),
                ('S','SEQUENCE'),
                ('s','SPECIAL'),
                ('m','MATERIALIZED VIEW'),
                ('c','TYPE'),
                ('t','TOAST'),
                ('f','FOREIGN TABLE')
  ),
  typ_type(k,v,v2) AS (
         VALUES ('b','BASE','TYPE'),
                ('c','COMPOSITE','TYPE'),
                ('d','DOMAIN','DOMAIN'),
                ('e','ENUM','TYPE'),
                ('p','PSEUDO','TYPE'),
                ('r','RANGE','TYPE')
  )
  SELECT coalesce(t.oid,c.oid),
         case when t.oid is not null then 'pg_type'::regclass
	            else 'pg_class'::regclass end,
	       c.relname AS name, n.nspname AS namespace,
         pg_get_userbyid(c.relowner) AS owner,
         coalesce(cc.v,c.relkind::text) AS sql_kind,
         cast($1::regclass AS text) AS sql_identifier,
         relacl as acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_type t ON t.typrelid=c.oid AND t.typtype='c' AND c.relkind='c'
    LEFT JOIN rel_kind AS cc on cc.k = c.relkind
   WHERE c.oid = $1
   UNION ALL
  SELECT p.oid,'pg_proc'::regclass,
         p.proname AS name, n.nspname AS namespace, pg_get_userbyid(p.proowner) AS owner,
         case p.prokind
           when 'f' then 'FUNCTION'
           when 'a' then 'AGGREGATE'
           when 'p' then 'PROCEDURE'
           when 'w' then 'WINDOW FUNCTION'
         end 
         AS sql_kind,
         cast($1::regprocedure AS text) AS sql_identifier,
         proacl as acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE p.oid = $1
   UNION ALL
  SELECT coalesce(c.oid,t.oid),
         case when c.oid is not null then 'pg_class'::regclass
	 else 'pg_type'::regclass end,
         t.typname AS name, n.nspname AS namespace, pg_get_userbyid(t.typowner) AS owner,
         coalesce(cc.v,tt.v2,t.typtype::text) AS sql_kind,
         format_type($1,null) AS sql_identifier,
         typacl as acl
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    LEFT JOIN typ_type AS tt ON tt.k = t.typtype 
    LEFT JOIN pg_class AS c ON c.oid = t.typrelid AND t.typtype='c' AND c.relkind<>'c'
    LEFT JOIN rel_kind AS cc ON cc.k = c.relkind
   WHERE t.oid = $1
   UNION ALL
  SELECT r.oid,'pg_roles'::regclass,
         r.rolname as name, null as namespace, null as owner,
         'ROLE' as sql_kind,
         quote_ident(r.rolname) as sql_identifier,
         null as acl
    FROM pg_roles r
   WHERE r.oid = $1
   UNION ALL
  SELECT r.oid,'pg_rewrite'::regclass,
         r.rulename as name, null as namespace, null as owner,
         'RULE' as sql_kind,
         quote_ident(r.rulename)||' ON '|| 
           cast(c.oid::regclass as text) sql_identifier,
         null as acl
    FROM pg_rewrite r JOIN pg_class c on (c.oid = r.ev_class)
   WHERE r.oid = $1
   UNION ALL
  SELECT n.oid,'pg_namespace'::regclass,
         n.nspname as name, current_database() as namespace, pg_get_userbyid(n.nspowner) AS owner,
         'SCHEMA' as sql_kind,
         quote_ident(n.nspname) as sql_identifier,
         nspacl as acl
    FROM pg_namespace n join pg_roles r on r.oid = n.nspowner
   WHERE n.oid = $1
   UNION ALL
  SELECT con.oid,'pg_constraint'::regclass,
         con.conname as name,
         c.relname as namespace, null as owner, 'CONSTRAINT' as sql_kind,
         quote_ident(con.conname)
         ||coalesce(' ON '||cast(c.oid::regclass as text),'') as sql_identifier,
         null as acl
    FROM pg_constraint con 
    left JOIN pg_class c ON (con.conrelid=c.oid)
    LEFT join (
         values ('f','FOREIGN KEY'), ('c','CHECK'), ('x','EXCLUDE'),
                ('u','UNIQUE'), ('p','PRIMARY KEY'), ('t','TRIGGER')) 
             as tt on tt.column1 = con.contype
   WHERE con.oid = $1
   UNION ALL
  SELECT t.oid,'pg_trigger'::regclass,
         t.tgname as name, c.relname as namespace, null as owner,
         'TRIGGER' as sql_kind,
         format('%I ON %s',t.tgname,cast(c.oid::regclass as text)) as sql_identifier,
         null as acl
    FROM pg_trigger t join pg_class c on (t.tgrelid=c.oid)
   WHERE t.oid = $1
   UNION ALL
  SELECT ad.oid,'pg_attrdef'::regclass,
         a.attname as name, c.relname as namespace, null as owner,
         'DEFAULT' as sql_kind,
         format('%s.%I',cast(c.oid::regclass as text),a.attname) as sql_identifier,
         null as acl
    FROM pg_attrdef ad 
    JOIN pg_class c ON (ad.adrelid=c.oid)
    JOIN pg_attribute a ON (c.oid = a.attrelid and a.attnum=ad.adnum)
   WHERE ad.oid = $1
   UNION ALL
  SELECT op.oid,'pg_operator'::regclass,
         op.oprname as name, n.nspname as namespace, pg_get_userbyid(op.oprowner) as owner,
         'OPERATOR' as sql_kind,
         cast(op.oid::regoperator as text) as sql_identifier,
         null as acl
    FROM pg_operator op JOIN pg_namespace n ON n.oid=op.oprnamespace
   WHERE op.oid = $1
   UNION ALL
  SELECT cfg.oid,'pg_ts_config'::regclass,
         cfg.cfgname as name, n.nspname as namespace, pg_get_userbyid(cfg.cfgowner) as owner,
         'TEXT SEARCH CONFIGURATION' as sql_kind,
         cast(cfg.oid::regconfig as text) as sql_identifier,
         null as acl
    FROM pg_ts_config cfg JOIN pg_namespace n ON n.oid=cfg.cfgnamespace
   WHERE cfg.oid = $1
   UNION ALL
  SELECT dict.oid,'pg_ts_dict'::regclass,
         dict.dictname as name, n.nspname as namespace, pg_get_userbyid(dict.dictowner) as owner,
         'TEXT SEARCH DICTIONARY' as sql_kind,
         cast(dict.oid::regdictionary as text) as sql_identifier,
         null as acl
    FROM pg_ts_dict dict JOIN pg_namespace n ON n.oid=dict.dictnamespace
   WHERE dict.oid = $1
   UNION ALL
  SELECT prs.oid,'pg_ts_parser'::regclass,
         prs.prsname as name, n.nspname as namespace, null as owner,
         'TEXT SEARCH PARSER' as sql_kind,
         format('%s%I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',prs.prsname) 
           as sql_identifier,
         null as acl
    FROM pg_ts_parser prs JOIN pg_namespace n ON n.oid=prs.prsnamespace
   WHERE prs.oid = $1
   UNION ALL
  SELECT tmpl.oid,'pg_ts_template'::regclass,
         tmpl.tmplname as name, n.nspname as namespace, null as owner,
         'TEXT SEARCH TEMPLATE' as sql_kind,
         format('%s%I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',tmpl.tmplname) 
           as sql_identifier,
         null as acl
    FROM pg_ts_template tmpl JOIN pg_namespace n ON n.oid=tmpl.tmplnamespace
   WHERE tmpl.oid = $1
   UNION ALL
  SELECT fdw.oid,'pg_foreign_data_wrapper'::regclass,
         fdw.fdwname as name, null as namespace, pg_get_userbyid(fdw.fdwowner) as owner,
         'FOREIGN DATA WRAPPER' as sql_kind,
         quote_ident(fdw.fdwname) as sql_identifier,
         fdwacl as acl
    FROM pg_foreign_data_wrapper fdw
   WHERE fdw.oid = $1
   UNION ALL
  SELECT srv.oid,'pg_foreign_server'::regclass,
         srv.srvname as name, null as namespace, pg_get_userbyid(srv.srvowner) as owner,
         'SERVER' as sql_kind,
         quote_ident(srv.srvname) as sql_identifier,
         srvacl as acl
    FROM pg_foreign_server srv
   WHERE srv.oid = $1
   UNION ALL
  SELECT ums.umid,'pg_user_mapping'::regclass,
         null as name, null as namespace, null as owner, 'USER MAPPING' as sql_kind,
         'FOR '||quote_ident(ums.usename)||
         ' SERVER '||quote_ident(ums.srvname) as sql_identifier,
         null as acl
    FROM pg_user_mappings ums
   WHERE ums.umid = $1
   UNION ALL
  SELECT ca.oid,'pg_cast'::regclass,
         null as name, null as namespace, null as owner,
         'CAST' as sql_kind,
         format('(%s AS %s)',
           format_type(ca.castsource,null),format_type(ca.casttarget,null))
           as sql_identifier,
         null as acl
    FROM pg_cast ca
   WHERE ca.oid = $1
   UNION ALL
  SELECT co.oid,'pg_collation'::regclass,
         co.collname as name, n.nspname as namespace, pg_get_userbyid(co.collowner) as owner,
         'COLLATION' as sql_kind,
         format('%s%I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',co.collname) 
           as sql_identifier,
         null as acl
    FROM pg_collation co JOIN pg_namespace n ON n.oid=co.collnamespace
   WHERE co.oid = $1
   UNION ALL
  SELECT co.oid,'pg_conversion'::regclass,
         co.conname as name, n.nspname as namespace, pg_get_userbyid(co.conowner) as owner,
         'CONVERSION' as sql_kind,
         format('%s%I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',co.conname) 
           as sql_identifier,
         null as acl
    FROM pg_conversion co JOIN pg_namespace n ON n.oid=co.connamespace
   WHERE co.oid = $1
   UNION ALL
  SELECT lan.oid,'pg_language'::regclass,
         lan.lanname as name, null as namespace, pg_get_userbyid(lan.lanowner) as owner,
         'LANGUAGE' as sql_kind,
         quote_ident(lan.lanname) as sql_identifier,
         lan.lanacl as acl
    FROM pg_language lan
   WHERE lan.oid = $1
   UNION ALL
  SELECT opf.oid,'pg_opfamily'::regclass,
         opf.opfname as name, n.nspname as namespace, pg_get_userbyid(opf.opfowner) as owner,
         'OPERATOR FAMILY' as sql_kind,
         format('%s%I USING %I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',
           opf.opfname,
           am.amname) 
           as sql_identifier,
         null as acl
    FROM pg_opfamily opf JOIN pg_namespace n ON n.oid=opf.opfnamespace
    JOIN pg_am am on (am.oid=opf.opfmethod)
   WHERE opf.oid = $1
   UNION ALL
  SELECT dat.oid,'pg_database'::regclass,
         dat.datname as name, null as namespace, pg_get_userbyid(dat.datdba) as owner,
         'DATABASE' as sql_kind,
         quote_ident(dat.datname) as sql_identifier,
         dat.datacl as acl
    FROM pg_database dat
   WHERE dat.oid = $1
   UNION ALL
  SELECT spc.oid,'pg_tablespace'::regclass,
         spc.spcname as name, null as namespace, pg_get_userbyid(spc.spcowner) as owner,
         'TABLESPACE' as sql_kind,
         quote_ident(spc.spcname) as sql_identifier,
         spc.spcacl as acl
    FROM pg_tablespace spc
   WHERE spc.oid = $1
   UNION ALL
  SELECT opc.oid,'pg_opclass'::regclass,
         opcname as name, n.nspname as namespace, pg_get_userbyid(opc.opcowner) as owner,
         'OPERATOR CLASS' as sql_kind,
         format('%s%I USING %I',
           quote_ident(nullif(n.nspname,current_schema()))||'.',
           opc.opcname,
           am.amname) 
           as sql_identifier,
         null as acl
    FROM pg_opclass opc JOIN pg_namespace n ON n.oid=opc.opcnamespace
    JOIN pg_am am ON am.oid=opc.opcmethod
   WHERE opc.oid = $1
   UNION ALL
  SELECT e.oid, 'pg_extension'::regclass,
         e.extname AS name, e.extnamespace::text AS namespace, pg_get_userbyid(e.extowner) AS owner,
         'EXTENSION'::text AS sql_kind,
         e.extname AS sql_identifier,
         NULL::aclitem[] AS acl
    FROM pg_extension e
   WHERE e.oid = $1   
   UNION ALL
  SELECT evt.oid,'pg_event_trigger'::regclass,
         evt.evtname as name, null as namespace, pg_get_userbyid(evt.evtowner) as owner,
         'EVENT TRIGGER' as sql_kind,
         quote_ident(evt.evtname) as sql_identifier,
         null as acl
    FROM pg_event_trigger evt
   WHERE evt.oid = $1
   UNION ALL
  SELECT amproc.oid,'pg_amproc'::regclass,
         'FUNCTION '||amprocnum, null as namespace, null as owner,
         'AMPROC' as sql_kind,
         format('FUNCTION %s (%s)',
	        amprocnum,
	        array_to_string(array[amproclefttype,amprocrighttype]::regtype[],','))
         as sql_identifier,
         null as acl
    FROM pg_amproc amproc
   WHERE amproc.oid = $1
   UNION ALL
  SELECT amop.oid,'pg_amop'::regclass,
         'OPERATOR '||amopstrategy, null as namespace, null as owner,
         'AMOP' as sql_kind,
         format('OPERATOR %s (%s)',
	        amopstrategy,
	        array_to_string(array[amoplefttype,amoprighttype]::regtype[],','))
         as sql_identifier,
         null as acl
    FROM pg_amop amop
   WHERE amop.oid = $1
   UNION ALL
  SELECT pol.oid,'pg_policy'::regclass,
         pol.polname as name, null as namespace, null as owner,
         'POLICY' as sql_kind,
         format('%I ON %s',
                  polname,
                  cast(c.oid::regclass as text)) 
         as sql_identifier,
         null as acl
    FROM pg_policy pol JOIN pg_class c on (c.oid=pol.polrelid)
   WHERE pol.oid = $1
   UNION ALL
  SELECT trf.oid,'pg_transform'::regclass,
         null as name, null as namespace, null as owner,
         'TRANSFORM' as sql_kind,
         format('FOR %s LANGUAGE %I',
                  format_type(trf.trftype,null),
                  l.lanname) as sql_identifier,
         null as acl
    FROM pg_transform trf JOIN pg_language l on (l.oid=trf.trflang)
   WHERE trf.oid = $1
   UNION ALL
  SELECT am.oid,'pg_am'::regclass,
         am.amname as name, NULL as namespace, NULL as owner,
         'ACCESS METHOD' as sql_kind,
         quote_ident(amname) as sql_identifier,
         null as acl
    FROM pg_am am
   WHERE am.oid = $1
   UNION ALL
  SELECT stx.oid,'pg_statistic_ext'::regclass,
         stx.stxname, n.nspname as namespace, pg_get_userbyid(stx.stxowner) as owner,
         'STATISTICS' as sql_kind,
         format('%s%I',quote_ident(nullif(n.nspname,current_schema()))||'.',stx.stxname) 
         as sql_identifier,
         null as acl
    FROM pg_statistic_ext stx join pg_namespace n on (n.oid=stxnamespace)
   WHERE stx.oid = $1
   UNION ALL
  SELECT pub.oid,'pg_publication'::regclass,
         pub.pubname, NULL as namespace, pg_get_userbyid(pub.pubowner) as owner,
         'PUBLICATION' as sql_kind,
         quote_ident(pub.pubname) as sql_identifier,
         null as acl
    FROM pg_publication pub
   WHERE pub.oid = $1
   UNION ALL
  SELECT sub.oid,'pg_subscription'::regclass,
         sub.subname, NULL as namespace, pg_get_userbyid(sub.subowner) as owner,
         'SUBSCRIPTION' as sql_kind,
         quote_ident(sub.subname) as sql_identifier,
         null as acl
    FROM pg_subscription sub
   WHERE sub.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_describe(
  IN regclass,
  OUT ord smallint,
  OUT name name, OUT type text, OUT size integer, OUT not_null boolean,
  OUT "default" text,
  OUT ident text, OUT gen text,
  OUT comment text, OUT primary_key name,
  OUT is_local boolean, OUT storage text, OUT collation text, 
  OUT namespace name, OUT class_name name, OUT sql_identifier text,
  OUT relid oid, OUT options text[], OUT definition text,
  OUT sequence regclass)
 RETURNS SETOF record LANGUAGE sql AS $function$
SELECT  a.attnum AS ord,
        a.attname AS name, 
        format_type(t.oid, NULL::integer) AS type,
        CASE
            WHEN (a.atttypmod - 4) > 0 THEN a.atttypmod - 4
            ELSE NULL::integer
        END AS size,
        a.attnotnull AS not_null,
        pg_get_expr(def.adbin,def.adrelid) AS "default",
	nullif(a.attidentity::text,''),
	nullif(a.attgenerated::text,''),
        col_description(c.oid, a.attnum::integer) AS comment,
        con.conname AS primary_key,
        a.attislocal AS is_local,
        case when a.attstorage<>t.typstorage
             then case a.attstorage
	          when 'p' then 'plain'::text
	          when 'e' then 'external'::text
	          when 'm' then 'main'::text
	          when 'x' then 'extended'::text
                  else a.attstorage::text
		  end
        end as storage,
        nullif(col.collcollate::text,'') AS collation,
        s.nspname AS namespace,
        c.relname AS class_name,
        format('%s.%I',text(c.oid::regclass),a.attname) AS sql_identifier,
        c.oid as relid,
        attoptions||attfdwoptions as options,
	format('%I %s%s%s%s%s%s%s',
         a.attname::text,
	 format_type(t.oid, a.atttypmod),
         case
           when a.attfdwoptions is not null
           then (
             select ' OPTIONS ( '||string_agg(
                quote_ident(option_name)||' '||quote_nullable(option_value), 
                ', ')||' ) '
               from pg_options_to_table(a.attfdwoptions))
         end,
         CASE
           WHEN length(col.collcollate) > 0
           THEN ' COLLATE ' || quote_ident(col.collcollate::text)
         END
	 ,
	 case when a.attnotnull and attidentity not in ('a','d') then ' NOT NULL' end
	 ,
    coalesce(' DEFAULT ' || pg_get_expr(def.adbin, def.adrelid), ''),
	case when attidentity in ('a','d')
	     then format(' GENERATED %s AS IDENTITY',
	       case attidentity
	       when 'a' then 'ALWAYS'
	       when 'd' then 'BY DEFAULT'
	       end)
	     end
	,
	case when a.attgenerated = 's'
	     then format(' GENERATED ALWAYS AS %s STORED', 
	     	         pg_get_expr(def.adbin,def.adrelid))
	end
	 )
        AS definition,
        pg_get_serial_sequence(c.oid::regclass::text,a.attname)::regclass as sequence	
   FROM pg_class c
   JOIN pg_namespace s ON s.oid = c.relnamespace
   JOIN pg_attribute a ON c.oid = a.attrelid
   LEFT JOIN pg_attrdef def ON c.oid = def.adrelid AND a.attnum = def.adnum
   LEFT JOIN pg_constraint con
        ON con.conrelid = c.oid AND (a.attnum = ANY (con.conkey)) AND con.contype = 'p'
   LEFT JOIN pg_type t ON t.oid = a.atttypid
   LEFT JOIN pg_collation col ON col.oid = a.attcollation
   JOIN pg_namespace tn ON tn.oid = t.typnamespace
   LEFT JOIN pg_depend d ON def.oid = d.objid AND d.deptype='n'
   LEFT JOIN pg_class seq ON seq.oid = d.refobjid AND seq.relkind='S'
  WHERE c.relkind IN ('r','v','c','f','p') AND a.attnum > 0 AND NOT a.attisdropped
    AND has_table_privilege(c.oid, 'select') AND has_schema_privilege(s.oid, 'usage')
    AND c.oid = $1
  ORDER BY s.nspname, c.relname, a.attnum;
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_get_constraints(
 regclass default null,
 OUT namespace name, 
 OUT class_name name, 
 OUT constraint_name name, 
 OUT constraint_type text, 
 OUT constraint_definition text, 
 OUT is_deferrable boolean, 
 OUT initially_deferred boolean, 
 OUT regclass oid, 
 OUT sysid oid,
 OUT is_local boolean)
 RETURNS SETOF record LANGUAGE sql AS $function$
 SELECT nc.nspname AS namespace, 
        r.relname AS class_name, 
        c.conname AS constraint_name, 
        case c.contype
            when 'c'::"char" then 'CHECK'::text
            when 'f'::"char" then 'FOREIGN KEY'::text
            when 'p'::"char" then 'PRIMARY KEY'::text
            when 'u'::"char" then 'UNIQUE'::text
            when 't'::"char" then 'TRIGGER'::text
            when 'x'::"char" then 'EXCLUDE'::text
            else c.contype::text
        end,
        pg_get_constraintdef(c.oid,true) AS constraint_definition,
        c.condeferrable AS is_deferrable, 
        c.condeferred  AS initially_deferred, 
        r.oid as regclass, c.oid AS sysid,
	d.refobjid is null AS is_local
   FROM pg_constraint c
   JOIN pg_class r ON c.conrelid = r.oid
   JOIN pg_namespace nc ON nc.oid = c.connamespace
   JOIN pg_namespace nr ON nr.oid = r.relnamespace
   LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype='P'
  WHERE $1 IS NULL OR r.oid=$1
$function$;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_get_rules(
  regclass default null,
  OUT namespace text, OUT class_name text, OUT rule_name text, OUT rule_event text, 
  OUT is_instead boolean, OUT rule_definition text, OUT regclass regclass)
 RETURNS SETOF record LANGUAGE sql AS $function$
 SELECT n.nspname::text AS namespace, 
        c.relname::text AS class_name, 
        r.rulename::text AS rule_name, 
        CASE
            WHEN r.ev_type = '1'::"char" THEN 'SELECT'::text
            WHEN r.ev_type = '2'::"char" THEN 'UPDATE'::text
            WHEN r.ev_type = '3'::"char" THEN 'INSERT'::text
            WHEN r.ev_type = '4'::"char" THEN 'DELETE'::text
            ELSE 'UNKNOWN'::text
        END AS rule_event, 
        r.is_instead, 
        pg_get_ruledef(r.oid, true) AS rule_definition, 
        c.oid::regclass AS regclass
   FROM pg_rewrite r
   JOIN pg_class c ON c.oid = r.ev_class
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE ($1 IS NULL OR c.oid=$1)
    AND NOT (r.ev_type = '1'::"char" AND r.rulename = '_RETURN'::name)
  ORDER BY r.oid
  $function$;
  
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_get_triggers(
  regclass default null,
  OUT oid oid,
  OUT is_constraint text, OUT trigger_name text, OUT action_order text, 
  OUT event_manipulation text, OUT event_object_sql_identifier text, 
  OUT action_statement text, OUT action_orientation text,
  OUT trigger_definition text, OUT regclass regclass, OUT regprocedure regprocedure, 
  OUT event_object_schema text, OUT event_object_table text, OUT sql_identifier text)
 RETURNS SETOF record LANGUAGE sql AS $function$
 SELECT t.oid,
        CASE t.tgisinternal
            WHEN true THEN 'CONSTRAINT'::text
            ELSE NULL::text
        END AS is_constraint, t.tgname::text AS trigger_name, 
        CASE (t.tgtype::integer & 64) <> 0
            WHEN true THEN 'INSTEAD'::text
            ELSE CASE t.tgtype::integer & 2
              WHEN 2 THEN 'BEFORE'::text
              WHEN 0 THEN 'AFTER'::text
              ELSE NULL::text
            END
        END AS action_order, 
        array_to_string(array[
          case when (t.tgtype::integer &  4) <> 0 then 'INSERT'   end,
          case when (t.tgtype::integer &  8) <> 0 then 'DELETE'   end,
          case when (t.tgtype::integer & 16) <> 0 then 'UPDATE'   end,
          case when (t.tgtype::integer & 32) <> 0 then 'TRUNCATE' end
        ],' OR ') AS event_manipulation,
        c.oid::regclass::text AS event_object_sql_identifier, 
        p.oid::regprocedure::text AS action_statement, 
        CASE t.tgtype::integer & 1
            WHEN 1 THEN 'ROW'::text
            ELSE 'STATEMENT'::text
        END AS action_orientation, 
        pg_get_triggerdef(t.oid,true) as trigger_definition,
        c.oid::regclass AS regclass, 
        p.oid::regprocedure AS regprocedure, 
        s.nspname::text AS event_object_schema,
        c.relname::text AS event_object_table, 
        (quote_ident(t.tgname::text) || ' ON ') || c.oid::regclass::text AS sql_identifier
   FROM pg_trigger t
   LEFT JOIN pg_class c ON c.oid = t.tgrelid
   LEFT JOIN pg_namespace s ON s.oid = c.relnamespace
   LEFT JOIN pg_proc p ON p.oid = t.tgfoid
   LEFT JOIN pg_namespace s1 ON s1.oid = p.pronamespace
   WHERE $1 IS NULL OR c.oid=$1
$function$;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_get_indexes(
  regclass default null,
  OUT oid oid, OUT namespace text, OUT class text, OUT name text, 
  OUT tablespace text, OUT constraint_name text, OUT is_local boolean)
 RETURNS SETOF record LANGUAGE sql AS $function$
 SELECT DISTINCT
        i.oid AS oid, 
        n.nspname::text AS namespace, 
        c.relname::text AS class, 
        i.relname::text AS name,
        NULL::text AS tablespace, 
        cc.conname::text AS constraint_name,
	d2.refobjid IS NULL AS is_local
   FROM pg_index x
   JOIN pg_class c ON c.oid = x.indrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_class i ON i.oid = x.indexrelid
   JOIN pg_depend d ON d.objid = x.indexrelid
   LEFT JOIN pg_depend d2 ON d2.objid = x.indexrelid
        AND d2.deptype='P' AND d2.refclassid='pg_class'::regclass
   LEFT JOIN pg_constraint cc
        ON cc.oid = d.refobjid AND d.refclassid='pg_constraint'::regclass
  WHERE c.relkind in ('r','m','p')
    AND i.relkind in ('i','I')
    AND d.deptype in ('i','a')
    AND ($1 IS NULL OR c.oid = $1)
$function$;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_get_functions(
  regproc default null,
  OUT sysid oid, OUT namespace name, OUT name name, OUT comment text, 
  OUT owner name, OUT sql_identifier text, OUT language name, OUT attributes text, 
  OUT retset boolean, OUT is_trigger boolean, OUT returns text, OUT arguments text, 
  OUT definition text, OUT security text, OUT is_strict text, OUT argtypes oidvector,
  OUT cost real, OUT rows real)
 RETURNS SETOF record LANGUAGE sql AS $function$
 SELECT p.oid AS sysid, 
        s.nspname AS namespace, 
        p.proname AS name, 
        pg_description.description AS comment, 
        u.rolname AS owner,
        p.oid::regprocedure::text AS sql_identifier, 
        l.lanname AS language, 
        CASE p.provolatile
            WHEN 'i'::"char" THEN 'IMMUTABLE'::text
            WHEN 's'::"char" THEN 'STABLE'::text
            WHEN 'v'::"char" THEN 'VOLATILE'::text
            ELSE NULL::text
        END AS attributes, 
        p.proretset AS retset, 
        p.prorettype = 'trigger'::regtype::oid AS is_trigger, 
        text(p.prorettype::regtype) AS returns, 
        pg_get_function_arguments(p.oid) AS arguments, 
--        oidvectortypes(p.proargtypes) AS argtypes, 
        p.prosrc AS definition, 
        CASE p.prosecdef
            WHEN true THEN 'DEFINER'::text
            ELSE 'INVOKER'::text
        END AS security, 
        case p.proisstrict 
            WHEN true THEN 'STRICT'::text
            ELSE NULL
        END AS is_strict, 
        p.proargtypes AS proargtypes,
        p.procost as cost,
        p.prorows as rows
   FROM pg_proc p
   LEFT JOIN pg_namespace s ON s.oid = p.pronamespace
   LEFT JOIN pg_language l ON l.oid = p.prolang
   LEFT JOIN pg_roles u ON p.proowner = u.oid
   LEFT JOIN pg_description ON p.oid = pg_description.objoid
   WHERE $1 IS NULL OR p.oid = $1
$function$;

-----------------------------------------------------------
--  DDL generator functions for individial object types  --
-----------------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_banner(
   name text, kind text, namespace text, owner text, extra text default null
 )
 RETURNS text LANGUAGE sql AS $function$
  SELECT format(E'%s-- Type: %s ; Name: %s; Owner: %s\n\n',
                E'--\n-- ' || $5 || E'\n',
                $2,$1,$4)
$function$;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_comment(oid)
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select format(
          E'COMMENT ON %s %s IS %L;\n',
          obj.sql_kind, sql_identifier, 
          case 
            when obj.classid='pg_database'::regclass
            then shobj_description(oid,classid::name)
            when obj.classid='pg_tablespace'::regclass
            then shobj_description(oid,classid::name)
            else obj_description(oid)
          end)
   from obj
$function$ strict;

---------------------------------------------------
-- forward declarations, will be redefined later
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create(oid, text[] default '{}') RETURNS text
  LANGUAGE sql AS $function$ select null::text $function$;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_owner(oid)
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select
   case
     when obj.sql_kind = 'INDEX' then ''
     else 'ALTER '||sql_kind||' '||sql_identifier||
          ' OWNER TO '||quote_ident(owner)||E';\n'
   end
  from obj 
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_table_constraints(regclass, OUT sql text)
    RETURNS SETOF text LANGUAGE sql AS $function$
  select
      ('CONSTRAINT ' || quote_ident(constraint_name) || ' ' || constraint_definition) as sql
  from @schemaname@.ddlx_get_constraints($1)
  where is_local
  order by constraint_type desc, constraint_name;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_table(regclass, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
  with obj as (select * from @schemaname@.ddlx_identify($1))
  select   
    array_to_string(array[
      'CREATE '||
      case relpersistence
        when 'u' then 'UNLOGGED '
        when 't' then 'TEMPORARY '
        else ''
      end
      || obj.sql_kind || ' ' 
      || case when 'ine' ilike any($2) then 'IF NOT EXISTS ' else '' end
      || obj.sql_identifier
      || case when reloftype>0 then ' OF '||cast(reloftype::regtype as text) else '' end
      || case obj.sql_kind when 'TYPE' then ' AS' else '' end 
      ||
  case
  when c.relispartition
  then ' PARTITION OF ' || (SELECT string_agg(i.inhparent::regclass::text,',')
                             FROM pg_inherits i WHERE i.inhrelid = $1) 

  else
    case when reloftype>0
    then ''
    else
    ' (' ||
      coalesce(E'\n' ||
        array_to_string(
          array_cat(
            (SELECT array_agg('    '||definition) FROM @schemaname@.ddlx_describe($1) WHERE is_local),
            (SELECT array_agg('    '||sql) FROM @schemaname@.ddlx_table_constraints($1))
          ),
          E',\n'
        ), '') || E'\n' ||  ')'

    end
  end
  ,
  case when c.relpartbound is not null
       then pg_get_expr(c.relpartbound,c.oid,true)
  end
  ,
  case
  when not c.relispartition
  then (SELECT 'INHERITS(' || string_agg(i.inhparent::regclass::text,', ') || E')'
          FROM pg_inherits i WHERE i.inhrelid = $1)
  end
  ,
  CASE 
  WHEN p.partstrat IS NOT NULL
  THEN 'PARTITION BY ' || pg_get_partkeydef($1)
  END
  ,
    E'SERVER '||quote_ident(fs.srvname)||E' OPTIONS (\n'||
    (select string_agg(
              '    '||quote_ident(option_name)||' '||quote_nullable(option_value), 
              E',\n')
       from pg_options_to_table(ft.ftoptions))||E'\n)'
    

  ],E'\n  ')
  ||
  E';\n'
 FROM pg_class c JOIN obj ON (true)
 LEFT JOIN pg_foreign_table  ft ON (c.oid = ft.ftrelid)
 LEFT JOIN pg_foreign_server fs ON (ft.ftserver = fs.oid)
 LEFT JOIN pg_partitioned_table p ON p.partrelid = c.oid
 WHERE c.oid = $1
-- AND relkind in ('r','c')
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_view(regclass, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
 select 
 'CREATE '||
  case relkind 
    when 'v' THEN 'OR REPLACE VIEW ' 
    when 'm' THEN 'MATERIALIZED VIEW ' ||
      case when 'ine' ilike any($2) then 'IF NOT EXISTS ' else '' end
  end || (oid::regclass::text) || E' AS\n' ||
  trim(';' from pg_catalog.pg_get_viewdef(oid,true)) ||
  case when relkind='m' and not relispopulated
       then E'\n  WITH NO DATA'
       else E''
  end ||
  E';\n'
 FROM pg_class t
 WHERE oid = $1
   AND relkind in ('v','m')
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_sequence(regclass)
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select 
    'ALTER SEQUENCE '||(oid::regclass::text) 
 ||E'\n INCREMENT BY '||increment
 ||E'\n MINVALUE '||minimum_value
 ||E'\n MAXVALUE '||maximum_value
 ||E'\n START WITH '||start_value
 ||E'\n '|| case cycle_option when 'YES' then 'CYCLE' else 'NO CYCLE' end
 ||E';\n'
 FROM information_schema.sequences s JOIN obj ON (true)
 WHERE sequence_schema = obj.namespace
   AND sequence_name = obj.name
   AND obj.sql_kind = 'SEQUENCE'
$function$  strict;

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_sequence(regclass, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1)),
 seq as (
  select sc.oid::regclass,d.refobjid::regclass,a.attname
   from pg_class sc
   left join pg_depend d on d.objid = sc.oid and d.deptype = 'a'
   left join pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   where relkind='S' and sc.oid = $1
 )
 select 
 'CREATE SEQUENCE '
 || case when 'ine' ilike any($2) then 'IF NOT EXISTS ' else '' end
 ||(obj.oid::regclass::text) || E';\n'
-- || @schemaname@.ddlx_alter_sequence($1)
   from obj;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type_shell(regtype)
 RETURNS text LANGUAGE sql AS $function$
select 'CREATE TYPE ' || format_type(oid,null) || ';\n'
  from pg_type t
 where oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type_base(regtype)
 RETURNS text LANGUAGE sql AS $function$
select 'CREATE TYPE ' || format_type($1,null) || ' (' || E'\n  ' ||
       array_to_string(array[ 
         'INPUT = '  || cast(t.typinput::regproc as text),  
         'OUTPUT = ' || cast(t.typoutput::regproc as text),
         'SEND = ' || cast(nullif(t.typsend,0)::regproc as text), 
         'RECEIVE = ' || cast(nullif(t.typreceive,0)::regproc as text),
         'TYPMOD_IN = ' || cast(nullif(t.typmodin,0)::regproc as text),
         'TYPMOD_OUT = ' || cast(nullif(t.typmodout,0)::regproc as text),
         'ANALYZE = ' || cast(nullif(t.typanalyze,0)::regproc as text),
         'INTERNALLENGTH = ' || 
            case when  t.typlen < 0 then 'VARIABLE' else cast(t.typlen as text) end,
         case when t.typbyval then 'PASSEDBYVALUE' end,
         'ALIGNMENT = ' || 
            case t.typalign
            when 'c' then 'char'
            when 's' then 'int2'
            when 'i' then 'int4'
            when 'd' then 'double'
            end, 
         'STORAGE = ' || 
            case t.typstorage
            when 'p' then 'plain'
            when 'e' then 'external'
            when 'm' then 'main'
            when 'x' then 'extended'
            end, 
         'CATEGORY = ' || quote_nullable(t.typcategory::text),
         case when t.typispreferred then E'PREFERRED = true' end,
         case 
           when t.typdefault is not null 
           then E'DEFAULT = ' || quote_nullable(t.typdefault)
         end,
         case when t.typelem <> 0 then E'ELEMENT = ' || format_type(t.typelem,null) end,
         'DELIMITER = ' || quote_nullable(t.typdelim::text),
         'COLLATABLE = ' ||  case when t.typcollation <> 0 then 'true' else 'false' end
         ], E',\n  ')
       || E'\n);\n\n'
  from pg_type t
 where oid = $1
$function$  strict;

---------------------------------------------------
CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type_range(regtype)
 RETURNS text  LANGUAGE sql AS $function$
select 'CREATE TYPE ' || format_type($1,null) || E' AS RANGE (\n  ' ||
        array_to_string(array[
          'SUBTYPE = '  || format_type(r.rngsubtype,null),
          'SUBTYPE_OPCLASS = '  || quote_ident(opc.opcname),
          case
            when length(col.collcollate) > 0 
            then 'COLLATION = ' || quote_ident(col.collcollate::text)
          end,
          'CANONICAL = ' || cast(nullif(r.rngcanonical,0)::regproc as text),
          'SUBTYPE_DIFF = ' || cast(nullif(r.rngsubdiff,0)::regproc as text)
        ],E'\n  ')
       || E'\n);\n\n'
  from pg_range r
  left join pg_opclass opc on (opc.oid=r.rngsubopc)
  left join pg_collation col on (col.oid=r.rngcollation)
 where r.rngtypid = $1
$function$  strict;
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type_enum(regtype)
 RETURNS text LANGUAGE sql AS $function$
with
ee as (
 select 
   quote_nullable(enumlabel) as label
   from pg_enum
  where enumtypid = $1
  order by enumsortorder
)
select 'CREATE TYPE ' || format_type($1,null) || ' AS ENUM (' || E'\n ' ||
       string_agg(label,E',\n ') || E'\n);\n\n'
  from ee
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type_domain(regtype)
 RETURNS text LANGUAGE sql AS $function$
with
cc as (
  select pg_get_constraintdef(oid) as definition
    from pg_constraint con
   where con.contypid = $1
   order by oid
)
select 'CREATE DOMAIN ' || format_type(t.oid,null) 
       || E' AS ' || format_type(t.typbasetype,typtypmod) 
       || coalesce(E'\n  '||(select string_agg(definition,E'\n  ') from cc),'')
       || case
            when length(col.collcollate) > 0 
            then E'\n  COLLATE ' || quote_ident(col.collcollate::text)
            else ''
          end 
       || coalesce(E'\n  DEFAULT ' || t.typdefault, '')
       || E';\n\n'
  from pg_type t
  left join pg_collation col on (col.oid=t.typcollation)
 where t.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_index(regclass,ddlx_options text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
 with ii as (
 SELECT CASE d.refclassid
            WHEN 'pg_constraint'::regclass 
            THEN 'ALTER TABLE ' || text(c.oid::regclass) 
                 || ' ADD CONSTRAINT ' || quote_ident(cc.conname) 
                 || ' ' || pg_get_constraintdef(cc.oid)
            ELSE pg_get_indexdef(i.oid)
        END
        AS indexdef 
   FROM pg_index x
   JOIN pg_class c ON c.oid = x.indrelid
   JOIN pg_class i ON i.oid = x.indexrelid
   JOIN pg_depend d ON d.objid = x.indexrelid
   LEFT JOIN pg_constraint cc ON cc.oid = d.refobjid
  WHERE i.oid = $1
    -- AND c.relkind in ('r','m','p') AND i.relkind = 'i'::"char"  
)
 SELECT case 
        when 'ine' ilike any($2) 
        then regexp_replace(indexdef,'^CREATE ([\w ]*)?INDEX','CREATE \1INDEX IF NOT EXISTS')
        else indexdef 
        end
        || E';\n'
   FROM ii
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_class(regclass, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1)),

 comments as (
   select 'COMMENT ON COLUMN ' || text($1) || '.' || quote_ident(name) ||
          ' IS ' || quote_nullable(comment) || ';' as cc
     from @schemaname@.ddlx_describe($1) 
    where comment IS NOT NULL 
 ),

 settings as (
   select 'ALTER ' || obj.sql_kind || ' ' || text($1) || ' SET (' || 
          quote_ident(option_name)||'='||quote_nullable(option_value) ||');' as ss
     from pg_options_to_table((select reloptions from pg_class where oid = $1))
     join obj on (true)
 )

 select @schemaname@.ddlx_banner(obj.name,obj.sql_kind,obj.namespace,obj.owner) 
  ||
 case 
  when obj.sql_kind in ('VIEW','MATERIALIZED VIEW') then @schemaname@.ddlx_create_view($1,$2)  
  when obj.sql_kind in ('TABLE','TYPE','FOREIGN TABLE') then @schemaname@.ddlx_create_table($1,$2)
  when obj.sql_kind in ('SEQUENCE') then @schemaname@.ddlx_create_sequence($1,$2)
  when obj.sql_kind in ('INDEX') then @schemaname@.ddlx_create_index($1,$2)
  else '-- UNSUPPORTED CLASS: '||obj.sql_kind
 end 
  ||
  coalesce((select string_agg(cc,E'\n')||E'\n' from comments),'')
  ||
  coalesce(E'\n'||(select string_agg(ss,E'\n')||E'\n' from settings),'') 
  || E'\n'
    from obj
    
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_table_defaults(regclass)
 RETURNS text LANGUAGE sql AS $function$
with
def as (
 select 
    coalesce(
      string_agg(
        format('ALTER TABLE %s ALTER %I SET DEFAULT %s;',
                text($1),name,"default"), 
        E'\n') || E'\n\n', 
    '') as ddl
   from @schemaname@.ddlx_describe($1)
  where "default" is not null
    and "sequence" is null and gen is null
),
seq as (
 select 
    coalesce(
      string_agg(
        format('ALTER SEQUENCE %s OWNED BY %s;',
                "sequence",sql_identifier), 
        E'\n') || E'\n\n', 
    '') as ddl
   from @schemaname@.ddlx_describe($1)
  where "sequence" is not null and ident is null
)
select def.ddl || seq.ddl
  from def,seq
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_table_storage(regclass)
 RETURNS text LANGUAGE sql AS $function$
with 
obj as (select * from @schemaname@.ddlx_identify($1)),
d as (select * from @schemaname@.ddlx_describe($1) order by name),
cs as (
  select 
    coalesce(
      string_agg(format(E'ALTER %s %s ALTER %I SET STORAGE %s;',
      			obj.sql_kind,obj.sql_identifier,d.name,
			storage), E'\n') || E'\n\n', 
    '') as ddl
   from d, obj
  where storage is not null
),
ts as (
  select case when s.oid is not null then
         format(E'ALTER %s %s SET TABLESPACE %I;\n\n',
                obj.sql_kind, obj.sql_identifier, s.spcname) 
         else '' end as ddl
    from obj, pg_class c 
    left join pg_tablespace s on (s.oid=c.reltablespace)
   where c.oid = $1
)
select cs.ddl || ts.ddl
  from cs,ts
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_table_settings(regclass)
 RETURNS text LANGUAGE sql AS $function$
with 
obj as (select * from @schemaname@.ddlx_identify($1)),
ob as (
 select coalesce(string_agg(a.ddl, E'\n') || E'\n\n', '')
        as ddl
 from (
 select
 (select format(E'ALTER %s %s ALTER %I SET ( %s = %s );',
      		 obj.sql_kind,obj.sql_identifier,att.attname,
	         option_name, quote_nullable(option_value))
   from pg_options_to_table(att.attoptions)) as ddl
   from pg_attribute att, obj
  where attnum>0 and att.attrelid=$1 and attoptions is not null and not attisdropped
  order by att.attname
 ) as a
),
os as (
 select coalesce(string_agg(a2.ddl, E'\n') || E'\n\n', '')
        as ddl
 from (
 select format(E'ALTER %s %s ALTER %I SET STATISTICS %s;',
      		 obj.sql_kind,obj.sql_identifier,att.attname,
	         attstattarget) as ddl
   from pg_attribute att, obj
  where attnum>0 and att.attrelid=$1 and attstattarget>=0 and not attisdropped
  order by att.attname
 ) as a2
)
select ob.ddl || os.ddl
  from ob,os
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_default(oid)
 RETURNS text LANGUAGE sql AS $function$
  select format(E'ALTER TABLE %s ALTER %I SET DEFAULT %s;\n',
            cast(c.oid::regclass as text),
            a.attname, 
            pg_get_expr(def.adbin,def.adrelid))
    from pg_attrdef def 
    join pg_class c on c.oid = def.adrelid
    join pg_attribute a on c.oid = a.attrelid and a.attnum = def.adnum and not a.attisdropped
   where def.oid = $1
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop_default(oid)
 RETURNS text LANGUAGE sql AS $function$
  select format(E'ALTER TABLE %s ALTER %I DROP DEFAULT;\n',
            cast(c.oid::regclass as text),
            a.attname)
    from pg_attrdef def 
    join pg_class c on c.oid = def.adrelid
    join pg_attribute a on c.oid = a.attrelid and a.attnum = def.adnum and not a.attisdropped
   where def.oid = $1
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_constraints(regclass)
 RETURNS text LANGUAGE sql AS $function$
 with cs as (
  select
   'ALTER TABLE ' || text(regclass(regclass)) ||  
   ' ADD CONSTRAINT ' || quote_ident(constraint_name) || 
   E'\n  ' || constraint_definition as sql
    from @schemaname@.ddlx_get_constraints($1)
   where is_local
   order by constraint_type desc, constraint_name
 )
 select coalesce(string_agg(sql,E';\n') || E';\n\n','')
   from cs
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_constraint(oid)
 RETURNS text LANGUAGE sql AS $function$
 select format(
   E'ALTER %s %s ADD CONSTRAINT %I\n  %s;\n',
   case
     when t.oid is not null then 'DOMAIN'
     else 'TABLE'
   end,
   coalesce(cast(t.oid::regtype as text),
            cast(r.oid::regclass as text)),
   c.conname, 
   pg_get_constraintdef(c.oid,true)) 
   from pg_constraint c 
   left join pg_class r on (c.conrelid = r.oid)
   left join pg_type t on (c.contypid = t.oid)
  where c.oid = $1 
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop_constraint(oid)
 RETURNS text LANGUAGE sql AS $function$
 select format(
   E'ALTER %s %s DROP CONSTRAINT %I;\n',
   case
     when t.oid is not null then 'DOMAIN'
     else 'TABLE'
   end,
   coalesce(cast(t.oid::regtype as text),
            cast(r.oid::regclass as text)),
   c.conname) 
   from pg_constraint c 
   left join pg_class r on (c.conrelid = r.oid)
   left join pg_type t on (c.contypid = t.oid)
  where c.oid = $1 
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_rules(regclass)
 RETURNS text LANGUAGE sql AS $function$
  select coalesce(string_agg(rule_definition,E'\n')||E'\n\n','')
    from @schemaname@.ddlx_get_rules()
   where regclass = $1
     and rule_definition is not null
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_rule(oid)
 RETURNS text LANGUAGE sql AS $function$
  select case
         when ev_type='1' and r.rulename='_RETURN'
         then @schemaname@.ddlx_create_class(c.oid)
         else pg_get_ruledef(r.oid)
         end
    from pg_rewrite r join pg_class c on (c.oid=r.ev_class)
   where r.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_trigger(oid)
 RETURNS text LANGUAGE sql AS $function$
 select pg_get_triggerdef($1,true)||
        case t.tgenabled 
             when 'D' then format(E';\nALTER TABLE %s DISABLE TRIGGER %I',
                                  cast(t.tgrelid::regclass as text), t.tgname)
             when 'R' then format(E';\nALTER TABLE %s ENABLE REPLICA TRIGGER %I', 
                                  cast(t.tgrelid::regclass as text), t.tgname)
             when 'A' then format(E';\nALTER TABLE %s ENABLE ALWAYS TRIGGER %I', 
                                  cast(t.tgrelid::regclass as text), t.tgname)
             else ''
        end||E';\n'
   from pg_trigger t
  where oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_triggers(regclass)
 RETURNS text LANGUAGE sql AS $function$
 with tg as (
  select @schemaname@.ddlx_create_trigger(oid) as sql 
 from @schemaname@.ddlx_get_triggers($1) where is_constraint is null
 order by trigger_name 
 -- per SQL triggers get called in order created vs name as in PostgreSQL
 )
 select coalesce(string_agg(sql,'')||E'\n','')
   from tg
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop_trigger(oid)
 RETURNS text LANGUAGE sql AS $function$
 select format(
          E'DROP TRIGGER %I ON %s;\n',
          t.tgname,cast(c.oid::regclass as text))
   from pg_trigger t join pg_class c on (t.tgrelid=c.oid)
  where t.oid = $1 
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_indexes(regclass,ddlx_options text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
 with
 ii as (select * from @schemaname@.ddlx_get_indexes($1) order by name),
 a as (
  select coalesce(string_agg(@schemaname@.ddlx_create_index(oid,$2),'') || E'\n' , E'') as ddl_idx
    from ii where constraint_name is null
 ),
 c as (
  select coalesce(string_agg(format(E'CLUSTER %s USING %I;\n\n',
                                    indrelid::regclass::text,
				    (select relname from pg_class c2 where c2.oid=i.indexrelid)),
		  ''),'')
         as ddl_cluster
    from pg_index i
   where i.indrelid = $1 and indisclustered
 )
 ,
 b as (
  select coalesce(string_agg(@schemaname@.ddlx_create(oid),'' order by oid)||E'\n', '') as ddl_stx
    from pg_statistic_ext where stxrelid = $1
 )
select ddl_idx || ddl_cluster || ddl_stx from a,b,c
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_aggregate(regproc)
 RETURNS text LANGUAGE sql AS $function$ 
  with obj as (select * from @schemaname@.ddlx_identify($1))
select 'CREATE AGGREGATE ' || obj.sql_identifier || ' (' || E'\n  ' || 
        array_to_string(array[
          'SFUNC = '  || cast(a.aggtransfn::regproc as text),
          'STYPE = ' || format_type(a.aggtranstype,null),
          case when a.aggtransspace>0 then 'SSPACE = '||a.aggtransspace end,
          'FINALFUNC = ' || cast(nullif(a.aggfinalfn,0)::regproc as text), 
          case when a.aggfinalextra then 'FINALFUNC_EXTRA' end,
          'COMBINEFUNC = ' || cast(nullif(a.aggcombinefn,0)::regproc as text), 
          'SERIALFUNC = ' || cast(nullif(a.aggserialfn,0)::regproc as text), 
          'DESERIALFUNC = ' || cast(nullif(a.aggdeserialfn,0)::regproc as text), 
          'INITCOND = ' || quote_literal(a.agginitval), 
          'MSFUNC = ' || cast(nullif(a.aggmtransfn,0)::regproc as text), 
          'MINVFUNC = ' || cast(nullif(a.aggminvtransfn,0)::regproc as text), 
          case when a.aggmtranstype>0 
               then 'MSTYPE = '||format_type(a.aggmtranstype,null) end,
          case when a.aggmtransspace>0 then 'MSSPACE = '||a.aggmtransspace end,
          'MFINALFUNC = ' || cast(nullif(a.aggmfinalfn,0)::regproc as text),
          case when a.aggmfinalextra then 'MFINALFUNC_EXTRA' end,
          'MINITCOND = ' || quote_literal(a.aggminitval), 
          'PARALLEL = ' || case p.proparallel
            when 's' then 'SAFE'
            when 'r' then 'RESTRICTED'
            when 'u' then null -- 'UNSAFE', default
            else quote_literal(p.proparallel::text)
          end,
          case a.aggkind
            when 'h' then 'HYPOTHETICAL'
          end,
          case when a.aggsortop>0 
               then 'SORTOP = '||cast(a.aggsortop::regoperator as text) end
          ],E',\n  ')
       || E'\n);\n'
  from pg_aggregate a join obj on (true) join pg_proc p on p.oid = a.aggfnoid
 where a.aggfnoid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_function(regproc)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select
  @schemaname@.ddlx_banner(sql_identifier,obj.sql_kind,namespace,owner) ||
  case obj.sql_kind
    when 'AGGREGATE' then @schemaname@.ddlx_create_aggregate($1)
    else trim(trailing E'\n' from pg_get_functiondef($1)) || E';\n'
   end || E'\n' 
   from obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_grants(regrole) 
 RETURNS text LANGUAGE sql AS $function$
with 
q as (
 select format(E'GRANT %I TO %I%s;\n',r1.rolname, r2.rolname,
               case when admin_option then ' WITH ADMIN OPTION' end)
        as ddl1
   from pg_auth_members m
   join pg_roles r1 on (r1.oid=m.roleid)
   join pg_roles r2 on (r2.oid=m.member)
  where (m.member = $1 or m.roleid = $1)
  order by m.roleid = $1,
           cast(r2.rolname as text), 
           cast(r1.rolname as text)
)
select coalesce(string_agg(ddl1,'')||E'\n','')
  from q
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_role_auth(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 select case when rolpassword is not null
	     then 'ALTER ROLE '|| quote_ident(rolname)||
                  ' ENCRYPTED PASSWORD '||quote_literal(rolpassword)
	end
   from pg_authid where oid = $1
$function$  strict;

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_role(regrole)
 RETURNS text
 LANGUAGE sql
AS $function$ 
with 
q1 as (
 select format(E'CREATE %s %I;\n',
                case when rolcanlogin then 'USER' else 'GROUP' end,
                rolname) as ddl
   from pg_roles a
   left join pg_shdescription d on d.objoid=a.oid
  where a.oid = $1
 )
select ddl
  from q1; 
$function$  strict;

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_role(regrole)
 RETURNS text
 LANGUAGE sql
AS $function$ 
with 
q1 as (
 select 
        format(E'ALTER ROLE %I WITH\n  %s;\n\n',rolname,
                array_to_string(array[
   case when rolcanlogin then 'LOGIN' else 'NOLOGIN' end,
   case when rolsuper then 'SUPERUSER' else 'NOSUPERUSER' end,
   case when rolinherit then 'INHERIT' else 'NOINHERIT' end,
   case when rolcreatedb then 'CREATEDB' else 'NOCREATEDB' end,
   case when rolcreaterole then 'CREATEROLE' else 'NOCREATEROLE' end, 
   case when rolbypassrls then 'BYPASSRLS' end,
   case when rolreplication then 'REPLICATION' else 'NOREPLICATION' end
                ],E'\n  ')) ||
   		array_to_string(array[
   case 
     when description is not null 
     then 'COMMENT ON ROLE '||quote_ident(rolname)||
          ' IS '||quote_literal(description)||E';\n'
   end,
   case when has_table_privilege('pg_catalog.pg_authid'::regclass, 'select')
        then @schemaname@.ddlx_alter_role_auth(a.oid)||E';\n'
   end,
   case when rolvaliduntil is not null 
        then 'ALTER ROLE '|| quote_ident(rolname)||
             ' VALID UNTIL '||quote_nullable(rolvaliduntil)||E';\n'
   end,
   case when rolconnlimit>=0  
        then 'ALTER ROLE '|| quote_ident(rolname)||
             ' CONNECTION LIMIT '||rolconnlimit||E';\n'
   end
                ],'') ||
   E'\n'
   as ddl
   from pg_roles a
   left join pg_shdescription d on d.objoid=a.oid
  where a.oid = $1
 ),
q2 as (
 select string_agg('ALTER ROLE ' || quote_ident(rolname)
                   ||' SET '||pg_roles.rolconfig[i]||E';\n','')
    as ddl_config
  from pg_roles,
  generate_series(
     (select array_lower(rolconfig,1) from pg_roles where oid=$1),
     (select array_upper(rolconfig,1) from pg_roles where oid=$1)
  ) as generate_series(i)
 where oid = $1
 ) 
select ddl||coalesce(ddl_config||E'\n','')
  from q1,q2; 
$function$  strict
set datestyle = iso;

---------------------------------------------------
CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_event_trigger(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_event_trigger where oid = $1)
 select
    'CREATE EVENT TRIGGER ' || quote_ident(obj.evtname) ||
    ' ON ' || obj.evtevent || E'\n' ||
    case 
    when obj.evttags is not null
    then '  WHEN tag IN ' || 
      (select '(' || string_agg(quote_nullable(u),', ') || ')' 
         from unnest(obj.evttags) as u) 
        || E'\n'
    else ''
    end ||
    '  EXECUTE PROCEDURE ' || cast(obj.evtfoid as regprocedure) || E';\n'
   from obj;
$function$  strict;
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_foreign_data_wrapper(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_foreign_data_wrapper where oid = $1)
 select
    'CREATE FOREIGN DATA WRAPPER ' || quote_ident(obj.fdwname) || E'\n' ||
    case 
    when obj.fdwhandler is not null
    then '  HANDLER ' || cast(obj.fdwhandler as regproc)
    else '  NO HANDLER'
    end || E'\n' ||
    case 
    when obj.fdwvalidator is not null
    then '  VALIDATOR ' || cast(obj.fdwvalidator as regproc)
    else '  NO VALIDATOR'
    end ||
    coalesce(E'\nOPTIONS (\n'||
      (select string_agg(
              '    '||quote_ident(option_name)||' '||quote_nullable(option_value), 
              E',\n')
         from pg_options_to_table(obj.fdwoptions))||E'\n)'
    ,'') || E';\n' 
   from obj;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_server(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_foreign_server where oid = $1)
 select
    'CREATE SERVER ' ||
     case when 'ine' ilike any($2) then 'IF NOT EXISTS ' else '' end  ||
     quote_ident(obj.srvname) ||
     coalesce(E'\nTYPE ' || quote_literal(obj.srvtype),'') ||
     coalesce(E'\nVERSION ' || quote_literal(obj.srvversion),'') ||
     E' FOREIGN DATA WRAPPER ' || 
      (select quote_ident(fdwname)
         from pg_foreign_data_wrapper
        where oid = obj.srvfdw) ||
     coalesce(E'\nOPTIONS (\n'||
      (select string_agg(
              '    '||quote_ident(option_name)||' '||quote_nullable(option_value), 
              E',\n')
         from pg_options_to_table(obj.srvoptions))||E'\n)'
    ,'') || E';\n' 
   from obj;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_user_mapping(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select
    'CREATE USER MAPPING '
    || case when 'ine' ilike any($2) then 'IF NOT EXISTS ' else '' end 
    || obj.sql_identifier ||
    coalesce(E'\nOPTIONS (\n'||
      (select string_agg(
              '    '||quote_ident(option_name)||' '||quote_nullable(option_value), 
              E',\n')
         from pg_options_to_table(um.umoptions))||E'\n)'
    ,'') || E';\n' 
   from obj
   join pg_user_mapping um ON um.oid = obj.oid;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_policy(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from @schemaname@.ddlx_identify($1)),
 pol1 as (
 SELECT
    pol.oid,
    n.nspname AS schemaname,
    c.relname AS tablename,
    pol.polname AS policyname,
        CASE
            WHEN pol.polroles = '{0}'::oid[] 
            THEN string_to_array('PUBLIC'::text, ''::text)::name[]
            ELSE ARRAY( SELECT pg_authid.rolname
               FROM pg_authid
              WHERE pg_authid.oid = ANY (pol.polroles)
              ORDER BY pg_authid.rolname)
        END AS roles,
        CASE pol.polcmd
            WHEN 'r'::"char" THEN 'SELECT'::text
            WHEN 'a'::"char" THEN 'INSERT'::text
            WHEN 'w'::"char" THEN 'UPDATE'::text
            WHEN 'd'::"char" THEN 'DELETE'::text
            WHEN '*'::"char" THEN 'ALL'::text
            ELSE NULL::text
        END AS cmd,
        CASE pol.polpermissive 
            WHEN true THEN 'PERMISSIVE'
            ELSE 'RESTRICTIVE'
        END AS permissive,
    pg_get_expr(pol.polqual, pol.polrelid,true) AS qual,
    pg_get_expr(pol.polwithcheck, pol.polrelid,true) AS with_check
   FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
)
select format(
           E'CREATE POLICY %s\n  %s;\n',
            obj.sql_identifier,
			array_to_string(array[
             'AS '||nullif(p.permissive,'PERMISSIVE'),
             'FOR '||p.cmd,
             'TO '||array_to_string(p.roles,', '),
             'USING ('||p.qual||')',
             'WITH CHECK ('||p.with_check||')'
             ],E'\n  ')
             )
   from obj join pol1 p using (oid);
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_transform(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_transform where oid = $1)
 select format(
           E'CREATE OR REPLACE TRANSFORM %s (\n'||
           E'  FROM SQL WITH FUNCTION %s\n' ||
           E'  TO SQL WITH FUNCTION %s\n);\n',
           format('FOR %s LANGUAGE %I',
                  format_type(obj.trftype,null),
                  l.lanname),
            cast(obj.trffromsql::regprocedure as text),
            cast(obj.trftosql::regprocedure as text)
        )
   from obj join pg_language l on (l.oid=obj.trflang);
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_publication(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_publication where oid = $1)
 select format(
           E'CREATE PUBLICATION %I\n  FOR %s\n  WITH ( publish=%L );\n',
	   obj.pubname,
	   case when obj.puballtables then 'ALL TABLES'
	        else format('TABLE %s',(
		  select string_agg(cast(prrelid::regclass as text),', ')
		    from pg_publication_rel
		   where prpubid = $1
		))
           end,
	   array_to_string(array[
		 case when obj.pubinsert then 'insert' end
		,case when obj.pubupdate then 'update' end
		,case when obj.pubdelete then 'delete' end
		,case when obj.pubtruncate then 'truncate' end
	    ],',')
	   )
   from obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_subscription(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_subscription where oid = $1)
 select format(
           E'CREATE SUBSCRIPTION %I\n  CONNECTION %L\n  PUBLICATION %s\n  WITH (\n    %s );\n',
	   obj.subname,
	   obj.subconninfo,
	   array_to_string(obj.subpublications,', '),
	   array_to_string(array[
		'connect='||quote_literal(obj.subenabled),
		'slot_name='||quote_literal(obj.subslotname),
		'synchronous_commit='||quote_literal(obj.subsynccommit)
	   ],E'\n    ')	   
	   )
   from obj
$function$  strict;

---------------------------------------------------
--  Grants
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_grants_columns(regclass) 
 RETURNS text LANGUAGE sql AS $function$
with
obj as (select * from @schemaname@.ddlx_identify($1)),
e as (
select attrelid::regclass,attname,
       (aclexplode(attacl)).* 
  from pg_attribute 
 where attrelid=$1 and not attisdropped
 order by privilege_type,attname
),
a as (
 select attname,
        coalesce(quote_ident(r1.rolname),'PUBLIC') as grantor,
        coalesce(quote_ident(r2.rolname),'PUBLIC') as grantee,
        privilege_type,
        case 
        when is_grantable then ' WITH GRANT OPTION' else ''
        end as grant_option
   from e
   left join pg_roles r1 on (r1.oid = e.grantor)
   left join pg_roles r2 on (r2.oid = e.grantee)
),
b as (
select format('GRANT %s (%s) ON %s TO %s%s',
              privilege_type,attname,obj.sql_identifier,
              grantee,grant_option)
       as dcl
  from obj,a
 order by grantor,grantee,privilege_type,attname
)
select coalesce(string_agg(dcl,E';\n')||E';\n','')
  from b
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_grants(regclass) 
 RETURNS text LANGUAGE sql AS $function$
 with 
 obj as (select * from @schemaname@.ddlx_identify($1)),
 a   as (
 select
   coalesce(format(
        E'GRANT %s ON %s TO %s%s;\n',
        privilege_type, 
        cast($1 as text),
        case grantee  
          when 'PUBLIC' then 'PUBLIC' 
          else quote_ident(grantee) 
        end, 
        case is_grantable  
          when 'YES' then ' WITH GRANT OPTION' 
          else '' 
        end
    ), '') 
    as ddl
 FROM information_schema.table_privileges g 
 join obj on (true)
 WHERE table_schema=obj.namespace 
   AND table_name=obj.name
   AND grantee<>obj.owner
 ORDER BY grantee,privilege_type,obj.name
)
select coalesce(string_agg(a.ddl,''),'')||
       @schemaname@.ddlx_grants_columns($1) from a
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_grants(regproc) 
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select
   format(E'REVOKE ALL ON FUNCTION %s FROM PUBLIC;\n',
          text($1::regprocedure)) ||
   coalesce(
    string_agg (format(
        E'GRANT %s ON FUNCTION %s TO %s%s;\n',
        privilege_type, 
        text($1::regprocedure), 
        case grantee  
          when 'PUBLIC' then 'PUBLIC' 
          else quote_ident(grantee) 
        end,
        case is_grantable  
          when 'YES' then ' WITH GRANT OPTION' 
          else '' 
        end), ''),
    '')
 from information_schema.routine_privileges g 
 join obj on (true)
 where routine_schema=obj.namespace 
   and specific_name=obj.name||'_'||obj.oid
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_grants(oid) 
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1)),
a as (
 select coalesce(quote_ident(r1.rolname),'PUBLIC') as grantor,
        coalesce(quote_ident(r2.rolname),'PUBLIC') as grantee,
        privilege_type,
        case 
        when is_grantable then ' WITH GRANT OPTION' else ''
        end as grant_option
   from aclexplode((select acl from obj)) e
   left join pg_roles r1 on (r1.oid = e.grantor)
   left join pg_roles r2 on (r2.oid = e.grantee)
),
b as (
select format('GRANT %s ON %s %s TO %s%s;',
              privilege_type,
              case obj.sql_kind
              when 'SERVER' then 'FOREIGN SERVER'
              else obj.sql_kind end,
              obj.sql_identifier,
              grantee,grant_option,grantor)
       as dcl
  from obj,a
 where grantee<>obj.owner
 order by grantor,lower(grantee),privilege_type
),
c as (
  select coalesce(string_agg(dcl,E'\n')||E'\n','') as grants
    from b
)
select case obj.classid
       when 'pg_class'::regclass then @schemaname@.ddlx_grants(obj.oid::regclass)
       when 'pg_proc'::regclass then @schemaname@.ddlx_grants(obj.oid::regproc)
       when 'pg_roles'::regclass then @schemaname@.ddlx_grants(obj.oid::regrole)
       else c.grants
       end
  from obj full join c on true
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_language(oid)
 RETURNS text LANGUAGE sql AS $function$ 
 with obj as (select * from pg_language where oid = $1)
 select format(
           E'CREATE OR REPLACE %sLANGUAGE %I%s;\n',
           case when obj.lanpltrusted then 'TRUSTED ' end,
           obj.lanname,
           E'\n  '||nullif(array_to_string(array[
            'HANDLER ' || nullif(lanplcallfoid,0)::regproc::text,
            'INLINE ' || nullif(laninline,0)::regproc::text,
            'VALIDATOR ' || nullif(lanvalidator,0)::regproc::text
           ],' '),'')
        )
   from obj;
$function$  strict;

---------------------------------------------------
--  Dependancy handling
---------------------------------------------------

create or replace function ddlx_get_dependants(
 in oid, 
 out depth int, out classid regclass, out objid oid
)
returns setof record as $$
with recursive 
  tree(depth,classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype,edges) 
as (
select 1,
       case when r.oid is not null then 'pg_class'::regclass 
            else d.classid::regclass 
       end as classid,
       coalesce(r.ev_class,d.objid) as objid,
       d.objsubid, d.refclassid, d.refobjid,d.refobjsubid, d.deptype,
       array[array[d.refobjid::int,d.objid::int]]
  from pg_depend d
  left join pg_rewrite r on 
       (r.oid = d.objid and r.ev_type = '1' and r.rulename = '_RETURN')
 where d.refobjid = $1 and r.ev_class is distinct from d.refobjid
 union all
select depth+1,
       case when r.oid is not null then 'pg_class'::regclass 
            else d.classid::regclass 
       end as classid,
       coalesce(r.ev_class,d.objid) as objid,
       d.objsubid, d.refclassid, d.refobjid, d.refobjsubid, d.deptype,
       t.edges || array[array[d.refobjid::int,d.objid::int]]
  from tree t
  join pg_depend d on (d.refobjid=t.objid) 
  left join pg_rewrite r on 
       (r.oid = d.objid and r.ev_type = '1' and r.rulename = '_RETURN')
 where r.ev_class is distinct from d.refobjid
   and not ( t.edges @> array[array[d.refobjid::int,d.objid::int]] )
),
ddlx_get_dependants_recursive as (
select distinct 
       depth,
       classid,objid,objsubid,
       refclassid,refobjid,refobjsubid,
       deptype
  from tree
),
q as (
  select distinct depth,classid,objid
    from ddlx_get_dependants_recursive
   where deptype = 'n'
)
select depth,classid,objid 
  from q 
 where (objid,depth) in (select objid,max(depth) from q group by objid)
 order by depth,objid
$$ language sql;

---------------------------------------------------
--  Search query bodies
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_apropos(
  pattern text default null,
  OUT classid regclass,
  OUT objid oid,
  OUT sql_identifier text,
  OUT sql_kind text,
  OUT language name, 
  OUT owner name,
  OUT comment text, 
  OUT retset boolean,
  OUT namespace name, OUT name name, 
  OUT source text)
 RETURNS SETOF record LANGUAGE sql AS $function$
with
  rel_kind(k,v) AS (
         VALUES ('r','TABLE'), ('p','TABLE'),('v','VIEW'), ('i','INDEX'), ('I','INDEX'),
                ('S','SEQUENCE'), ('m','MATERIALIZED VIEW'), ('c','TYPE'), ('f','FOREIGN TABLE')
  )
select	'pg_proc'::regclass as classid,
        p.oid AS objid, 
	p.oid::regprocedure::text AS sql_identifier, 
         case p.prokind
           when 'f' then 'FUNCTION'
           when 'a' then 'AGGREGATE'
           when 'p' then 'PROCEDURE'
           when 'w' then 'WINDOW FUNCTION'
         end 
        AS sql_kind,
        l.lanname AS language, 
	p.proowner::regrole::name
	AS owner,
        obj_description(p.oid) AS comment,
        p.proretset AS retset, 
	s.nspname AS namespace, p.proname AS name,
        p.prosrc AS source
   FROM pg_proc p
   JOIN pg_namespace s ON s.oid = p.pronamespace
   JOIN pg_language l ON l.oid = p.prolang
  WHERE ($1 is null
         OR p.oid::regprocedure::text ~ $1
         OR p.prosrc ~ $1
         OR obj_description(p.oid) ~ $1)
    AND has_schema_privilege(s.oid, 'usage')
    AND has_function_privilege(p.oid, 'execute')
UNION
 SELECT	'pg_class'::regclass as classid,
        c.oid AS objid, 
	c.oid::regclass::text AS sql_identifier, 
        k.v AS sql_kind,
        'sql' AS language, 
	c.relowner::regrole::name
	AS owner,
        obj_description(c.oid) AS comment,
        true AS retset, 
	s.nspname AS namespace, c.relname AS name,
        pg_get_viewdef(c.oid,true) AS source
   FROM pg_class c JOIN rel_kind k on k.k=c.relkind
   JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE ($1 is null
         OR c.oid::regclass::text ~ $1
         OR pg_get_viewdef(c.oid,true) ~ $1
         OR obj_description(c.oid) ~ $1)
    AND
        s.oid<>'pg_toast'::regnamespace
    AND has_schema_privilege(s.oid, 'usage')
    AND has_table_privilege(c.oid, 'select')
ORDER BY 2
$function$;


---------------------------------------------------
--  Main script generating functions
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_table_rls(regclass)
 RETURNS text LANGUAGE sql AS $function$
  select case when c.relrowsecurity
	       then 'ALTER TABLE '||cast($1 as text)||E' ENABLE ROW LEVEL SECURITY;\n'
	       else '' end ||
	       case when c.relforcerowsecurity
	       then 'ALTER TABLE '||cast($1 as text)||E' FORCE ROW LEVEL SECURITY;\n'
	       else '' end
    from pg_class c 
   where oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_operator(regoper)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(
         E'CREATE OPERATOR %s%s (\n%s%s%s%s%s%s%s%s%s\n);\n\n',
	 nullif(obj.namespace,current_schema())||'.',
	 obj.name,
         E'  PROCEDURE = '  || cast(o.oprcode::regproc as text),
         case when o.oprleft <> 0 
              then E',\n  LEFTARG = ' || format_type(o.oprleft,null) end,
         case when o.oprright <> 0 
              then E',\n  RIGHTARG = ' || format_type(o.oprright,null) end,
         case when o.oprcom <> 0 
              then E',\n  COMMUTATOR = OPERATOR('||cast(o.oprcom::regoper as text)||')' end,
         case when o.oprnegate <> 0 
              then E',\n  NEGATOR = OPERATOR('||cast(o.oprnegate::regoper as text)||')' end,
         case when o.oprrest <> 0 
              then E',\n  RESTRICT = ' || cast(o.oprrest::regproc as text) end,
         case when o.oprjoin <> 0 
              then E',\n  JOIN = ' || cast(o.oprjoin::regproc as text) end,
         case when o.oprcanhash 
              then E',\n  HASHES' end,
         case when o.oprcanmerge 
              then E',\n  MERGES' end
        )
  from pg_operator o,obj
 where o.oid = $1
$function$  strict;

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_operator(regoperator)
 RETURNS text LANGUAGE sql AS $function$
   select @schemaname@.ddlx_create_operator($1::regoper)
$function$  strict;
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_text_search_config(regconfig)
 RETURNS text LANGUAGE sql AS $function$
with cfg as (select * from pg_ts_config where oid = $1),
     prs as (select * from @schemaname@.ddlx_identify(
              (select p.oid 
                 from pg_ts_parser p
                 join cfg on p.oid = cfg.cfgparser
             )))
select format(E'CREATE TEXT SEARCH CONFIGURATION %s ( PARSER = %s );\n',
              cast($1 as text),
              prs.sql_identifier)
  from prs;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_text_search_dict(regdictionary)
 RETURNS text LANGUAGE sql AS $function$
with dict as (select * from pg_ts_dict where oid = $1),
     tmpl as (select * from @schemaname@.ddlx_identify(
              (select t.oid 
                 from pg_ts_template t
                 join dict on t.oid = dict.dicttemplate
             )))
select format(E'CREATE TEXT SEARCH DICTIONARY %s\n  ( TEMPLATE = %s%s );\n',
       cast($1 as text),
       tmpl.sql_identifier,
       ', '||dict.dictinitoption)
  from dict,tmpl;
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_text_search_parser(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE TEXT SEARCH PARSER %s (\n  %s\n);\n',obj.sql_identifier,
         array_to_string(array[
           'START = '    || cast(nullif(p.prsstart,0)::regproc as text), 
           'GETTOKEN = ' || cast(nullif(p.prstoken,0)::regproc as text), 
           'END = '      || cast(nullif(p.prsend,0)::regproc as text), 
           'LEXTYPES = ' || cast(nullif(p.prslextype,0)::regproc as text), 
           'HEADLINE = ' || cast(nullif(p.prsheadline,0)::regproc as text)
           ],E',\n  ')
        )
  from pg_ts_parser as p, obj
 where p.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_text_search_template(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE TEXT SEARCH TEMPLATE %s (\n  %s\n);\n',obj.sql_identifier,
         array_to_string(array[
           'INIT = '   || cast(nullif(t.tmplinit,0)::regproc as text), 
           'LEXIZE = ' || cast(nullif(t.tmpllexize,0)::regproc as text) 
           ],E',\n  ')
        )
  from pg_ts_template as t, obj
 where t.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_cast(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE CAST %s\n  ',obj.sql_identifier)
        || case
           when c.castmethod = 'i'
           then 'WITH INOUT'
           when c.castfunc>0 
           then 'WITH FUNCTION '||cast(c.castfunc::regprocedure as text)
           else 'WITHOUT FUNCTION'
           end 
        || case c.castcontext
           when 'a' then E'\n  AS ASSIGNMENT'
           when 'i' then E'\n  AS IMPLICIT'
           else ''
           end
        || E';\n'
  from pg_cast as c, obj
 where c.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_collation(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE COLLATION %s%s (\n  %s\n);\n',
         case when 'ine' ilike any($2) then 'IF NOT EXISTS ' end,
         obj.sql_identifier,
         array_to_string(array[
           'LC_COLLATE = '|| quote_nullable(collcollate), 
           'LC_CTYPE = '  || quote_nullable(collctype)
           ,'PROVIDER = ' || 
           case collprovider
           when 'i' then 'icu'
--           when 'c' then 'libc'
           when 'd' then 'default'
           end                 
           ,'DETERMINISTIC = ' || 
           case when not collisdeterministic then 'false' end
           ,'VERSION = ' || quote_literal(collversion)
           ],E',\n  ')
        )
  from pg_collation as c, obj
 where c.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_conversion(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE %sCONVERSION %s\n  FOR %L TO %L FROM %s;\n',
        case when c.condefault then 'DEFAULT ' end,
        obj.sql_identifier,
        pg_encoding_to_char(c.conforencoding),
        pg_encoding_to_char(c.contoencoding),
        cast(c.conproc::regproc as text)
       )
  from pg_conversion as c, obj
 where c.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_tablespace(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE TABLESPACE %s%s;\n',
         obj.sql_identifier,
		 ' LOCATION '||quote_literal(pg_tablespace_location(t.oid))
	     ) || format(E'%s',
         (
   select string_agg(format('ALTER TABLESPACE %s SET ( %s = %s );', 
          obj.sql_identifier,
          quote_ident(option_name),quote_nullable(option_value)),
          E'\n') as ss
     from pg_options_to_table(t.spcoptions)
         ))
  from pg_tablespace as t, obj
 where t.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_database(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE DATABASE %s WITH\n  %s;\n\n',
              obj.sql_identifier,
              array_to_string(array[
               'ENCODING = '||pg_encoding_to_char(d.encoding),
               'LC_COLLATE = '||quote_ident(d.datcollate),
               'LC_CTYPE = '||quote_ident(d.datctype)
              ],E'\n  ')
              ) ||
       case when s.oid is not null then
       format(E'ALTER DATABASE %s SET TABLESPACE %I;\n\n',
              obj.sql_identifier, s.spcname) 
       else '' end 
  from pg_database as d 
  left join pg_tablespace s on (s.oid=d.dattablespace), obj
 where d.oid = $1
$function$  strict;

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter_database(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'ALTER DATABASE %s WITH ALLOW_CONNECTIONS %s;\n',
              obj.sql_identifier, d.datallowconn::text) ||
       case when d.datconnlimit>0 then
       format(E'ALTER DATABASE %s WITH CONNECTION LIMIT %s;\n',
              obj.sql_identifier, d.datconnlimit) 
       else '' end ||
       format(E'ALTER DATABASE %s WITH IS_TEMPLATE %s;\n',
              obj.sql_identifier, d.datistemplate::text)
       ||
       (  select coalesce(e'\n'||string_agg(
                   'ALTER DATABASE '||obj.sql_identifier||' SET '||cfg||';',E'\n'
		   ) || E'\n', '')
          from unnest((select setconfig from pg_db_role_setting
	                where setdatabase = $1 and setrole = 0::oid)) as cfg
       )
  from pg_database as d 
  left join pg_tablespace s on (s.oid=d.dattablespace), obj
 where d.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_access_method(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE ACCESS METHOD %I\n  TYPE %s HANDLER %s;\n\n',
        amname,
        case amtype
          when 'i' then 'INDEX'::text
          else amtype::text
        end,
        cast(amhandler as regproc)
       )
  from pg_am as am, obj
 where am.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_operator_class(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE OPERATOR CLASS %s\n  %sFOR TYPE %s USING %I%s AS %s;\n\n',
        format('%s%I',quote_ident(nullif(obj.namespace,current_schema()))||'.',
                obj.name),
        case when opcdefault then 'DEFAULT ' end,
        format_type(opc.opcintype,null),
        am.amname,
        case when opf.opfname is distinct from opc.opcname
             then format(' FAMILY %I',opf.opfname)
             else '' end,
             coalesce(e'\n  '||(select string_agg(l,e',\n  ') from (
               select format('FUNCTION %s %s',amprocnum,amproc::regprocedure) as l, 1, amprocnum
               from pg_amproc where amprocfamily = opc.opcfamily 
               union all 
               select format('OPERATOR %s %s %s',amopstrategy,amopopr::regoperator,
                             case amoppurpose
                             when 'o' then 'FOR ORDER BY '||
                                           (select quote_ident(opfname)
                                              from pg_opfamily f
                                             where f.oid = amopsortfamily
                                           )
                             when 's' then 'FOR SEARCH'
                             end
                            ) as l, 0, amopstrategy
               from pg_amop where amopfamily = opc.opcfamily 
               union all 
               select format('STORAGE %s',opc.opckeytype::regtype),2,0 where opc.opckeytype <> 0
               order by 2,3
            ) as item),'STORAGE '||format_type(opc.opcintype,null))
       )
  from pg_opclass as opc join pg_am am on (am.oid=opc.opcmethod)
  left join pg_opfamily opf on (opf.oid=opc.opcfamily), 
       obj
 where opc.oid = obj.oid
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_operator_family(oid)
 RETURNS text LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'CREATE OPERATOR FAMILY %s;\n',
        obj.sql_identifier,
        amname
       )
  from pg_opfamily as opf join pg_am am on (am.oid=opf.opfmethod), 
       obj
 where opf.oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_amproc(oid)
 RETURNS text LANGUAGE sql AS $function$
with 
a as (
 select *
   from pg_amproc as amp
   join pg_opfamily opf on (opf.oid=amp.amprocfamily) 
   join pg_am am on (am.oid=opf.opfmethod)
  where amp.oid = $1),
f as (select * from @schemaname@.ddlx_identify((select amprocfamily from a)) ),
obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'ALTER OPERATOR FAMILY %s ADD %s %s;\n',
        f.sql_identifier, obj.sql_identifier,
	cast(a.amproc::regprocedure as text)
       )
  from a,f,obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop_amproc(oid)
 RETURNS text LANGUAGE sql AS $function$
with 
a as (
 select *
   from pg_amproc as amp
   join pg_opfamily opf on (opf.oid=amp.amprocfamily) 
   join pg_am am on (am.oid=opf.opfmethod)
  where amp.oid = $1),
f as (select * from @schemaname@.ddlx_identify((select amprocfamily from a)) ),
obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'ALTER OPERATOR FAMILY %s DROP %s;\n',
        f.sql_identifier,
        obj.sql_identifier
       )
  from a,f,obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_amop(oid)
 RETURNS text LANGUAGE sql AS $function$
with 
a as (
 select *
   from pg_amop as amp
   join pg_opfamily opf on opf.oid=amp.amopfamily
   join pg_am am on am.oid=opf.opfmethod
  where amp.oid = $1),
f as (select * from @schemaname@.ddlx_identify((select amopfamily from a)) ),
obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'ALTER OPERATOR FAMILY %s ADD OPERATOR %s %s (%s) %s;\n',
        f.sql_identifier,
	amopstrategy,
	amopopr::regoper::text,
	array_to_string(array[amoplefttype,amoprighttype]::regtype[],','),
	case amoppurpose
	when 'o' then 'FOR ORDER BY '||
	     	      (select quote_ident(opfname)
		         from pg_opfamily f
			 where f.oid = a.amopsortfamily)
	when 's' then 'FOR SEARCH'
	end
       )
  from a,f,obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop_amop(oid)
 RETURNS text LANGUAGE sql AS $function$
with 
a as (
 select *
   from pg_amop as amp
   join pg_opfamily opf on (opf.oid=amp.amopfamily) 
   join pg_am am on (am.oid=opf.opfmethod)
  where amp.oid = $1),
f as (select * from @schemaname@.ddlx_identify((select amopfamily from a)) ),
obj as (select * from @schemaname@.ddlx_identify($1))
select format(E'ALTER OPERATOR FAMILY %s DROP %s;\n',
        f.sql_identifier,
        obj.sql_identifier
       )
  from a,f,obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_schema(regnamespace, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
select format(E'CREATE SCHEMA %s%I;\n',
              case when 'ine' ilike any($2) then 'IF NOT EXISTS ' end,
              n.nspname)
  from pg_namespace n
 where oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_extension(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
select format(E'CREATE EXTENSION %s%I%s VERSION %s;\n',
              case when 'ine' ilike any($2) then 'IF NOT EXISTS ' end,
              e.extname,
              ' SCHEMA '||quote_ident(nullif(e.extnamespace::regnamespace::text,current_schema())),
              quote_nullable(e.extversion))
  from pg_extension e
 where oid = $1
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create_type(regtype, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
   select @schemaname@.ddlx_create_class(c.oid::regclass,$2) -- type
     from pg_type t
     join pg_class c on (c.oid=t.typrelid)
    where t.oid = $1 and t.typtype = 'c' and c.relkind = 'c'
    union
   select @schemaname@.ddlx_create(c.oid::regclass, $2) -- table, etc
     from pg_type t
     join pg_class c on (c.oid=t.typrelid)
    where t.oid = $1 and t.typtype = 'c' and c.relkind <> 'c'
    union
   select case t.typtype
          when 'e' then @schemaname@.ddlx_create_type_enum(t.oid)
          when 'd' then @schemaname@.ddlx_create_type_domain(t.oid)
          when 'b' then @schemaname@.ddlx_create_type_base(t.oid)
          when 'r' then @schemaname@.ddlx_create_type_range(t.oid)
          else format(E'-- UNSUPPORTED TYPE: %s\n', t.typtype)
          end 
     from pg_type t
    where t.oid = $1 and t.typtype <> 'c'
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_definitions(
   in oid, in options text[] default '{}',
   out oid oid, out classid regclass, out sql_kind text, out sql_identifier text,
   out base_ddl text, out comment text, out owner text, out storage text, 
   out defaults text, out settings text, out constraints text, out indexes text,
   out triggers text, out rules text, out rls text, out grants text
)
 RETURNS record LANGUAGE sql AS $function$
with obj as (select * from @schemaname@.ddlx_identify($1))
  select 
    obj.oid, obj.classid, obj.sql_kind, obj.sql_identifier,
    case obj.classid
    when 'pg_class'::regclass          then @schemaname@.ddlx_create_class(oid::regclass,$2)
    when 'pg_type'::regclass           then @schemaname@.ddlx_create_type(oid::regtype,$2)
    when 'pg_proc'::regclass           then @schemaname@.ddlx_create_function(oid::regproc)
    when 'pg_operator'::regclass       then @schemaname@.ddlx_create_operator(oid::regoper)
    when 'pg_opfamily'::regclass       then @schemaname@.ddlx_create_operator_family(oid)
    when 'pg_rewrite'::regclass        then @schemaname@.ddlx_create_rule(oid)
    when 'pg_ts_config'::regclass      then @schemaname@.ddlx_create_text_search_config(oid::regconfig)
    when 'pg_ts_dict'::regclass        then @schemaname@.ddlx_create_text_search_dict(oid::regdictionary)
    when 'pg_ts_parser'::regclass      then @schemaname@.ddlx_create_text_search_parser(oid)
    when 'pg_ts_template'::regclass    then @schemaname@.ddlx_create_text_search_template(oid)
    when 'pg_database'::regclass       then @schemaname@.ddlx_create_database(oid)
    when 'pg_constraint'::regclass     then @schemaname@.ddlx_create_constraint(oid)
    when 'pg_trigger'::regclass        then @schemaname@.ddlx_create_trigger(oid)
    when 'pg_attrdef'::regclass        then @schemaname@.ddlx_create_default(oid)
    when 'pg_foreign_data_wrapper'::regclass then @schemaname@.ddlx_create_foreign_data_wrapper(oid)
    when 'pg_foreign_server'::regclass then @schemaname@.ddlx_create_server(oid,$2)
    when 'pg_user_mapping'::regclass   then @schemaname@.ddlx_create_user_mapping(oid,$2)
    when 'pg_cast'::regclass           then @schemaname@.ddlx_create_cast(oid)
    when 'pg_collation'::regclass      then @schemaname@.ddlx_create_collation(oid,$2)
    when 'pg_conversion'::regclass     then @schemaname@.ddlx_create_conversion(oid)
    when 'pg_language'::regclass       then @schemaname@.ddlx_create_language(oid)
    when 'pg_opclass'::regclass        then @schemaname@.ddlx_create_operator_class(oid)
    when 'pg_extension'::regclass      then @schemaname@.ddlx_create_extension(oid,$2)
    when 'pg_roles'::regclass          then @schemaname@.ddlx_create_role(oid::regrole)
    when 'pg_namespace'::regclass      then @schemaname@.ddlx_create_schema(oid::regnamespace,$2)
    when 'pg_tablespace'::regclass     then @schemaname@.ddlx_create_tablespace(oid)
    when 'pg_event_trigger'::regclass  then @schemaname@.ddlx_create_event_trigger(oid)
    when 'pg_amproc'::regclass         then @schemaname@.ddlx_create_amproc(oid)
    when 'pg_amop'::regclass           then @schemaname@.ddlx_create_amop(oid)
    when 'pg_policy'::regclass         then @schemaname@.ddlx_create_policy(oid)
    when 'pg_transform'::regclass      then @schemaname@.ddlx_create_transform(oid)
    when 'pg_am'::regclass             then @schemaname@.ddlx_create_access_method(oid)
    when 'pg_statistic_ext'::regclass  then pg_get_statisticsobjdef(oid)||E';\n' 
    when 'pg_publication'::regclass    then @schemaname@.ddlx_create_publication(oid)
    when 'pg_subscription'::regclass   then @schemaname@.ddlx_create_subscription(oid)
    else
      case
        when obj.sql_kind is not null
        then format(E'-- CREATE UNSUPPORTED OBJECT: %s %s\n',text($1),sql_kind)
        else format(E'-- CREATE UNIDENTIFIED OBJECT: %s\n',text($1))      
      end
    end as base_ddl,
    @schemaname@.ddlx_comment(oid) as comment,
    @schemaname@.ddlx_alter_owner(oid) as owner,
    @schemaname@.ddlx_alter_table_storage(oid) as storage,
    @schemaname@.ddlx_alter_table_defaults(oid) as defaults,
    case obj.sql_kind
      when 'ROLE' THEN @schemaname@.ddlx_alter_role(oid)
      when 'DATABASE' THEN  @schemaname@.ddlx_alter_database(oid)
      when 'SEQUENCE' THEN @schemaname@.ddlx_alter_sequence(oid)
      else @schemaname@.ddlx_alter_table_settings(oid)
    end as settings,
--    @schemaname@.ddlx_alter_table_settings(oid) as settings,
    @schemaname@.ddlx_create_constraints(oid) as constraints,
    @schemaname@.ddlx_create_indexes(oid, options) as indexes,
    @schemaname@.ddlx_create_triggers(oid) as triggers,
    @schemaname@.ddlx_create_rules(oid) as rules,
     @schemaname@.ddlx_alter_table_rls(oid) as rls,
     @schemaname@.ddlx_grants(oid) as grants
    from obj
$function$  strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_alter(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
with 
obj as (select * from @schemaname@.ddlx_identify($1)),
parts as (select * from @schemaname@.ddlx_definitions($1,$2))
  select array_to_string( array[
           storage,
           case when obj.sql_kind='TABLE' then parts.owner end || e'\n',
           defaults,settings,constraints,indexes,triggers,rules,rls
         ],'')
    from obj,parts
$function$  strict;

COMMENT ON FUNCTION @schemaname@.ddlx_alter(oid, text[]) 
     IS 'Get SQL ALTER statement for any object by object id (post-data)';
     
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_createonly(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
with 
obj as (select * from @schemaname@.ddlx_identify($1)),
parts as (select * from @schemaname@.ddlx_definitions($1,$2))
select array_to_string(array[
        base_ddl,           
        case when obj.sql_kind is distinct from 'DEFAULT' then parts.comment end || e'\n',
        case when 'nodcl' ilike any($2) or 'noowner' ilike any($2) then null
        else case 
          when 'owner' ilike any($2) or obj.owner is distinct from current_role
          then parts.owner end
        end,
        storage,
        defaults,
        settings
      ],'')
  from obj,parts
$function$ strict;

COMMENT ON FUNCTION @schemaname@.ddlx_createonly(oid, text[]) 
     IS 'Get SQL CREATE statement for any object by object id (pre-data)';

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_create(oid, text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
with 
obj as (select * from @schemaname@.ddlx_identify($1)),
parts as (select * from @schemaname@.ddlx_definitions($1,$2))
select array_to_string(array[
        base_ddl,           
        case when obj.sql_kind is distinct from 'DEFAULT' then parts.comment end || e'\n',
        case when 'noalter' ilike any($2) then null
        else array_to_string(array[
          case when 'nodcl' ilike any($2) or 'noowner' ilike any($2) then null
          else case 
            when 'owner' ilike any($2) or obj.owner is distinct from current_role
            then parts.owner end
          end,
          storage,
          array_to_string(array[
            defaults,settings,constraints,indexes,triggers,rules,rls
          ],''),
          case when 'nodcl' ilike any($2) or 'nogrants' ilike any($2) then null
          else grants end
        ],'') end
       ],'')
  from obj,parts
$function$ strict;

COMMENT ON FUNCTION @schemaname@.ddlx_create(oid, text[]) 
     IS 'Get SQL CREATE statement for any object by object id. Includes constraints, triggers, indexes...';
     
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_drop(oid,ddlx_options text[] default '{}') 
 RETURNS text LANGUAGE sql AS $function$
 with obj as (select * from @schemaname@.ddlx_identify($1))
 select 
   case obj.classid
   when 'pg_constraint'::regclass then @schemaname@.ddlx_drop_constraint(oid)
   when 'pg_trigger'::regclass    then @schemaname@.ddlx_drop_trigger(oid)
   when 'pg_attrdef'::regclass    then @schemaname@.ddlx_drop_default(oid)
   when 'pg_amproc'::regclass     then @schemaname@.ddlx_drop_amproc(oid)
   when 'pg_amop'::regclass       then @schemaname@.ddlx_drop_amop(oid)
   else
     case
       when obj.sql_kind = 'SEQUENCE'
       then format(E'DROP %s IF EXISTS %s;\n',obj.sql_kind, obj.sql_identifier)
       when obj.sql_kind is not null
       then format(E'DROP %s %s%s;%s\n',
                   obj.sql_kind, 
                   case when 'ie' ilike any($2) then 'IF EXISTS ' end,
                   obj.sql_identifier,
		               case when obj.sql_kind = 'TABLE' then ' --==>> !!! ATTENTION !!! <<==--' end
                   )
       else format(E'-- DROP UNIDENTIFIED OBJECT: %s\n',text($1))
      end
    end 
    as ddl
   from obj
$function$  strict;

COMMENT ON FUNCTION @schemaname@.ddlx_drop(oid,text[]) 
     IS 'Get SQL DROP statement for any object by object id';
     
---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_script_parts(
 IN oid, ddlx_options text[] default '{}',
 OUT ddl_create text, OUT ddl_drop text,
 OUT ddl_create_deps text, OUT ddl_drop_deps text)
 RETURNS record LANGUAGE sql AS $function$
with 
ddl as (
select row_number() over() as n,
       @schemaname@.ddlx_drop(gd.objid,$2),
       @schemaname@.ddlx_create(gd.objid,$2),
       gd.objid
  from ddlx_get_dependants($1) gd
  left join pg_depend de
       on de.objid=gd.objid and de.refclassid='pg_extension'::regclass
 where case when 'ext' ilike any($2)
            then gd.classid is distinct from 'pg_extension'::regclass
	    else de.refclassid is null end
       and gd.classid not in ('pg_amproc'::regclass,'pg_amop'::regclass)
)
select @schemaname@.ddlx_create($1,$2) as ddl_create,
       @schemaname@.ddlx_drop($1,$2) as ddl_drop,
       string_agg(ddlx_create,E'\n' order by n) as ddl_create_deps,
       string_agg(ddlx_drop,'' order by n desc) as ddl_drop_deps
  from ddl 
$function$ strict;

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_script(oid, ddlx_options text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
select array_to_string(array[
       E'BEGIN;\n',
       case when 'nodrop' not ilike all($2) then
       format(
         case
           when 'drop' ilike any($2)
           then E'%s%s' else E'/*\n%s%s*/\n'
         end,
         ddl_drop_deps||E'\n',
         ddl_drop
       ) end,
       ddl_create,
       E'-- DEPENDANTS\n\n'||ddl_create_deps,       
       E'END;\n'],E'\n')
  from @schemaname@.ddlx_script_parts($1,$2)
$function$ strict;

COMMENT ON FUNCTION @schemaname@.ddlx_script(oid, text[]) 
     IS 'Get SQL DDL script for any object and dependants by object id';

---------------------------------------------------

CREATE OR REPLACE FUNCTION @schemaname@.ddlx_script(sql_identifier text, ddlx_options text[] default '{}')
 RETURNS text LANGUAGE sql AS $function$
  select case
    when strpos($1,'(')>0 
    then @schemaname@.ddlx_script(cast($1 as regprocedure)::oid, $2)
    else @schemaname@.ddlx_script((
         select coalesce(c.oid,t.oid)
           from pg_type t 
           left join pg_class c on (c.oid=t.typrelid and t.typtype = 'c' and c.relkind <> 'c') 
          where t.oid = cast($1 as regtype)::oid
         ),$2)
     end
$function$  strict;

COMMENT ON FUNCTION @schemaname@.ddlx_script(text, text[]) 
     IS 'Get SQL DDL script for any object and dependants by object name';

