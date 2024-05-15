import { useState, useEffect, useCallback, useMemo } from 'react'
import { useElectric } from '../electric'

import { BsCloudArrowDownFill, BsCloudSlashFill } from 'react-icons/bs'
import { AiOutlineLoading3Quarters } from 'react-icons/ai'

interface Props {
  projectId: string
}

function ProjectSyncToggle({ projectId }: Props) {
  const { db, satellite } = useElectric()!
  const [loading, setLoading] = useState(false)
  const [synced, setSynced] = useState(false)

  const shapeRequest = useMemo(
    () => ({
      where: {
        project_id: projectId,
      },
      include: {
        comment: true,
        project: true,
      },
    }),
    [projectId]
  )

  const syncProject = useCallback(async () => {
    setLoading(true)
    try {
      const synced = await db.issue.sync(shapeRequest)
      await synced.synced
      setSynced(true)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [shapeRequest, db.issue])

  const unsyncProject = useCallback(() => {
    // TODO: add proper shape unsub
  }, [])

  useEffect(() => {
    // @ts-expect-error using private method until we have shapes API
    const shape = db.issue.computeShape(shapeRequest)
    // @ts-expect-error using private method until we have shapes API
    const subManager = satellite.subscriptions
    const result = subManager.getDuplicatingSubscription([shape])

    // if sub not present, do nothing
    if (!result) return

    // if sub in progress, set loading state
    if (result.inFlight) setLoading(true)

    // sub is present so assume synced status (even if loading)
    setSynced(true)
  }, [shapeRequest, db.issue, satellite])

  const ActionIcon = synced ? BsCloudSlashFill : BsCloudArrowDownFill
  return (
    <button
      className="min-w-10 w-10 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer disabled:opacity-75 justify-center"
      disabled={loading}
      onClick={synced ? unsyncProject : syncProject}
    >
      {loading ? (
        <AiOutlineLoading3Quarters className="animate-spin" />
      ) : (
        <ActionIcon />
      )}
    </button>
  )
}

export default ProjectSyncToggle
