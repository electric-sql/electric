import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { useEffect } from "react"
import { projectCollection, todoCollection } from "@/lib/collections"

export const Route = createFileRoute(`/_authenticated/`)({
  component: IndexRedirect,
  ssr: false,
  loader: async () => {
    console.log(1)
    await projectCollection.preload()
    await todoCollection.preload()
    console.log(2)
    return null
  },
})

function IndexRedirect() {
  const navigate = useNavigate()
  const { data: projects } = useLiveQuery((q) => q.from({ projectCollection }))

  useEffect(() => {
    if (projects && projects.length > 0) {
      const firstProject = projects[0]
      navigate({
        to: "/project/$projectId",
        params: { projectId: firstProject.id.toString() },
        replace: true,
      })
    }
  }, [projects, navigate])

  return (
    <div className="p-6">
      <div className="text-center">
        <p className="text-gray-500">Loading projects...</p>
      </div>
    </div>
  )
}
