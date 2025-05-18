import { createFileRoute } from '@tanstack/react-router'
import ScreenWithHeader from '../components/ScreenWithHeader'
import { Flex } from '@radix-ui/themes'

export const Route = createFileRoute(`/`)({
  component: Index,
})

function Index() {
  return (
    <ScreenWithHeader title="Home">
      <Flex
        direction="column"
        align="center"
        justify="center"
        height="100%"
        width="100%"
      >
        <h3>Welcome Home!</h3>
      </Flex>
    </ScreenWithHeader>
  )
}
