defmodule Electric.Replication.Eval.Env.KnownFunctions do
  use Electric.Replication.Eval.KnownDefinition

  alias PgInterop.Interval
  alias Electric.Replication.PostgresInterop.Casting
  alias Electric.Replication.Eval.Env.BasicTypes

  ## "input" functions

  defpostgres("int2(text) -> int2", delegate: &Casting.parse_int2/1)
  defpostgres("int4(text) -> int4", delegate: &Casting.parse_int4/1)
  defpostgres("int8(text) -> int8", delegate: &Casting.parse_int8/1)
  defpostgres("float4(text) -> float4", delegate: &Casting.parse_float8/1)
  defpostgres("float8(text) -> float8", delegate: &Casting.parse_float8/1)
  defpostgres("numeric(text) -> numeric", delegate: &Casting.parse_float8/1)
  defpostgres("bool(text) -> bool", delegate: &Casting.parse_bool/1)
  defpostgres("uuid(text) -> uuid", delegate: &Casting.parse_uuid/1)
  defpostgres("text(text) -> text", delegate: &BasicTypes.noop/1)
  defpostgres("date(text) -> date", delegate: &Casting.parse_date/1)
  defpostgres("time(text) -> time", delegate: &Casting.parse_time/1)
  defpostgres("timestamp(text) -> timestamp", delegate: &Casting.parse_timestamp/1)
  defpostgres("timestamptz(text) -> timestamp", delegate: &Casting.parse_timestamptz/1)
  defpostgres("interval(text) -> interval", delegate: &Interval.parse!/1)

  ## "output" functions

  defpostgres("int2out(int2) -> text", delegate: &Integer.to_string/1)
  defpostgres("int4out(int4) -> text", delegate: &Integer.to_string/1)
  defpostgres("int8out(int8) -> text", delegate: &Integer.to_string/1)
  defpostgres("float4out(float4) -> text", delegate: &Float.to_string/1)
  defpostgres("float8out(float8) -> text", delegate: &Float.to_string/1)
  defpostgres("numericout(numeric) -> text", delegate: &Float.to_string/1)
  defpostgres("dateout(date) -> text", delegate: &Date.to_iso8601/1)
  defpostgres("timeout(time) -> text", delegate: &Time.to_iso8601/1)
  defpostgres("timestampout(timestamp) -> text", delegate: &NaiveDateTime.to_iso8601/1)
  defpostgres("intervalout(interval) -> text", delegate: &PgInterop.Interval.format/1)

  defpostgres "boolout(bool) -> text" do
    def bool_out(true), do: "t"
    def bool_out(false), do: "f"
  end

  defpostgres("uuidout(uuid) -> text", delegate: &BasicTypes.noop/1)

  ## Comparison functions

  defcompare("*numeric_type*", using: Kernel)
  defcompare("text", using: Kernel)
  defcompare("uuid", using: Kernel)
  defcompare("date", using: &Date.compare/2)
  defcompare("time", using: &Time.compare/2)
  defcompare("timestamp", using: &NaiveDateTime.compare/2)
  defcompare("timestamptz", using: &DateTime.compare/2)

  defpostgres("bool = bool -> bool", delegate: &Kernel.==/2)
  defpostgres("bool <> bool -> bool", delegate: &Kernel.!=/2)
  defpostgres("interval = interval -> bool", delegate: &Kernel.==/2)
  defpostgres("interval <> interval -> bool", delegate: &Kernel.!=/2)

  ## Numeric functions

  defpostgres("+ *numeric_type* -> *numeric_type*", delegate: &Kernel.+/1)
  defpostgres("- *numeric_type* -> *numeric_type*", delegate: &Kernel.-/1)
  defpostgres("*numeric_type* + *numeric_type* -> *numeric_type*", delegate: &Kernel.+/2)
  defpostgres("*numeric_type* - *numeric_type* -> *numeric_type*", delegate: &Kernel.-/2)
  defpostgres("*numeric_type* * *numeric_type* -> *numeric_type*", delegate: &Kernel.*/2)
  defpostgres("*integral_type* / *integral_type* -> *integral_type*", delegate: &Kernel.div/2)
  defpostgres("float8 / float8 -> float8", delegate: &Kernel.//2)
  defpostgres("numeric ^ numeric -> numeric", delegate: &Kernel.**/2)
  defpostgres("float8 ^ float8 -> float8", delegate: &Kernel.**/2)
  defpostgres("|/ float8 -> float8", delegate: &:math.sqrt/1)
  defpostgres("@ *numeric_type* -> *numeric_type*", delegate: &:erlang.abs/1)
  defpostgres("*integral_type* & *integral_type* -> *integral_type*", delegate: &Bitwise.band/2)
  defpostgres("*integral_type* | *integral_type* -> *integral_type*", delegate: &Bitwise.bor/2)
  defpostgres("*integral_type* # *integral_type* -> *integral_type*", delegate: &Bitwise.bxor/2)
  defpostgres("~ *integral_type* -> *integral_type*", delegate: &Bitwise.bnot/1)

  ## String functions
  defpostgres "text || text -> text" do
    # Can't do `delegate: &Kernel.<>/2`, because it's a macro that gets converted to local function call
    def text_concat(t1, t2) when is_binary(t1) and is_binary(t2) do
      t1 <> t2
    end
  end

  defpostgres("lower(text) -> text", delegate: &String.downcase/1)
  defpostgres("upper(text) -> text", delegate: &String.upcase/1)
  defpostgres("text ~~ text -> bool", delegate: &Casting.like?/2)
  defpostgres("text ~~* text -> bool", delegate: &Casting.ilike?/2)

  defpostgres "text !~~ text -> bool" do
    def not_like?(text1, text2), do: not Casting.like?(text1, text2)
  end

  defpostgres "text !~~* text -> bool" do
    def not_ilike?(text1, text2), do: not Casting.ilike?(text1, text2)
  end

  defpostgres("like(text, text) -> bool", delegate: &Casting.like?/2)
  defpostgres("ilike(text, text) -> bool", delegate: &Casting.ilike?/2)

  ## Date functions
  defpostgres("date + int8 -> date", commutative?: true, delegate: &Date.add/2)
  defpostgres("date - date -> int8", delegate: &Date.diff/2)

  defpostgres "date - int8 -> date" do
    def date_subtract(date, int), do: Date.add(date, -int)
  end

  defpostgres("date + time -> timestamp", commutative?: true, delegate: &NaiveDateTime.new!/2)
  defpostgres("interval + interval -> interval", delegate: &Interval.add/2)

  defpostgres("date + interval -> timestamp",
    commutative?: true,
    delegate: &Interval.add_to_date/2
  )

  defpostgres("timestamp + interval -> timestamp",
    commutative?: true,
    delegate: &Interval.add_to_date/2
  )

  defpostgres("timestamptz + interval -> timestamptz",
    commutative?: true,
    delegate: &Interval.add_to_date/2
  )

  defpostgres("time + interval -> time", commutative?: true, delegate: &Interval.add_to_time/2)
  defpostgres("date - interval -> timestamp", delegate: &Interval.subtract_from_date/2)
  defpostgres("timestamp - interval -> timestamp", delegate: &Interval.subtract_from_date/2)
  defpostgres("timestamptz - interval -> timestamptz", delegate: &Interval.subtract_from_date/2)
  defpostgres("interval - interval -> interval", delegate: &Interval.subtract/2)
  defpostgres("timestamp - timestamp -> interval", delegate: &Interval.datetime_diff/2)
  defpostgres("timestamptz - timestamptz -> interval", delegate: &Interval.datetime_diff/2)
  defpostgres("interval * float8 -> interval", commutative?: true, delegate: &Interval.scale/2)

  defpostgres("justify_days(interval) -> interval", delegate: &Interval.justify_days/1)
  defpostgres("justify_hours(interval) -> interval", delegate: &Interval.justify_hours/1)
  defpostgres("justify_interval(interval) -> interval", delegate: &Interval.justify_interval/1)

  defpostgres "timezone(text, timestamp) -> timestamptz" do
    def timestamptz_from_naive(tz, datetime), do: DateTime.from_naive!(datetime, tz)
  end

  defpostgres "timezone(text, timestamptz) -> timestamp" do
    def naive_from_timestamptz(tz, datetime),
      do: datetime |> DateTime.shift_zone!(tz) |> DateTime.to_naive()
  end

  ## Enum operators
  defpostgres("anyenum = anyenum -> bool", delegate: &Kernel.==/2)
  defpostgres("anyenum <> anyenum -> bool", delegate: &Kernel.!=/2)

  ## JSONB functions

  # Parse text to jsonb
  defpostgres "jsonb(text) -> jsonb" do
    def parse_jsonb(text) when is_binary(text), do: Jason.decode!(text)
  end

  # Output jsonb as text
  defpostgres "jsonbout(jsonb) -> text" do
    def jsonb_out(nil), do: nil
    def jsonb_out(value), do: Jason.encode!(value)
  end

  # Get object field or array element as jsonb
  defpostgres "jsonb -> text -> jsonb" do
    def jsonb_get_by_key(json, key) when is_map(json) and is_binary(key) do
      Map.get(json, key)
    end

    def jsonb_get_by_key(_, _), do: nil
  end

  defpostgres "jsonb -> int4 -> jsonb" do
    def jsonb_get_by_index(json, index) when is_list(json) and is_integer(index) do
      # PostgreSQL uses 0-based indexing for JSON arrays
      # Negative indices are not supported (unlike Python), they return null
      if index >= 0 do
        Enum.at(json, index)
      else
        nil
      end
    end

    def jsonb_get_by_index(_, _), do: nil
  end

  # Get object field or array element as text
  defpostgres "jsonb ->> text -> text" do
    def jsonb_get_text_by_key(json, key) when is_map(json) and is_binary(key) do
      case Map.get(json, key) do
        nil -> nil
        value -> jsonb_value_to_text(value)
      end
    end

    def jsonb_get_text_by_key(_, _), do: nil

    defp jsonb_value_to_text(value) when is_binary(value), do: value
    defp jsonb_value_to_text(value) when is_integer(value), do: Integer.to_string(value)
    defp jsonb_value_to_text(value) when is_float(value), do: Float.to_string(value)
    defp jsonb_value_to_text(true), do: "true"
    defp jsonb_value_to_text(false), do: "false"
    defp jsonb_value_to_text(nil), do: nil
    # For nested objects/arrays, return JSON string
    defp jsonb_value_to_text(value), do: Jason.encode!(value)
  end

  defpostgres "jsonb ->> int4 -> text" do
    def jsonb_get_text_by_index(json, index) when is_list(json) and is_integer(index) do
      if index >= 0 do
        json |> Enum.at(index) |> jsonb_value_to_text()
      else
        nil
      end
    end

    def jsonb_get_text_by_index(_, _), do: nil
  end

  # JSONB equality
  defpostgres("jsonb = jsonb -> bool", delegate: &Kernel.==/2)
  defpostgres("jsonb <> jsonb -> bool", delegate: &Kernel.!=/2)

  # JSONB containment operators
  # @> checks if left contains right, <@ checks if left is contained by right
  defpostgres "jsonb @> jsonb -> bool" do
    def jsonb_contains?(left, right), do: do_jsonb_contains?(left, right)

    # Objects: all key-value pairs in right must exist in left
    defp do_jsonb_contains?(left, right) when is_map(left) and is_map(right) do
      Enum.all?(right, fn {key, right_value} ->
        case Map.fetch(left, key) do
          {:ok, left_value} -> do_jsonb_contains?(left_value, right_value)
          :error -> false
        end
      end)
    end

    # Arrays: all elements in right must exist somewhere in left
    defp do_jsonb_contains?(left, right) when is_list(left) and is_list(right) do
      Enum.all?(right, fn right_elem ->
        Enum.any?(left, fn left_elem -> do_jsonb_contains?(left_elem, right_elem) end)
      end)
    end

    # Scalars: must be equal
    defp do_jsonb_contains?(left, right), do: left == right
  end

  defpostgres "jsonb <@ jsonb -> bool" do
    def jsonb_contained_by?(left, right), do: do_jsonb_contains?(right, left)
  end

  # JSONB key existence operators
  # ? checks if key exists in object or string exists in array
  defpostgres "jsonb ? text -> bool" do
    def jsonb_key_exists?(json, key) when is_map(json) and is_binary(key) do
      Map.has_key?(json, key)
    end

    # For arrays, check if the string exists as a top-level element
    def jsonb_key_exists?(json, key) when is_list(json) and is_binary(key) do
      Enum.member?(json, key)
    end

    def jsonb_key_exists?(_, _), do: false
  end

  # ?| checks if any of the keys exist
  defpostgres "jsonb ?| text[] -> bool" do
    def jsonb_any_key_exists?(json, keys) when is_map(json) and is_list(keys) do
      Enum.any?(keys, &Map.has_key?(json, &1))
    end

    def jsonb_any_key_exists?(json, keys) when is_list(json) and is_list(keys) do
      key_set = MapSet.new(keys)
      Enum.any?(json, &(&1 in key_set))
    end

    def jsonb_any_key_exists?(_, _), do: false
  end

  # ?& checks if all of the keys exist
  defpostgres "jsonb ?& text[] -> bool" do
    def jsonb_all_keys_exist?(json, keys) when is_map(json) and is_list(keys) do
      Enum.all?(keys, &Map.has_key?(json, &1))
    end

    def jsonb_all_keys_exist?(json, keys) when is_list(json) and is_list(keys) do
      key_set = MapSet.new(keys)
      Enum.all?(key_set, &Enum.member?(json, &1))
    end

    def jsonb_all_keys_exist?(_, _), do: false
  end

  ## Array functions
  defpostgres("anyarray = anyarray -> bool", delegate: &Kernel.==/2)
  defpostgres("anyarray <> anyarray -> bool", delegate: &Kernel.!=/2)

  defpostgres("anycompatiblearray || anycompatiblearray -> anycompatiblearray",
    delegate: &PgInterop.Array.concat_arrays/2,
    strict?: false
  )

  defpostgres("array_cat(anycompatiblearray, anycompatiblearray) -> anycompatiblearray",
    delegate: &PgInterop.Array.concat_arrays/2,
    strict?: false
  )

  defpostgres("anycompatible || anycompatiblearray -> anycompatiblearray",
    delegate: &PgInterop.Array.array_prepend_concat/2,
    strict?: false
  )

  defpostgres("array_prepend(anycompatible, anycompatiblearray) -> anycompatiblearray",
    delegate: &PgInterop.Array.array_prepend/2,
    strict?: false
  )

  defpostgres("anycompatiblearray || anycompatible -> anycompatiblearray",
    delegate: &PgInterop.Array.array_append_concat/2,
    strict?: false
  )

  defpostgres("array_append(anycompatiblearray, anycompatible) -> anycompatiblearray",
    delegate: &PgInterop.Array.array_append/2,
    strict?: false
  )

  defpostgres("array_ndims(anyarray) -> int4", delegate: &PgInterop.Array.get_array_dim/1)

  defpostgres "anyarray @> anyarray -> bool" do
    def left_array_contains_right?(left, right) do
      MapSet.subset?(
        List.flatten(right) |> MapSet.new(),
        List.flatten(left) |> Enum.reject(&is_nil/1) |> MapSet.new()
      )
    end
  end

  defpostgres "anyarray <@ anyarray -> bool" do
    def right_array_contains_left?(left, right) do
      MapSet.subset?(
        List.flatten(left) |> MapSet.new(),
        List.flatten(right) |> Enum.reject(&is_nil/1) |> MapSet.new()
      )
    end
  end

  defpostgres "anyarray && anyarray -> bool" do
    def arrays_overlap?(left, right) when left == [] or right == [], do: false

    def arrays_overlap?(left, right) when is_list(left) and is_list(right),
      do: arrays_overlap?(MapSet.new(List.flatten(left)), MapSet.new(List.flatten(right)))

    def arrays_overlap?(%MapSet{} = left, right) do
      Enum.any?(right, fn
        elem when is_list(elem) -> arrays_overlap?(left, elem)
        nil -> false
        elem -> MapSet.member?(left, elem)
      end)
    end
  end
end
