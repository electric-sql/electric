defmodule Electric.Telemetry.OptionalSpans do
  def include?("filter." <> _), do: Application.get_env(:electric, :profile_where_clauses?)
  def include?("pg_txn.replication_client.relation_received"), do: false
  def include?("pg_txn.replication_client.transaction_received"), do: false
  def include?(_), do: true
end
