import { createRouter } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'
import { Route as spaceRoute } from './routes/spaces.$wikiSpaceId'

const routeTree = rootRoute.addChildren({ indexRoute, spaceRoute })

export const router = createRouter({ routeTree })

// eslint-disable-next-line quotes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
