defmodule Electric.Replication.Eval.Env do
  @moduledoc """
  Evaluation environment for parsing PostgreSQL expressions.

  We have a need to parse PG expressions, and then be able to
  execute them in Electric without reaching for Postgres on every operation.
  This is achieved by parsing Postgres expressions, however Postgres has
  a lot of features we're unlikely to support, and, moreover, very dynamic:
  new features, new data types - everything can be redefined, including
  so-called "preferred" data types, new type categories, implicit casts, etc.
  Redefining all this for normal types is quite unlikely in the wild, but may be
  later common for custom types.

  Parsing PG expressions, we need to know what we support. It's then reasonable
  to have a good set of defaults we know how to deal with, but leave an escape hatch
  so that until we add support for pulling all this data from PG, we have a working
  system. Even afterwards, a set of PG functions using, say `PLSQL` is likely to use
  default PG functions, which we still need to know how to execute.

  This module defines a struct that contains information, relevant to parsing PG
  statements into something Electric can understand, while respecting PG types
  and function/operator overload selections.

  It's also worth noting that our defaults, especially implicit casts specifically
  omit any "system" types (e.g. `regclass` or `pg_ndistinct`) because we're essentially
  never going to have enough context in Electric to be able to correctly utilize those
  types.
  """

  ### Constants

  # Polymorphic types. Although they technically can be added at runtime, PG code will not respect them, so neither should we.
  #   General info: https://www.postgresql.org/docs/current/extend-type-system.html#EXTEND-TYPES-POLYMORPHIC
  #   Example of why only hardcoded types are respected: https://github.com/postgres/postgres/blob/e8c334c47abb6c8f648cb50241c2cd65c9e4e6dc/src/backend/parser/parse_coerce.c#L1702
  @simple_polymorphic_types ~w|anyelement anyarray anynonarray anyenum anyrange anymultirange|a
  @common_polymorphic_types ~w|anycompatible anycompatiblearray anycompatiblenonarray anycompatiblerange anycompatiblemultirange|a

  ### Types
  @type flat_pg_type :: basic_type() | {:composite, map()} | :record | {:enum, term()}

  @type pg_type ::
          flat_pg_type()
          | {:array, flat_pg_type()}
          | {:range, flat_pg_type()}
          | {:multirange, flat_pg_type()}

  @type basic_type :: atom()

  @type cast_key :: {from :: basic_type(), to :: basic_type()}
  @type cast_function :: {module :: module(), function :: atom()}
  @type implicit_cast_function :: cast_function() | :as_is
  @type cast_registry :: %{required(cast_key()) => cast_function()}
  @type implicit_cast_registry :: %{required(cast_key()) => implicit_cast_function()}

  @type type_info :: %{
          category: atom(),
          preferred?: boolean()
        }
  @type basic_type_registry :: %{required(basic_type()) => type_info()}

  @type func_id :: {name :: String.t(), arity :: non_neg_integer()}
  @type func :: %{
          optional(:strict?) => boolean(),
          optional(:immutable?) => boolean(),
          args: [pg_type()],
          returns: pg_type(),
          implementation: {module(), atom()} | fun(),
          name: String.t()
        }
  @type funcs :: %{required(func_id()) => [func(), ...]}

  defstruct funcs: __MODULE__.KnownFunctions.known_functions(),
            operators: __MODULE__.KnownFunctions.known_operators(),
            explicit_casts: __MODULE__.ExplicitCasts.known(),
            implicit_casts: __MODULE__.ImplicitCasts.known(),
            known_basic_types: __MODULE__.BasicTypes.known()

  @type t() :: %__MODULE__{
          funcs: funcs(),
          operators: funcs(),
          explicit_casts: cast_registry(),
          implicit_casts: implicit_cast_registry(),
          known_basic_types: basic_type_registry()
        }

  @struct_keys [:funcs, :explicit_casts, :implicit_casts, :known_basic_types, :operators]

  @type env_property ::
          {:funcs, funcs()}
          | {:operators, funcs()}
          | {:explicit_casts, cast_registry()}
          | {:implicit_casts, implicit_cast_registry()}
          | {:known_basic_types, basic_type_registry()}

  @doc """
  Create a new environment with known defaults, merging in provided keys
  """
  @spec new(list(env_property())) :: t()
  def new(additions \\ []) do
    Enum.reduce(@struct_keys, %__MODULE__{}, fn key, struct ->
      Map.update!(struct, key, &Map.merge(&1, Keyword.get(additions, key, %{})))
    end)
  end

  @doc """
  Create a new empty environment, without any default functions or explicit casts
  """
  def empty(additions \\ []) do
    base = %__MODULE__{funcs: %{}, explicit_casts: %{}, operators: %{}}

    # Take explicit text parsing functions into "empty" state
    text_cast_functions =
      Map.keys(base.known_basic_types)
      |> Enum.map(&{to_string(&1), 1})
      |> then(&Map.take(__MODULE__.KnownFunctions.known_functions(), &1))

    base = %{base | funcs: text_cast_functions}

    Enum.reduce(@struct_keys, base, fn key, struct ->
      Map.update!(struct, key, &Map.merge(&1, Keyword.get(additions, key, %{})))
    end)
  end

  @text_types ~w|text varchar name bpchar|a

  @doc """
  Parse an unknown value constant as a known type in the current environment.
  """
  @spec parse_const(t(), String.t() | nil, pg_type()) :: {:ok, term()} | :error
  # Any type can be nullable in general
  def parse_const(%__MODULE__{}, nil, _), do: {:ok, nil}
  # Text is special-cased as never needing parsing
  def parse_const(%__MODULE__{}, value, x) when x in @text_types, do: {:ok, value}

  def parse_const(%__MODULE__{}, value, {:array, subtype}) when subtype in @text_types do
    {:ok, PgInterop.Array.parse(value)}
  rescue
    _ -> :error
  end

  def parse_const(%__MODULE__{funcs: funcs}, value, {:array, subtype}) do
    with {:ok, overloads} <- Map.fetch(funcs, {to_string(subtype), 1}),
         %{implementation: impl} <- Enum.find(overloads, &(&1.args == [:text])) do
      try do
        case impl do
          {module, fun} -> {:ok, PgInterop.Array.parse(value, &apply(module, fun, [&1]))}
          fun -> {:ok, PgInterop.Array.parse(value, &apply(fun, [&1]))}
        end
      rescue
        _ -> :error
      end
    else
      _ -> :error
    end
  end

  # For enum types, we can't validate the value without knowing the DDL.
  # When allow_enums is true (used by subsets), we accept any string value
  # and let Postgres validate when the query runs.
  def parse_const(%__MODULE__{}, value, {:enum, _}, opts) when is_binary(value) do
    if Keyword.get(opts, :allow_enums, false) do
      {:ok, value}
    else
      :error
    end
  end

  # For arrays of enum types, parse the array and check allow_enums flag
  def parse_const(%__MODULE__{}, value, {:array, {:enum, _}}, opts) do
    if Keyword.get(opts, :allow_enums, false) do
      {:ok, PgInterop.Array.parse(value)}
    else
      :error
    end
  rescue
    _ -> :error
  end

  # Default 3-arity version for non-enum types - no opts needed
  def parse_const(%__MODULE__{funcs: funcs}, value, type) do
    with {:ok, overloads} <- Map.fetch(funcs, {to_string(type), 1}),
         %{implementation: impl} <- Enum.find(overloads, &(&1.args == [:text])) do
      try do
        case impl do
          {module, fun} -> {:ok, apply(module, fun, [value])}
          fun -> {:ok, apply(fun, [value])}
        end
      rescue
        _ -> :error
      end
    else
      _ -> :error
    end
  end

  def const_to_pg_string(%__MODULE__{}, value, type) when type in @text_types, do: value
  def const_to_pg_string(%__MODULE__{}, value, {:enum, _}), do: value

  def const_to_pg_string(%__MODULE__{} = env, value, {:array, type}) do
    "ARRAY[#{array_section_to_string(env, value, type)}]"
  end

  def const_to_pg_string(%__MODULE__{funcs: funcs}, value, type) do
    [%{implementation: impl}] = Map.fetch!(funcs, {to_string(type) <> "out", 1})

    case impl do
      {module, fun} -> apply(module, fun, [value])
      fun -> apply(fun, [value])
    end
  end

  defp array_section_to_string(env, value, type) when is_list(value),
    do: "[#{Enum.map(value, &array_section_to_string(env, &1, type))}]"

  defp array_section_to_string(env, value, type), do: const_to_pg_string(env, value, type)

  @doc """
  Check if one type is implicitly castable to another type in this environment.
  """
  @spec implicitly_castable?(t(), basic_type(), basic_type()) :: boolean()

  def implicitly_castable?(_, same, same), do: true

  def implicitly_castable?(%__MODULE__{implicit_casts: casts}, from, to),
    do: is_map_key(casts, {from, to})

  @doc """
  Get type category for the given type (possibly non-basic).
  """
  @spec get_type_category(t(), pg_type()) :: atom()
  def get_type_category(_, {:array, _}), do: :array
  def get_type_category(_, {:range, _}), do: :range
  def get_type_category(_, {:multirange, _}), do: :multirange
  def get_type_category(_, :unknown), do: :unknown
  def get_type_category(_, {:composite, _}), do: :composite
  def get_type_category(_, :composite), do: :composite
  def get_type_category(_, name) when name in @common_polymorphic_types, do: :pseudo
  def get_type_category(_, name) when name in @simple_polymorphic_types, do: :pseudo

  def get_type_category(%__MODULE__{known_basic_types: types}, type) when is_map_key(types, type),
    do: types[type].category

  def get_type_category(_, type),
    do: raise(RuntimeError, message: "unknown type #{inspect(type)}")

  @doc """
  Check if type is preferred within the type category.
  """
  def is_preferred?(%__MODULE__{known_basic_types: types}, type),
    do: get_in(types, [type, :preferred?]) || false

  @doc """
  Find an appropriate cast function for the given types in this environment.
  """
  @spec find_cast_function(t(), pg_type(), pg_type()) ::
          {:ok, implicit_cast_function()} | {:ok, :array_cast, implicit_cast_function()} | :error
  def find_cast_function(%__MODULE__{} = env, from_type, to_type) do
    with :error <- Map.fetch(env.implicit_casts, {from_type, to_type}) do
      case {from_type, to_type} do
        {:unknown, _} ->
          {:ok, {Function, :identity}}

        {_, :unknown} ->
          {:ok, {Function, :identity}}

        {{:array, t1}, {:array, t2}} ->
          case find_cast_function(env, t1, t2) do
            {:ok, :as_is} -> {:ok, :as_is}
            {:ok, impl} -> {:ok, :array_cast, impl}
            :error -> :error
          end

        {:text, to_type} ->
          find_cast_in_function(env, to_type)

        {from_type, :text} ->
          find_cast_out_function(env, from_type)

        {from_type, to_type} ->
          find_explicit_cast(env, from_type, to_type)
      end
    end
  end

  defp find_cast_in_function(env, {:array, to_type}) do
    with {:ok, [%{args: [:text], implementation: impl}]} <-
           Map.fetch(env.funcs, {"#{to_type}", 1}) do
      {:ok, &PgInterop.Array.parse(&1, impl)}
    end
  end

  defp find_cast_in_function(_env, {:enum, _to_type}) do
    # we can't convert arbitrary strings to enums until we know
    # the DDL for the enum
    :error
  end

  defp find_cast_in_function(env, to_type) do
    case Map.fetch(env.funcs, {"#{to_type}", 1}) do
      {:ok, [%{args: [:text], implementation: impl}]} -> {:ok, impl}
      _ -> :error
    end
  end

  defp find_cast_out_function(_env, {:enum, _enum_type}), do: {:ok, :as_is}

  defp find_cast_out_function(env, from_type) do
    case Map.fetch(env.funcs, {"#{from_type}out", 1}) do
      {:ok, [%{args: [^from_type], implementation: impl}]} -> {:ok, impl}
      _ -> :error
    end
  end

  defp find_explicit_cast(env, from_type, to_type),
    do: Map.fetch(env.explicit_casts, {from_type, to_type})

  # This function implements logic from https://github.com/postgres/postgres/blob/e8c334c47abb6c8f648cb50241c2cd65c9e4e6dc/src/backend/parser/parse_coerce.c#L556
  def get_unified_coercion_targets(%__MODULE__{} = env, inputs, targets, return_type \\ nil) do
    # PG has two "groups" of polymorphic types, that need to agree within themselves, but not across
    polymorphic_agg = %{simple: [], common: []}

    # Any `{:cont, agg}` returns means that this pair matches by definition
    Enum.zip(inputs, targets)
    |> Enum.reduce_while(polymorphic_agg, fn
      {input, input}, agg ->
        {:cont, agg}

      {:unknown, _}, agg ->
        {:cont, agg}

      {input, target}, agg when target in @simple_polymorphic_types ->
        {:cont, Map.update!(agg, :simple, &[{input, target} | &1])}

      {input, target}, agg when target in @common_polymorphic_types ->
        {:cont, Map.update!(agg, :common, &[{input, target} | &1])}

      {_, :any}, agg ->
        {:cont, agg}

      {:record, {:composite, _}}, agg ->
        {:cont, agg}

      {{:composite, _}, :record}, agg ->
        {:cont, agg}

      {{:array, {:composite, _}}, {:array, :record}}, agg ->
        {:cont, agg}

      {{:array, input}, {:array, target}}, agg ->
        if implicitly_castable?(env, input, target), do: {:cont, agg}, else: {:halt, :error}

      {input, target}, agg ->
        if implicitly_castable?(env, input, target), do: {:cont, agg}, else: {:halt, :error}
    end)
    |> case do
      :error ->
        :error

      %{simple: [], common: []} ->
        {:ok,
         {replace_all_polymorphics(targets, :text, :text),
          replace_polymorphics(return_type, :text, :text)}}

      %{simple: simple, common: common} ->
        with {:ok, simple_consensus} <- simple_polymorphics_consensus(simple),
             {:ok, common_consensus} <- common_polymorphics_consensus(common, env) do
          {:ok,
           {replace_all_polymorphics(targets, simple_consensus, common_consensus),
            replace_polymorphics(return_type, simple_consensus, common_consensus)}}
        end
    end
  end

  defp replace_all_polymorphics(types, simple, common),
    do: Enum.map(types, &replace_polymorphics(&1, simple, common))

  defp replace_polymorphics(type, simple_consensus, _) when type in [:anyelement, :anynonarray],
    do: simple_consensus

  defp replace_polymorphics(:anyarray, simple_consensus, _), do: {:array, simple_consensus}
  # For anyenum, the consensus is already {:enum, name} so we don't need to wrap it
  defp replace_polymorphics(:anyenum, {:enum, _} = simple_consensus, _), do: simple_consensus
  defp replace_polymorphics(:anyenum, simple_consensus, _), do: {:enum, simple_consensus}
  defp replace_polymorphics(:anyrange, simple_consensus, _), do: {:range, simple_consensus}

  defp replace_polymorphics(:anymultirange, simple_consensus, _),
    do: {:multirange, simple_consensus}

  defp replace_polymorphics(type, _, common_consensus)
       when type in [:anycompatible, :anycompatiblenonarray],
       do: common_consensus

  defp replace_polymorphics(:anycompatiblearray, _, common_consensus),
    do: {:array, common_consensus}

  defp replace_polymorphics(:anycompatiblerange, _, common_consensus),
    do: {:range, common_consensus}

  defp replace_polymorphics(:anycompatiblemultirange, _, common_consensus),
    do: {:multirange, common_consensus}

  defp replace_polymorphics(target, _, _), do: target

  @doc """
  Check if a list of inputs can be implicitly coerced to a list of targets.

  Note that other functions may not exactly support all of types
  """
  @spec can_implicitly_coerce_types?(t(), list(pg_type()), list(pg_type())) :: boolean()
  # This function implements logic from https://github.com/postgres/postgres/blob/e8c334c47abb6c8f648cb50241c2cd65c9e4e6dc/src/backend/parser/parse_coerce.c#L556
  def can_implicitly_coerce_types?(%__MODULE__{} = env, inputs, targets) do
    get_unified_coercion_targets(env, inputs, targets) != :error
  end

  defp simple_polymorphics_consensus(args, consensus \\ nil)
  defp simple_polymorphics_consensus([], consensus), do: {:ok, consensus}

  # Check both that the element can satisfy the container limitation, and that the contained type matches
  defp simple_polymorphics_consensus([{{:array, elem}, :anyarray} | tail], x)
       when is_nil(x) or x == elem,
       do: simple_polymorphics_consensus(tail, elem)

  defp simple_polymorphics_consensus([{{:range, elem}, :anyrange} | tail], x)
       when is_nil(x) or x == elem,
       do: simple_polymorphics_consensus(tail, elem)

  defp simple_polymorphics_consensus([{{:multirange, elem}, :anymultirange} | tail], x)
       when is_nil(x) or x == elem,
       do: simple_polymorphics_consensus(tail, elem)

  # `:anyarray`, `:anyrange`, and `:anymultirange` basically "unwrap" values, but anything else doesn't
  defp simple_polymorphics_consensus([{{:array, _}, :anynonarray} | _], _), do: :error
  defp simple_polymorphics_consensus([{_, :anynonarray} | _], {:array, _}), do: :error

  defp simple_polymorphics_consensus([{elem, :anynonarray} | tail], x)
       when is_nil(x) or elem == x,
       do: simple_polymorphics_consensus(tail, elem)

  defp simple_polymorphics_consensus([{{:enum, _} = elem, :anyenum} | tail], x)
       when is_nil(x) or elem == x,
       do: simple_polymorphics_consensus(tail, elem)

  defp simple_polymorphics_consensus([{elem, :anyelement} | tail], x) when is_nil(x) or elem == x,
    do: simple_polymorphics_consensus(tail, elem)

  # If all guards failed, then we bail
  defp simple_polymorphics_consensus(_, _), do: :error

  defp common_polymorphics_consensus([], _), do: {:ok, nil}

  defp common_polymorphics_consensus(args, env) do
    # Logic in this loop tries to find common supertype for provided inputs, following same logic as
    # https://github.com/postgres/postgres/blob/e8c334c47abb6c8f648cb50241c2cd65c9e4e6dc/src/backend/parser/parse_coerce.c#L1443

    {{consensus, _, _}, seen_nonarray?} =
      Enum.reduce(args, {{nil, nil, false}, false}, fn {input, target}, acc ->
        input = unwrap(input, target)
        category = get_type_category(env, input)
        preferred? = is_preferred?(env, input)
        nonarray? = target == :anycompatiblenonarray

        case acc do
          {{nil, _, _}, _} ->
            {{input, category, preferred?}, nonarray?}

          {{_, ^category, true} = old, seen_nonarray?} ->
            {old, seen_nonarray? or nonarray?}

          {{cur_type, ^category, _} = old, seen_nonarray?} ->
            # Take new type if can coerce to it but not the other way
            if implicitly_castable?(env, cur_type, input) and
                 not implicitly_castable?(env, input, cur_type) do
              {{input, category, preferred?}, seen_nonarray? or nonarray?}
            else
              {old, seen_nonarray? or nonarray?}
            end

          # Differing category, irreconcilable
          {_, _} ->
            throw(:unsatisfied_polymorphic_constraint)
        end
      end)

    # If any of polymorphic variables are `nonarray`, then consensus cannot be array
    # and all inputs have to be actually castable to the consensus
    if not (seen_nonarray? and match?({:array, _}, consensus)) and
         Enum.all?(args, fn {input, target} ->
           implicitly_castable?(env, unwrap(input, target), consensus)
         end) do
      {:ok, consensus}
    else
      :error
    end
  catch
    :unsatisfied_polymorphic_constraint -> :error
  end

  defp unwrap({:array, value}, :anycompatiblearray), do: value
  defp unwrap({:range, value}, :anycompatiblerange), do: value
  defp unwrap({:multirange, value}, :anycompatiblemultirange), do: value
  defp unwrap(value, kind) when kind in [:anycompatible, :anycompatiblenonarray], do: value
  defp unwrap(_, _), do: throw(:unsatisfied_polymorphic_constraint)
end
