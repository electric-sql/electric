import Config
import Dotenvy

storage_dir = env!("ELECTRIC_STORAGE_DIR", :string, "./persistent")
shape_path = Path.join(storage_dir, "./shapes")
persistent_state_path = Path.join(storage_dir, "./state")

persistent_kv =
  env!(
    "ELECTRIC_PERSISTENT_STATE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.PersistentKV.Memory, :new!, []}

        "file" ->
          {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}

        _ ->
          raise Dotenvy.Error, message: "ELECTRIC_PERSISTENT_STATE must be one of: MEMORY, FILE"
      end
    end,
    {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}
  )

{storage_mod, storage_opts} =
  env!(
    "ELECTRIC_STORAGE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.ShapeCache.InMemoryStorage, []}

        "file" ->
          {Electric.ShapeCache.FileStorage, storage_dir: shape_path}

        "crashing_file" ->
          num_calls_until_crash =
            env!("CRASHING_FILE_ELECTRIC_STORAGE__NUM_CALLS_UNTIL_CRASH", :integer)

          {Electric.ShapeCache.CrashingFileStorage,
           storage_dir: shape_path, num_calls_until_crash: num_calls_until_crash}

        _ ->
          raise Dotenvy.Error, message: "storage must be one of: MEMORY, FILE"
      end
    end,
    {Electric.ShapeCache.FileStorage, storage_dir: shape_path}
  )

long_poll_timeout = env!("ELECTRIC_LONG_POLL_TIMEOUT", :integer, 20_000)
cache_max_age = env!("ELECTRIC_CACHE_MAX_AGE", :integer, 60)
cache_stale_age = env!("ELECTRIC_CACHE_STALE_AGE", :integer, 60 * 5)

storage = {storage_mod, storage_opts}

pool_opts = [
  pool_size: env!("ELECTRIC_DB_POOL_SIZE", :integer, 50)
]

config :cloud_electric,
  persistent_kv: persistent_kv,
  long_poll_timeout: long_poll_timeout,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  allow_shape_deletion: true,
  storage: storage,
  pool_opts: pool_opts,
  service_port: env!("ELECTRIC_PORT", :integer, 3000),
  listen_on_ipv6?: env!("ELECTRIC_LISTEN_ON_IPV6", :boolean, false)
