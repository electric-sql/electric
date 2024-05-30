import { useState, useEffect, useCallback } from 'react'
import { useElectric } from '../electric'

import { BsCheck } from 'react-icons/bs'
import { AiOutlineLoading3Quarters } from 'react-icons/ai'
import { Checkbox } from '@headlessui/react'

interface Props {
  title: string
  projectId: string
}
function ProjectItem({ title, projectId }: Props) {
  const { db, sync } = useElectric()!
  const [loading, setLoading] = useState(false)
  const [synced, setSynced] = useState(false)

  const syncProject = useCallback(async () => {
    setLoading(true)
    try {
      const { synced } = await db.project.sync({
        include: {
          issue: {
            where: { project_id: projectId },
            include: {
              comment: true,
              project: true,
              profile: true,
            },
          },
        },
        key: projectId,
      })
      await synced
      setSynced(true)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [projectId, db.project])

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

    switch (status.status) {
      case 'cancelling':
        unsyncProject()
        break
      case 'establishing':
        syncProject()
        break
      case 'active':
        setSynced(true)
        break
    }
  }, [sync, syncProject, unsyncProject, projectId])

  return (
    <button
      disabled={loading}
      className="flex flex-row w-full text-sm items-center px-2 relative w-full mt-0.5 h-7 rounded hover:bg-gray-100 cursor-pointer disabled:cursor-default truncate"
      onClick={synced ? unsyncProject : syncProject}
    >
      <Checkbox
        checked={synced}
        disabled={loading}
        className="group block size-4 rounded border bg-white flex items-center justify-center"
      >
        {loading ? (
          <AiOutlineLoading3Quarters className="w-1/2 animate-spin" />
        ) : (
          <BsCheck className="stroke-white opacity-0 group-data-[checked]:opacity-100" />
        )}
      </Checkbox>
      <div className="ml-2 truncate">{title}</div>
    </button>
  )
}

export default ProjectItem
