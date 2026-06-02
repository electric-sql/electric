import { createRouter } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'

const routeTree = rootRoute.addChildren([indexRoute as any])

export const router = createRouter({ routeTree })
