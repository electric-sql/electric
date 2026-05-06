import { useRuntimes } from '../../hooks/useRuntimes'
import { useMcpServers } from '../../hooks/useMcpServers'
import { ServerRow } from './ServerRow'
import styles from './ConnectedServicesPage.module.css'

export function ConnectedServicesPage(): React.ReactElement {
  const { runtimes, error: runtimesError } = useRuntimes()

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Connected Services</h1>
        <span className={styles.experimental}>experimental</span>
      </header>
      {runtimesError && (
        <p className={styles.error}>
          Discovery failed: {runtimesError.message}
        </p>
      )}
      {runtimes.length === 0 && !runtimesError && (
        <p>No runtimes registered.</p>
      )}
      {runtimes.map((rt) => (
        <RuntimeSection key={rt.name} runtime={rt} />
      ))}
    </main>
  )
}

function RuntimeSection({
  runtime,
}: {
  runtime: { name: string; publicUrl: string }
}): React.ReactElement {
  const { servers, error } = useMcpServers({ runtimeUrl: runtime.publicUrl })
  return (
    <section className={styles.runtime}>
      <h2>{runtime.name}</h2>
      <p className={styles.publicUrl}>{runtime.publicUrl}</p>
      {error && <p className={styles.error}>{error.message}</p>}
      {servers.length === 0 ? (
        <p className={styles.empty}>
          No MCP servers registered on this runtime.
        </p>
      ) : (
        <ul className={styles.list}>
          {servers.map((s) => (
            <li key={s.name}>
              <ServerRow server={s} runtimeUrl={runtime.publicUrl} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
