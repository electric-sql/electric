defmodule Electric.Replication.Shapes.ShapeRequest do
  @moduledoc """
  The validated and structured shape request that came from the client.

  Shape requests are part of a subscription that the client establishes. They are used
  in two general areas: first, when the subscription is requested, we need to fetch
  data from PG according to the shape request, and second, when the subscription is
  established, we're using the shape requests to filter the replication stream.

  > #### TODO: Missing features {: .info}
  >
  > This module currently implements a very basic understanding of the shape requests.
  > Each public function in this module will need to be updated, as the functionality is added
  > to the `satellite.proto` file.
  """
  alias Electric.Utils
  alias Electric.Replication.Changes
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes.ShapeRequest.Validation
  alias Electric.Replication.Shapes.Querying
  alias Electric.Satellite.SatShapeDef
  alias Electric.Satellite.SatShapeDef.Select
  alias Electric.Satellite.SatShapeReq
  alias Electric.Postgres.Extension.SchemaLoader

  defmodule Layer do
    @enforce_keys [:target_table, :target_pk, :direction]

    defstruct [
      :request_id,
      :source_table,
      :source_pk,
      :target_table,
      :target_pk,
      :direction,
      :fk,
      :key,
      :parent_key,
      :where_target,
      next_layers: []
    ]

    @type relation :: {String.t(), String.t()}
    @type column_list :: [String.t(), ...]
    @type graph_key :: term()

    @type top_layer :: %__MODULE__{
            request_id: String.t(),
            source_table: nil,
            target_table: relation(),
            source_pk: nil,
            target_pk: column_list(),
            fk: nil,
            direction: :first_layer,
            key: graph_key(),
            parent_key: nil,
            where_target: nil | Eval.Expr.t(),
            next_layers: [t()]
          }

    @type normal_layer :: %__MODULE__{
            request_id: String.t(),
            source_table: relation(),
            target_table: relation(),
            source_pk: column_list(),
            target_pk: column_list(),
            fk: column_list(),
            direction: :one_to_many | :many_to_one,
            key: graph_key(),
            parent_key: graph_key(),
            where_target: nil | Eval.Expr.t(),
            next_layers: [t()]
          }

    @type t() :: top_layer() | normal_layer()
  end

  @type relation :: {String.t(), String.t()}
  @type layer_map :: %{relation() => [Layer.t(), ...]}

  defstruct [:id, :hash, tree: [], layer_map: %{}]

  @type t() :: %__MODULE__{
          id: String.t(),
          tree: Layer.t(),
          hash: String.t(),
          layer_map: layer_map()
        }

  @doc """
  Convert shape request from Satellite to internal representation.
  """
  @spec from_satellite(%SatShapeReq{}, Graph.t(), SchemaLoader.Version.t()) ::
          {:ok, t()} | Validation.error()
  def from_satellite(%SatShapeReq{} = req, graph, schema) do
    with {:ok, select} <- request_not_empty(req.shape_definition),
         {:ok, tree, layer_map} <- Validation.build_tree(select, graph, schema, req.request_id) do
      {:ok,
       %__MODULE__{
         id: req.request_id,
         tree: tree,
         hash: Utils.term_hash(tree),
         layer_map: layer_map
       }}
    end
  end

  @spec request_not_empty(%SatShapeDef{} | nil) :: {:ok, %Select{}} | Validation.error()
  defp request_not_empty(%SatShapeDef{selects: [select]}), do: {:ok, select}

  defp request_not_empty(%SatShapeDef{selects: selects}) when selects != [],
    do: {:error, {:INVALID_INCLUDE_TREE, "Cannot have more than one top-level select"}}

  defp request_not_empty(_),
    do: {:error, {:EMPTY_SHAPE_DEFINITION, "Empty shape requests are not allowed"}}

  @spec relevant_layers(t(), Changes.change()) :: [Layer.t()]
  def relevant_layers(%__MODULE__{layer_map: map}, %{relation: relation}),
    do: Map.get(map, relation, [])

  @spec included_tables(t()) :: [relation(), ...]
  def included_tables(%__MODULE__{layer_map: map}), do: Map.keys(map)

  def prepare_filtering_context(_previous_requests), do: %{}

  @spec query_initial_data(t(), term(), SchemaLoader.Version.t(), String.t(), map()) ::
          {:error, any()} | {:ok, %{term() => {Changes.NewRecord.t(), [term()]}}, Graph.t()}
  def query_initial_data(%__MODULE__{} = req, conn, schema_version, origin, context) do
    Querying.query_layer(
      conn,
      req.tree,
      schema_version,
      origin,
      Map.put(context, :request_id, req.id)
    )
  end

  def query_moved_in_layer_data(
        conn,
        %Layer{} = layer,
        moved_in_records,
        schema_version,
        origin,
        context
      ) do
    # We're converting these records to a list of keys to query next layers on
    curr_records =
      Enum.map(moved_in_records, fn {id, record} -> {id, %Changes.NewRecord{record: record}} end)

    # We only need to follow one-to-many relations here from the already-fetched rows
    filtered_layer = %Layer{
      layer
      | next_layers: Enum.filter(layer.next_layers, &(&1.direction == :one_to_many))
    }

    Querying.query_next_layers(
      conn,
      filtered_layer,
      schema_version,
      origin,
      context,
      curr_records
    )
  end
end
