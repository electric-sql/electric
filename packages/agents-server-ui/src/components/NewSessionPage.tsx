import { useCallback, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { nanoid } from 'nanoid'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { Text } from '../ui'
import { MainHeader } from './MainHeader'
import { SchemaForm, hasSchemaProperties } from './SchemaForm'
import { CodingSessionSpawnForm } from './CodingSessionSpawnForm'
import styles from './NewSessionPage.module.css'
import type { ElectricEntityType } from '../lib/ElectricAgentsProvider'

/**
 * Cursor / Codex-style "new session" page. Shown at `/`.
 *
 * Picks an entity type, then either spawns immediately (no schema), or
 * shows the schema-driven form inline. No modals — the form lives in
 * the main column right under the page header.
 */
export function NewSessionPage(): React.ReactElement {
  const navigate = useNavigate()
  const { entityTypesCollection, spawnEntity } = useElectricAgents()
  const [selected, setSelected] = useState<ElectricEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: entityTypes = [] } = useLiveQuery(
    (query) => {
      if (!entityTypesCollection) return undefined
      return query
        .from({ t: entityTypesCollection })
        .where(({ t }) => not(eq(t.name, `worker`)))
        .orderBy(({ t }) => t.name, `asc`)
    },
    [entityTypesCollection]
  )

  const doSpawn = useCallback(
    (typeName: string, args?: Record<string, unknown>) => {
      if (!spawnEntity) return
      setError(null)
      const name = nanoid(10)
      const initialMessage =
        typeName === CODING_SESSION_ENTITY_TYPE
          ? { __bootstrap: true }
          : undefined
      const tx = spawnEntity({ type: typeName, name, args, initialMessage })
      navigate({
        to: `/entity/$`,
        params: { _splat: `${typeName}/${name}` },
      })
      tx.isPersisted.promise.catch((err: Error) => {
        setError(
          `Could not start session: ${err.message}. The server may be missing ANTHROPIC_API_KEY.`
        )
      })
    },
    [navigate, spawnEntity]
  )

  const handleSelectType = useCallback(
    (entityType: ElectricEntityType) => {
      // For coder sessions and any type with a schema we show the form
      // inline instead of spawning right away.
      if (entityType.name === CODING_SESSION_ENTITY_TYPE) {
        setSelected(entityType)
        return
      }
      if (hasSchemaProperties(entityType.creation_schema)) {
        setSelected(entityType)
        return
      }
      doSpawn(entityType.name)
    },
    [doSpawn]
  )

  return (
    <div className={styles.shell}>
      <MainHeader title={<Text size={2}>New session</Text>} />
      <div className={styles.body}>
        <div className={styles.container}>
          <div className={styles.heading}>
            <Text size={5} as="h1" className={styles.headingTitle}>
              Start a new session
            </Text>
            <span className={styles.headingSubtitle}>
              {selected
                ? `Configure the agent below, then create the session.`
                : `Pick the kind of agent you want to spawn.`}
            </span>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {selected ? (
            <div className={styles.formCard}>
              <div className={styles.formHeader}>
                <div className={styles.formHeaderText}>
                  <Text size={3}>{selected.name}</Text>
                  {selected.description && (
                    <Text size={1} tone="muted">
                      {selected.description}
                    </Text>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.backLink}
                  onClick={() => setSelected(null)}
                >
                  ← Back
                </button>
              </div>
              {selected.name === CODING_SESSION_ENTITY_TYPE ? (
                <CodingSessionSpawnForm
                  onSubmit={(args) => doSpawn(selected.name, args)}
                  onCancel={() => setSelected(null)}
                />
              ) : (
                <SchemaForm
                  schema={selected.creation_schema}
                  submitLabel="Create"
                  onSubmit={(args) => doSpawn(selected.name, args)}
                  onCancel={() => setSelected(null)}
                />
              )}
            </div>
          ) : entityTypes.length === 0 ? (
            <div className={styles.empty}>
              No entity types registered. Make sure your agents server is
              running and reachable.
            </div>
          ) : (
            <div className={styles.typeGrid}>
              {entityTypes.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={styles.typeCard}
                  onClick={() => handleSelectType(t)}
                  disabled={!spawnEntity}
                >
                  <span className={styles.typeCardName}>{t.name}</span>
                  {t.description && (
                    <span className={styles.typeCardDescription}>
                      {t.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
