defmodule Electric.Postgres.SQLGenerator.Column do
  use Electric.Postgres.SQLGenerator
  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  @classes [:int, :str, :bit, :byte, :float, :date, :time, :timestamp, :timetz, :timestamptz]

  @char_types ["char", "character", "bpchar"]
  @varchar_types ["varchar", "character varying"]

  @base_types %{
    serial: ~w(smallserial serial2 serial serial4 bigserial serial8),
    int: ~w(smallint int2 integer int int4 bigint int8),
    str: @char_types ++ @varchar_types ++ ["text"],
    bit: ~w(bit varbit),
    byte: ~w(bytea),
    float: ["real", "float4", "double precision", "float8"],
    numeric: ["numeric", "decimal"],
    date: ["date"],
    timetz: ["timetz", "time with time zone"],
    time: ["time", "time without time zone"],
    timestamptz: ["timestamp", "timestamptz", "timestamp with time zone"],
    timestamp: ["timestamp without time zone"]
  }

  @types @base_types |> Map.merge(%{char: @char_types, varchar: @varchar_types})

  @reverse_types @base_types
                 |> Enum.flat_map(fn {class, types} -> Enum.map(types, &{&1, class}) end)
                 |> Map.new()

  def datatype(opts \\ []) do
    case Keyword.get(opts, :types, nil) do
      types when is_list(types) ->
        # types must be in the format [{class, type}] where class is one @classes
        member_of(types)

      nil ->
        exclude = Keyword.get(opts, :exclude_types, [])

        types =
          if Keyword.get(opts, :serial, true) do
            [:serial | @classes]
          else
            @classes
          end

        types = Enum.reject(types, &(&1 in exclude))

        bind(member_of(types), fn class ->
          tuple({constant(class), col_type(class)})
        end)
    end
  end

  # todo: update this to generate array types
  def col_type(:serial) do
    member_of(@types[:serial])
  end

  def col_type(:int) do
    member_of(@types[:int])
  end

  def col_type(:str) do
    one_of([
      char(),
      varchar(),
      member_of(@types[:str])
    ])
  end

  def col_type(:bit) do
    one_of([
      member_of(@types[:bit]),
      bind(member_of(@types[:bit]), fn type ->
        bind(integer(1..255), fn l ->
          constant("#{type}(#{l})")
        end)
      end)
    ])
  end

  def col_type(:byte) do
    member_of(@types[:byte])
  end

  def col_type(:float) do
    one_of([
      numeric(),
      member_of(@types[:float])
    ])
  end

  def col_type(:date) do
    member_of(@types[:date])
  end

  def col_type(:timetz) do
    stmt([
      "time",
      one_of([
        nil,
        bind(integer(0..6), fn p -> constant("(#{p})") end)
      ]),
      "with time zone"
    ])
  end

  def col_type(:time) do
    stmt([
      "time",
      one_of([
        nil,
        bind(integer(0..6), fn p -> constant("(#{p})") end)
      ]),
      optional(["without time zone"])
    ])
  end

  def col_type(:timestamptz) do
    one_of([
      constant("timestamptz"),
      stmt([
        "timestamp",
        one_of([
          nil,
          bind(integer(0..6), fn p -> constant("(#{p})") end)
        ]),
        "with time zone"
      ])
    ])
  end

  def col_type(:timestamp) do
    stmt([
      "timestamp",
      one_of([
        nil,
        bind(integer(0..6), fn p -> constant("(#{p})") end)
      ]),
      member_of([nil, "without time zone"])
    ])
  end

  def char do
    bind(member_of(@types[:char]), fn type ->
      bind(integer(1..255), fn l ->
        member_of(["#{type} (#{l})", "#{type} (#{l})"])
      end)
    end)
  end

  def varchar do
    bind(member_of(@types[:varchar]), fn type ->
      bind(integer(1..255), fn l ->
        member_of(["#{type} (#{l})", "#{type} (#{l})"])
      end)
    end)
  end

  def numeric do
    bind(member_of(@types[:numeric]), fn t ->
      bind(list_of(integer(1..255), min_length: 0, max_length: 2), fn
        [] -> constant("#{t}")
        [p] -> constant("#{t}(#{p})")
        [p, s] -> constant("#{t}(#{p + s}, #{s})")
      end)
    end)
  end

  def column(name, {class, type}, flags, opts) do
    column(name, {class, type}, flags, %{pk: :column, fk: :column}, opts)
  end

  def column(name, {class, type}, flags, table_opts, opts) do
    # need to re-factor this to produce a list that I can intersperse with spaces
    stmt([
      name,
      type,
      constraint(name, class, type, flags, table_opts, opts),
      default(class, type)
    ])
  end

  def value(:serial, _type) do
    # the range of an int2
    int(0..32_767)
  end

  def value(:int, _type) do
    # the range of an int2
    int(0..32_767)
  end

  def value(:str, _type) do
    fixed_list([
      constant("'"),
      map(string(:alphanumeric, max_length: 10), &esc/1),
      constant("'")
    ])
  end

  def value(:byte, type) do
    fixed_list([
      constant("'\\x"),
      map(binary(min_length: 1, max_length: 10), &Base.encode16(&1, case: :upper)),
      constant("'::"),
      constant(type)
    ])
  end

  def value(:bit, _) do
    fixed_list([
      constant("'"),
      map(integer(0..255), &Integer.to_string(&1, 2)),
      constant("'::bit")
    ])
  end

  def value(:float, type) do
    stmt(
      [
        "'",
        map(float(max: 1.0e10, min: 1.0e-10), &to_string/1),
        "'::",
        constant(type)
      ],
      ""
    )
  end

  @year 3600 * 24 * 365
  @hundred_years 100 * @year

  def value(:date, _) do
    bind(datetime(), fn t ->
      value = DateTime.to_date(t)

      constant("'#{value}'::date")
    end)
  end

  def value(:time, _) do
    bind(datetime(), fn t ->
      value = DateTime.to_time(t)

      constant("'#{value}'")
    end)
  end

  def value(:timetz, _) do
    bind(datetime(), fn t ->
      bind(member_of(Tzdata.canonical_zone_list()), fn tz ->
        value =
          t
          |> DateTime.shift_zone!(tz, Tzdata.TimeZoneDatabase)
          |> DateTime.to_time()

        constant("'#{value}'::time with time zone")
      end)
    end)
  end

  def value(:timestamptz, _) do
    bind(datetime(), fn t ->
      bind(member_of(Tzdata.canonical_zone_list()), fn tz ->
        value =
          t
          |> DateTime.shift_zone!(tz, Tzdata.TimeZoneDatabase)
          |> timestamp_format()

        constant("'#{value}'::timestamp with time zone")
      end)
    end)
  end

  def value(:timestamp, _) do
    bind(datetime(), fn t ->
      value = timestamp_format(t)

      constant("'#{value}'::timestamp without time zone")
    end)
  end

  defp datetime do
    integer(0..@hundred_years) |> map(&DateTime.from_unix!/1)
  end

  defp timestamp_format(datetime) do
    case Calendar.strftime(datetime, "%z") do
      utc when utc in ["+00", "+0000"] ->
        Calendar.strftime(datetime, "%c")

      z ->
        Calendar.strftime(datetime, "%c") <> z
    end
  end

  def default(:serial, _type) do
    nil
  end

  def default(class, type) do
    one_of([
      nil,
      fixed_list([
        constant("DEFAULT "),
        default_value(class, type)
      ])
    ])
  end

  def default_value(class, type)
      when class in [:date, :time, :timetz, :timestamp, :timestamptz] do
    one_of([
      time_function(class),
      value(class, type)
    ])
  end

  def default_value(class, type) do
    value(class, type)
  end

  defp time_function(:date) do
    constant("current_date")
  end

  defp time_function(:timestamptz) do
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    one_of([
      stmt(
        [
          member_of(["CURRENT_TIMESTAMP"]),
          member_of([nil, "(3)", "(4)"])
        ],
        ""
      ),
      member_of([
        "now()",
        "transaction_timestamp()",
        "statement_timestamp()",
        "clock_timestamp()"
      ])
    ])
  end

  defp time_function(:timetz) do
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    stmt(
      [
        member_of(["CURRENT_TIME"]),
        member_of([nil, "(3)", "(4)"])
      ],
      ""
    )
  end

  defp time_function(:time) do
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    stmt(
      [
        member_of(["LOCALTIME"]),
        member_of([nil, "(3)", "(4)"])
      ],
      ""
    )
  end

  defp time_function(:timestamp) do
    # https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    stmt(
      [
        member_of(["LOCALTIMESTAMP"]),
        member_of([nil, "(3)", "(4)"])
      ],
      ""
    )
  end

  def constraint(_name, :serial, _type, _table_opts, _opts) do
    member_of([nil, "NOT NULL"])
  end

  def constraint(_name, _class, type, flags, table_opts, opts) do
    pk = flags[:pk] && table_opts[:pk] != :table

    one_of([
      if(pk, do: stmt(["PRIMARY KEY"])),
      stmt([
        # one_of([nil, references(opts), named_constraint()]),
        if(pk, do: stmt(["PRIMARY KEY"])),
        if(table_opts[:fk] == :column, do: one_of([nil, references(type, opts)])),
        # moving all check constraints to the table level because that's how pg_dump does it
        # one_of([constant("NOT NULL"), check(name, class, type)])
        one_of([nil, constant("NOT NULL")])
        # > Currently, only UNIQUE, PRIMARY KEY, EXCLUDE, and REFERENCES (foreign key) constraints
        # > accept this clause. NOT NULL and CHECK constraints are not deferrable
        # member_of([nil, "DEFERRABLE", "NOT DEFERRABLE"]),
        # member_of([nil, "INITIALLY DEFERRED", "INITIALLY IMMEDIATE"])
      ])
    ])
  end

  def named_constraint do
    stmt(["CONSTRAINT", name()])
  end

  def check({name, {class, type}, _flags}, opts \\ []) do
    list_of(
      stmt([
        # FIXME: I'm naming all my checks because figuring out the pg generated name
        # would require effort to traverse the check expression tree and find the column
        # names
        # one_of([nil, named_constraint()]),
        named_constraint(),
        stmt(
          [
            "CHECK (",
            name,
            member_of([" > ", " < ", " <> ", " != ", " = "]),
            value(class, type),
            ")"
          ],
          ""
        )
      ]),
      min_length: Keyword.get(opts, :min_length, 1),
      max_length: Keyword.get(opts, :max_length, 4)
    )
    |> map(&Enum.intersperse(&1, " "))
  end

  def references(column_type, opts) do
    if Keyword.get(opts, :foreign_keys, true) do
      # how to do this? seems important to test handling via ast but makes it difficult to validate using pg
      one_of([nil, table_reference(column_type, opts[:schema], opts)])
    else
      nil
    end
  end

  def table_reference(_type, nil, _opts) do
    bind(name(), fn table_name ->
      bind({name(), datatype()}, fn column ->
        table_reference_to(table_name, column)
      end)
    end)
  end

  def table_reference(column_type, %Proto.Schema{} = schema, opts) do
    # don't allow foreign keys to point to the current table
    exclude_table =
      case Keyword.get(opts, :owning_table, nil) do
        nil ->
          nil

        %{name: name} ->
          name
      end

    reference_columns =
      schema
      |> primary_keys()
      |> Enum.reject(fn {table_name, _column} ->
        exclude_table && Schema.equal?(table_name, exclude_table)
      end)
      |> Enum.filter(fn {_table_name, column} ->
        case Enum.find(@types, fn {_class, types} -> column_type in types end) do
          {_class, types} ->
            column.type.name in types

          _ ->
            false
        end
      end)

    case reference_columns do
      [] ->
        nil

      cols ->
        bind(member_of(cols), fn {table_name, column} ->
          table_reference_to(table_name, Schema.name(column))
        end)
    end
  end

  def table_reference_to(table, {column_name, _type}) do
    table_reference_to(table, column_name)
  end

  def table_reference_to(table, column_name) when is_binary(column_name) do
    stmt([
      "REFERENCES",
      quote_table_name(table),
      stmt(["(", column_name, ")"], ""),
      # in theory you can just reference a table and pg will infer the primary key
      # but we have no guarantees of a primary key (at least atm) so am forcing
      # the naming of a column
      # one_of([
      #   nil,
      #   stmt(["(", column_name, ")"], "")
      # ]),
      one_of([
        nil,
        stmt([
          "ON DELETE",
          member_of(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"])
        ])
      ]),
      one_of([
        nil,
        stmt([
          "ON UPDATE",
          member_of(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"])
        ])
      ])
    ])
  end

  # gives a list of {table_name, column_def} for every column in the schema that has a pk or
  # unique constraint
  defp primary_keys(%Proto.Schema{} = schema) do
    Stream.filter(schema.tables, fn table ->
      Enum.any?(table.constraints, &unique_constraint?/1)
    end)
    |> Enum.flat_map(fn table ->
      table.constraints
      |> Stream.filter(&unique_constraint?/1)
      |> Stream.map(fn %Proto.Constraint{constraint: {_, c}} -> c end)
      |> Stream.map(& &1.keys)
      # only select constraints that include a single column..
      |> Stream.filter(&(length(&1) == 1))
      |> Stream.map(&hd/1)
      |> Stream.map(&Enum.find(table.columns, fn c -> c.name == &1 end))
      |> Enum.map(&{table.name, &1})
    end)
  end

  defp unique_constraint?(c) when is_unique_constraint(c) do
    true
  end

  defp unique_constraint?(_) do
    false
  end

  def class_from_type(%Proto.Column.Type{name: type}) do
    {Map.fetch!(@reverse_types, type), type}
  end
end
