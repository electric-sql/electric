import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { useEffect } from "react"
import { projectCollection, todoCollection } from "@/lib/collections"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute(`/_authenticated/`)({
  component: IndexRedirect,
  ssr: false,
  beforeLoad: async () => {
    const res = await authClient.getSession()
    if (!res.data?.session) {
      throw redirect({
        to: `/login`,
        search: {
          // Use the current location to power a redirect after login
          // (Do not use `router.state.resolvedLocation` as it can
          // potentially lag behind the actual current location)
          redirect: location.href,
        },
      })
    }
  },
  loader: async () => {
    await projectCollection.preload()
    await todoCollection.preload()

    return null
  },
})

function IndexRedirect() {
  const navigate = useNavigate()
  const { data: projects } = useLiveQuery((q) => q.from({ projectCollection }))

  useEffect(() => {
    if (projects.length > 0) {
      const firstProject = projects[0]
      navigate({
        to: `/project/$projectId`,
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
