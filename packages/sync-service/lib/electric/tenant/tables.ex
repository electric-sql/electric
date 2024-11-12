defmodule Electric.Tenant.Tables do
  def name(electric_instance_id) do
    :"tenant_tables_#{electric_instance_id}"
  end

  def init(electric_instance_id) do
    :ets.new(name(electric_instance_id), [
      :public,
      :named_table,
      :set,
      {:read_concurrency, true}
    ])
  end
end
