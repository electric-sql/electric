defmodule Electric.SchemaTest do
  use Support.TransactionCase, async: true

  alias Electric.Schema
  alias Electric.Postgres.Inspector.DirectInspector

  @types [
    %{
      postgres_type: "SMALLINT",
      schema: %{type: "int2"}
    },
    %{
      postgres_type: "INT2",
      schema: %{type: "int2"}
    },
    %{
      postgres_type: "INTEGER",
      schema: %{type: "int4"}
    },
    %{
      postgres_type: "INT4",
      schema: %{type: "int4"}
    },
    %{
      postgres_type: "SERIAL",
      schema: %{type: "int4"}
    },
    %{
      postgres_type: "BIGINT",
      schema: %{type: "int8"}
    },
    %{
      postgres_type: "INT8",
      schema: %{type: "int8"}
    },
    %{
      postgres_type: "MONEY",
      schema: %{type: "money"}
    },
    %{
      postgres_type: "VARCHAR",
      schema: %{type: "varchar"}
    },
    %{
      postgres_type: "VARCHAR(123)",
      schema: %{type: "varchar", max_length: 123}
    },
    %{
      postgres_type: "VARCHAR(123)[]",
      schema: %{type: "varchar", max_length: 123, dims: 1}
    },
    %{
      postgres_type: "VARCHAR(123)[][]",
      schema: %{type: "varchar", max_length: 123, dims: 2}
    },
    %{
      postgres_type: "CHARACTER VARYING(123)",
      schema: %{type: "varchar", max_length: 123}
    },
    %{
      postgres_type: "CHAR",
      schema: %{type: "bpchar", length: 1}
    },
    %{
      postgres_type: "CHARACTER",
      schema: %{type: "bpchar", length: 1}
    },
    %{
      postgres_type: "CHARACTER[]",
      schema: %{type: "bpchar", dims: 1, length: 1}
    },
    %{
      postgres_type: "BPCHAR",
      schema: %{type: "bpchar"}
    },
    %{
      postgres_type: "BPCHAR[]",
      schema: %{type: "bpchar", dims: 1}
    },
    %{
      postgres_type: "TEXT",
      schema: %{type: "text"}
    },
    %{
      postgres_type: "BPCHAR(9)",
      schema: %{type: "bpchar", length: 9}
    },
    %{
      postgres_type: "BPCHAR(9)[]",
      schema: %{type: "bpchar", dims: 1, length: 9}
    },
    %{
      postgres_type: "BYTEA",
      schema: %{type: "bytea"}
    },
    %{
      postgres_type: "DATE",
      chema: %{type: "date"}
    },
    %{
      postgres_type: "TIME",
      schema: %{type: "time"}
    },
    %{
      postgres_type: "TIME(3)",
      schema: %{type: "time", precision: 3}
    },
    %{
      postgres_type: "TIME WITH TIME ZONE",
      schema: %{type: "timetz"}
    },
    %{
      postgres_type: "TIME(3) WITH TIME ZONE",
      schema: %{type: "timetz", precision: 3}
    },
    %{
      postgres_type: "TIMESTAMP",
      schema: %{type: "timestamp"}
    },
    %{
      postgres_type: "TIMESTAMP(3)",
      schema: %{type: "timestamp", precision: 3}
    },
    %{
      postgres_type: "TIMESTAMP WITH TIME ZONE",
      schema: %{type: "timestamptz"}
    },
    %{
      postgres_type: "TIMESTAMP(3) WITH TIME ZONE",
      schema: %{type: "timestamptz", precision: 3}
    },
    %{
      postgres_type: "INTERVAL",
      schema: %{type: "interval"}
    },
    %{
      postgres_type: "INTERVAL YEAR",
      schema: %{type: "interval", fields: "YEAR"}
    },
    %{
      postgres_type: "INTERVAL MONTH",
      schema: %{type: "interval", fields: "MONTH"}
    },
    %{
      postgres_type: "INTERVAL DAY",
      schema: %{type: "interval", fields: "DAY"}
    },
    %{
      postgres_type: "INTERVAL HOUR",
      schema: %{type: "interval", fields: "HOUR"}
    },
    %{
      postgres_type: "INTERVAL MINUTE",
      schema: %{type: "interval", fields: "MINUTE"}
    },
    %{
      postgres_type: "INTERVAL SECOND",
      schema: %{type: "interval", fields: "SECOND"}
    },
    %{
      postgres_type: "INTERVAL YEAR TO MONTH",
      schema: %{type: "interval", fields: "YEAR TO MONTH"}
    },
    %{
      postgres_type: "INTERVAL DAY TO HOUR",
      schema: %{type: "interval", fields: "DAY TO HOUR"}
    },
    %{
      postgres_type: "INTERVAL DAY TO MINUTE",
      schema: %{type: "interval", fields: "DAY TO MINUTE"}
    },
    %{
      postgres_type: "INTERVAL DAY TO SECOND",
      schema: %{type: "interval", fields: "DAY TO SECOND"}
    },
    %{
      postgres_type: "INTERVAL HOUR TO MINUTE",
      schema: %{type: "interval", fields: "HOUR TO MINUTE"}
    },
    %{
      postgres_type: "INTERVAL HOUR TO SECOND",
      schema: %{type: "interval", fields: "HOUR TO SECOND"}
    },
    %{
      postgres_type: "INTERVAL MINUTE TO SECOND",
      schema: %{type: "interval", fields: "MINUTE TO SECOND"}
    },
    %{
      postgres_type: "INTERVAL(4)",
      schema: %{type: "interval", precision: 4}
    },
    %{
      postgres_type: "INTERVAL SECOND(4)",
      schema: %{type: "interval", precision: 4, fields: "SECOND"}
    },
    %{
      postgres_type: "INTERVAL SECOND(4)[]",
      schema: %{type: "interval", dims: 1, precision: 4, fields: "SECOND"}
    },
    %{
      postgres_type: "INTERVAL MINUTE TO SECOND[][]",
      schema: %{type: "interval", dims: 2, fields: "MINUTE TO SECOND"}
    },
    %{
      postgres_type: "BOOLEAN",
      schema: %{type: "bool"}
    },
    %{
      postgres_type: "NUMERIC",
      schema: %{type: "numeric"}
    },
    %{
      postgres_type: "REAL",
      schema: %{type: "float4"}
    },
    %{
      postgres_type: "FLOAT4",
      schema: %{type: "float4"}
    },
    %{
      postgres_type: "DOUBLE PRECISION",
      schema: %{type: "float8"}
    },
    %{
      postgres_type: "FLOAT8",
      schema: %{type: "float8"}
    },
    %{
      postgres_type: "BIT",
      schema: %{type: "bit", length: 1}
    },
    %{
      postgres_type: "BIT[]",
      schema: %{type: "bit", dims: 1, length: 1}
    },
    %{
      postgres_type: "BIT(5)",
      schema: %{type: "bit", length: 5}
    },
    %{
      postgres_type: "BIT(5)[]",
      schema: %{type: "bit", dims: 1, length: 5}
    },
    %{
      postgres_type: "BIT VARYING(5)",
      schema: %{type: "varbit", length: 5}
    },
    %{
      postgres_type: "BIT VARYING(5)[]",
      schema: %{type: "varbit", dims: 1, length: 5}
    },
    %{
      postgres_type: "NUMERIC(5,3)",
      schema: %{type: "numeric", precision: 5, scale: 3}
    },
    %{
      postgres_type: "NUMERIC(5,3)[]",
      schema: %{type: "numeric", dims: 1, precision: 5, scale: 3}
    },
    %{
      postgres_type: "NUMERIC(5)",
      schema: %{type: "numeric", precision: 5, scale: 0}
    },
    %{
      postgres_type: "NUMERIC(5)[]",
      schema: %{type: "numeric", dims: 1, precision: 5, scale: 0}
    },
    %{
      postgres_type: "POINT",
      schema: %{type: "point"}
    },
    %{
      postgres_type: "LINE",
      schema: %{type: "line"}
    },
    %{
      postgres_type: "LSEG",
      schema: %{type: "lseg"}
    },
    %{
      postgres_type: "BOX",
      schema: %{type: "box"}
    },
    %{
      postgres_type: "PATH",
      schema: %{type: "path"}
    },
    %{
      postgres_type: "POLYGON",
      schema: %{type: "polygon"}
    },
    %{
      postgres_type: "CIRCLE",
      schema: %{type: "circle"}
    },
    %{
      postgres_type: "CIDR",
      schema: %{type: "cidr"}
    },
    %{
      postgres_type: "INET",
      schema: %{type: "inet"}
    },
    %{
      postgres_type: "MACADDR",
      schema: %{type: "macaddr"}
    },
    %{
      postgres_type: "MACADDR8",
      schema: %{type: "macaddr8"}
    },
    %{
      postgres_type: "TSVECTOR",
      schema: %{type: "tsvector"}
    },
    %{
      postgres_type: "TSQUERY",
      schema: %{type: "tsquery"}
    },
    %{
      postgres_type: "UUID",
      schema: %{type: "uuid"}
    },
    %{
      postgres_type: "XML",
      schema: %{type: "xml"}
    },
    %{
      postgres_type: "JSON",
      schema: %{type: "json"}
    },
    %{
      postgres_type: "JSONB",
      schema: %{type: "jsonb"}
    },
    %{
      postgres_type: "JSONPATH",
      schema: %{type: "jsonpath"}
    },
    %{
      postgres_type: "INT4RANGE",
      schema: %{type: "int4range"}
    },
    %{
      postgres_type: "INT4MULTIRANGE",
      schema: %{type: "int4multirange"}
    },
    %{
      postgres_type: "INT8RANGE",
      schema: %{type: "int8range"}
    },
    %{
      postgres_type: "INT8MULTIRANGE",
      schema: %{type: "int8multirange"}
    },
    %{
      postgres_type: "NUMRANGE",
      schema: %{type: "numrange"}
    },
    %{
      postgres_type: "NUMMULTIRANGE",
      schema: %{type: "nummultirange"}
    },
    %{
      postgres_type: "TSRANGE",
      schema: %{type: "tsrange"}
    },
    %{
      postgres_type: "TSMULTIRANGE",
      schema: %{type: "tsmultirange"}
    },
    %{
      postgres_type: "TSTZRANGE",
      schema: %{type: "tstzrange"}
    },
    %{
      postgres_type: "TSTZMULTIRANGE",
      schema: %{type: "tstzmultirange"}
    },
    %{
      postgres_type: "DATERANGE",
      schema: %{type: "daterange"}
    },
    %{
      postgres_type: "DATEMULTIRANGE",
      schema: %{type: "datemultirange"}
    },
    %{
      postgres_type: "OID",
      schema: %{type: "oid"}
    },
    %{
      postgres_type: "REGCLASS",
      schema: %{type: "regclass"}
    },
    %{
      postgres_type: "REGCOLLATION",
      schema: %{type: "regcollation"}
    },
    %{
      postgres_type: "REGCONFIG",
      schema: %{type: "regconfig"}
    },
    %{
      postgres_type: "REGDICTIONARY",
      schema: %{type: "regdictionary"}
    },
    %{
      postgres_type: "REGNAMESPACE",
      schema: %{type: "regnamespace"}
    },
    %{
      postgres_type: "REGOPER",
      schema: %{type: "regoper"}
    },
    %{
      postgres_type: "REGOPERATOR",
      schema: %{type: "regoperator"}
    },
    %{
      postgres_type: "REGPROC",
      schema: %{type: "regproc"}
    },
    %{
      postgres_type: "REGPROCEDURE",
      schema: %{type: "regprocedure"}
    },
    %{
      postgres_type: "REGROLE",
      schema: %{type: "regrole"}
    },
    %{
      postgres_type: "REGTYPE",
      schema: %{type: "regtype"}
    },
    %{
      postgres_type: "PG_LSN",
      schema: %{type: "pg_lsn"}
    },
    %{
      postgres_type: "MOOD",
      schema: %{type: "mood"}
    },
    %{
      postgres_type: "MOOD[]",
      schema: %{type: "mood", dims: 1}
    },
    %{
      postgres_type: "COMPLEX",
      schema: %{type: "complex"}
    },
    %{
      postgres_type: "COMPLEX[]",
      schema: %{type: "complex", dims: 1}
    },
    %{
      postgres_type: "POSINT",
      schema: %{type: "posint"}
    },
    %{
      postgres_type: "POSINT[]",
      schema: %{type: "posint", dims: 1}
    }
  ]

  describe "from_column_info/1" do
    setup context do
      Postgrex.query!(context.db_conn, "CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');", [])

      Postgrex.query!(
        context.db_conn,
        "CREATE TYPE complex AS (r double precision, i double precision);",
        []
      )

      Postgrex.query!(context.db_conn, "CREATE DOMAIN posint AS integer CHECK (VALUE > 0);", [])
      {:ok, context}
    end

    for %{postgres_type: postgres_type, schema: expected_schema} <- @types do
      test "gets the type for #{postgres_type}", %{db_conn: conn} do
        Postgrex.query!(
          conn,
          """
          CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            value #{unquote(postgres_type)})
          """,
          []
        )

        {:ok, column_info} = DirectInspector.load_column_info({"public", "items"}, conn)
        %{"value" => schema} = Schema.from_column_info(column_info)

        assert schema == unquote(Macro.escape(expected_schema))
      end
    end

    test "returns the correct schema for a table with a composite primary key", %{db_conn: conn} do
      Postgrex.query!(
        conn,
        """
        CREATE TABLE items (
          i INTEGER,
          name VARCHAR,
          value BOOLEAN,
          PRIMARY KEY (i, value)
        )
        """,
        []
      )

      {:ok, column_info} = DirectInspector.load_column_info({"public", "items"}, conn)

      %{"i" => i_schema, "name" => name_schema, "value" => value_schema} =
        Schema.from_column_info(column_info)

      assert i_schema == %{type: "int4", pk_index: 0}
      assert name_schema == %{type: "varchar"}
      assert value_schema == %{type: "bool", pk_index: 1}
    end
  end
end
