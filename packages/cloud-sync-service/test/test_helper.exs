{:ok, _} =
  CloudElectric.ProcessRegistry.start_link(name: CloudElectric.ProcessRegistry, keys: :unique)

ExUnit.start()
