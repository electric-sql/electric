import { createRouter } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'

const routeTree = rootRoute.addChildren({ indexRoute })

export const router = createRouter({ routeTree })

// eslint-disable-next-line quotes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
