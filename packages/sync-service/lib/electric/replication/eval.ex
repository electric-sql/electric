defmodule Electric.Replication.Eval do
  def type_to_pg_cast({:array, type}), do: "#{type_to_pg_cast(type)}[]"
  def type_to_pg_cast({:enum, name}), do: to_string(name)
  def type_to_pg_cast({:row, _}), do: raise("Unsupported type: row")
  def type_to_pg_cast({:internal, _}), do: raise("Unsupported type: internal")
  def type_to_pg_cast(type), do: to_string(type)
end
