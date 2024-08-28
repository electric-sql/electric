defprotocol Electric.PersistentKV do
  def get(kv, key)
  def set(kv, key, value)
end
