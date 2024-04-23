defmodule Electric.Replication.Eval.Env.KnownFunctions do
  use Electric.Replication.Eval.KnownDefinition

  alias PgInterop.Interval
  alias Electric.Replication.PostgresInterop.Casting
  alias Electric.Replication.Eval.Env.BasicTypes

  ## "input" functions

  defpostgres "int2(text) -> int2", delegate: &Casting.parse_int2/1
  defpostgres "int4(text) -> int4", delegate: &Casting.parse_int4/1
  defpostgres "int8(text) -> int8", delegate: &Casting.parse_int8/1
  defpostgres "float4(text) -> float4", delegate: &Casting.parse_float8/1
  defpostgres "float8(text) -> float8", delegate: &Casting.parse_float8/1
  defpostgres "numeric(text) -> numeric", delegate: &Casting.parse_float8/1
  defpostgres "bool(text) -> bool", delegate: &Casting.parse_bool/1
  defpostgres "uuid(text) -> uuid", delegate: &Casting.parse_uuid/1
  defpostgres "date(text) -> date", delegate: &Casting.parse_date/1
  defpostgres "time(text) -> time", delegate: &Casting.parse_time/1
  defpostgres "timestamp(text) -> timestamp", delegate: &Casting.parse_timestamp/1
  defpostgres "timestamptz(text) -> timestamp", delegate: &Casting.parse_timestamptz/1
  defpostgres "interval(text) -> interval", delegate: &Interval.parse!/1

  ## "output" functions

  defpostgres "int2out(int2) -> text", delegate: &Integer.to_string/1
  defpostgres "int4out(int4) -> text", delegate: &Integer.to_string/1
  defpostgres "int8out(int8) -> text", delegate: &Integer.to_string/1
  defpostgres "float4out(float4) -> text", delegate: &Float.to_string/1
  defpostgres "float8out(float8) -> text", delegate: &Float.to_string/1
  defpostgres "numericout(numeric) -> text", delegate: &Float.to_string/1
  defpostgres "dateout(date) -> text", delegate: &Date.to_iso8601/1
  defpostgres "timeout(time) -> text", delegate: &Time.to_iso8601/1
  defpostgres "timestampout(timestamp) -> text", delegate: &NaiveDateTime.to_iso8601/1
  defpostgres "intervalout(interval) -> text", delegate: &PgInterop.Interval.format/1

  defpostgres "boolout(bool) -> text" do
    def bool_out(true), do: "t"
    def bool_out(false), do: "f"
  end

  defpostgres "uuidout(uuid) -> text", delegate: &BasicTypes.noop/1

  ## Comparison functions

  defcompare "*numeric_type*", using: Kernel
  defcompare "text", using: Kernel
  defcompare "uuid", using: Kernel
  defcompare "date", using: &Date.compare/2
  defcompare "time", using: &Time.compare/2
  defcompare "timestamp", using: &NaiveDateTime.compare/2
  defcompare "timestamptz", using: &DateTime.compare/2

  defpostgres "bool = bool -> bool", delegate: &Kernel.==/2
  defpostgres "bool <> bool -> bool", delegate: &Kernel.!=/2
  defpostgres "interval = interval -> bool", delegate: &Kernel.==/2
  defpostgres "interval <> interval -> bool", delegate: &Kernel.!=/2

  ## Numeric functions

  defpostgres "+ *numeric_type* -> *numeric_type*", delegate: &Kernel.+/1
  defpostgres "- *numeric_type* -> *numeric_type*", delegate: &Kernel.-/1
  defpostgres "*numeric_type* + *numeric_type* -> *numeric_type*", delegate: &Kernel.+/2
  defpostgres "*numeric_type* - *numeric_type* -> *numeric_type*", delegate: &Kernel.-/2
  defpostgres "*integral_type* / *integral_type* -> bool", delegate: &Kernel.div/2
  defpostgres "float8 / float8 -> float8", delegate: &Kernel.//2
  defpostgres "numeric ^ numeric -> numeric", delegate: &Float.pow/2
  defpostgres "float8 ^ float8 -> float8", delegate: &Float.pow/2
  defpostgres "|/ float8 -> float8", delegate: &:math.sqrt/1
  defpostgres "@ *numeric_type* -> *numeric_type*", delegate: &:erlang.abs/1
  defpostgres "*integral_type* & *integral_type* -> *integral_type*", delegate: &Bitwise.band/2
  defpostgres "*integral_type* | *integral_type* -> *integral_type*", delegate: &Bitwise.bor/2
  defpostgres "*integral_type* # *integral_type* -> *integral_type*", delegate: &Bitwise.bxor/2

  ## String functions
  defpostgres "text || text -> text" do
    # Can't do `delegate: &Kernel.<>/2`, because it's a macro that gets converted to local function call
    def text_concat(t1, t2) when is_binary(t1) and is_binary(t2) do
      t1 <> t2
    end
  end

  defpostgres "lower(text) -> text", delegate: &String.downcase/1
  defpostgres "upper(text) -> text", delegate: &String.upcase/1
  defpostgres "text ~~ text -> bool", delegate: &Casting.like?/2
  defpostgres "text ~~* text -> bool", delegate: &Casting.ilike?/2

  defpostgres "text !~~ text -> bool" do
    def not_like?(text1, text2), do: not Casting.like?(text1, text2)
  end

  defpostgres "text !~~* text -> bool" do
    def not_ilike?(text1, text2), do: not Casting.ilike?(text1, text2)
  end

  ## Date functions
  defpostgres "date + int8 -> date", commutative?: true, delegate: &Date.add/2
  defpostgres "date - date -> int8", delegate: &Date.diff/2

  defpostgres "date - int8 -> date" do
    def date_subtract(date, int), do: Date.add(date, -int)
  end

  defpostgres "date + time -> timestamp", commutative?: true, delegate: &NaiveDateTime.new!/2
  defpostgres "interval + interval -> interval", delegate: &Interval.add/2

  defpostgres "date + interval -> timestamp",
    commutative?: true,
    delegate: &Interval.add_to_date/2

  defpostgres "timestamp + interval -> timestamp",
    commutative?: true,
    delegate: &Interval.add_to_date/2

  defpostgres "timestamptz + interval -> timestamptz",
    commutative?: true,
    delegate: &Interval.add_to_date/2

  defpostgres "time + interval -> time", commutative?: true, delegate: &Interval.add_to_time/2
  defpostgres "date - interval -> timestamp", delegate: &Interval.subtract_from_date/2
  defpostgres "timestamp - interval -> timestamp", delegate: &Interval.subtract_from_date/2
  defpostgres "timestamptz - interval -> timestamptz", delegate: &Interval.subtract_from_date/2
  defpostgres "interval - interval -> interval", delegate: &Interval.subtract/2
  defpostgres "timestamp - timestamp -> interval", delegate: &Interval.datetime_diff/2
  defpostgres "timestamptz - timestamptz -> interval", delegate: &Interval.datetime_diff/2
  defpostgres "interval * float8 -> interval", commutative?: true, delegate: &Interval.scale/2

  defpostgres "justify_days(interval) -> interval", delegate: &Interval.justify_days/1
  defpostgres "justify_hours(interval) -> interval", delegate: &Interval.justify_hours/1
  defpostgres "justify_interval(interval) -> interval", delegate: &Interval.justify_interval/1

  defpostgres "timezone(text, timestamp) -> timestamptz" do
    def timestamptz_from_naive(tz, datetime), do: DateTime.from_naive!(datetime, tz)
  end

  defpostgres "timezone(text, timestamptz) -> timestamp" do
    def naive_from_timestamptz(tz, datetime),
      do: datetime |> DateTime.shift_zone!(tz) |> DateTime.to_naive()
  end
end
