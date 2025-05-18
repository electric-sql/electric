import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Flex } from '@radix-ui/themes'
import { Providers } from '../components/Providers'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../hooks/useAuth'
import WelcomeScreen from '../components/WelcomeScreen'

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  const { isLoggedIn } = useAuth()

  return (
    <>
      <Providers defaultTheme="light">
        <Flex height="100vh" width="100vw" overflow="hidden">
          {isLoggedIn ? (
            <>
              <Sidebar />
              <Flex direction="column" className="content-area" width="100%">
                <Outlet />
              </Flex>
            </>
          ) : (
            <Flex direction="column" className="content-area" width="100%">
              <WelcomeScreen />
            </Flex>
          )}
        </Flex>
      </Providers>
      <TanStackRouterDevtools position="bottom-right" />
    </>
  )
}
