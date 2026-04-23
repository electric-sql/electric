import { Theme } from '@radix-ui/themes'
import { RouterProvider } from '@tanstack/react-router'
import {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
import { PinnedEntitiesProvider } from './hooks/usePinnedEntities'
import { ElectricAgentsProvider } from './lib/ElectricAgentsProvider'
import { ThemeSwitcher, useTheme } from './components/ThemeSwitcher'
import { router } from './router'

function AppInner(): React.ReactElement {
  const { activeServer } = useServerConnection()

  return (
    <ElectricAgentsProvider baseUrl={activeServer?.url ?? null}>
      <PinnedEntitiesProvider>
        <RouterProvider router={router} />
      </PinnedEntitiesProvider>
    </ElectricAgentsProvider>
  )
}

export function App(): React.ReactElement {
  const { themeId, theme, setThemeId } = useTheme()

  return (
    <Theme
      accentColor={theme.accentColor}
      grayColor={theme.grayColor}
      radius={theme.radius}
    >
      <ServerConnectionProvider>
        <AppInner />
        <ThemeSwitcher themeId={themeId} onSwitch={setThemeId} />
      </ServerConnectionProvider>
    </Theme>
  )
}
