import { useState, useEffect, useCallback } from 'react'
import { useElectric } from '../electric'

import { BsCloudArrowDownFill, BsCloudSlashFill } from 'react-icons/bs'
import { AiOutlineLoading3Quarters } from 'react-icons/ai'

interface Props {
  projectId: string
}

function ProjectSyncToggle({ projectId }: Props) {
  const { db, sync } = useElectric()!
  const [loading, setLoading] = useState(false)
  const [synced, setSynced] = useState(false)

  const syncProject = useCallback(async () => {
    setLoading(true)
    try {
      const synced = await db.issue.sync({
        where: {
          project_id: projectId,
        },
        include: {
          comment: true,
          project: true,
        },
        key: projectId,
      })
      await synced.synced
      setSynced(true)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [projectId, db.issue])

  const unsyncProject = useCallback(async () => {
    setLoading(true)
    try {
      await sync.unsubscribe([projectId])
      setSynced(false)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [projectId, sync])

  useEffect(() => {
    const status = sync.syncStatus(projectId)

    // if sub not present, do nothing
    if (!status) return

    // if sub in progress, set loading state
    if (status.status !== 'active') setLoading(true)

    // set sync status based on whether sub is being
    // established or cancelled
    setSynced(status.status === 'establishing')
  }, [sync, projectId])

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
