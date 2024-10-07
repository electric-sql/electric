defprotocol Electric.PersistentKV do
  def get(kv, key)
  def get_all(kv)
  def set(kv, key, value)
  def delete(kv, key)
end
