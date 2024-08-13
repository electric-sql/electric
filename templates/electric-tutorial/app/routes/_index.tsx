import { Heading, Flex, DataList, Separator } from "@radix-ui/themes"
import { useShape, preloadShape } from "@electric-sql/react"

const workersShape = {
  url: `http://localhost:5174/shape-proxy/workers`,
}

export async function clientLoader() {
  return preloadShape(workersShape)
}

export default function Index() {
  const { data: workers } = useShape(workersShape)

  console.log({ workers })
  return (
    <Flex direction="column">
      <Heading>Workers</Heading>
      <DataList.Root>
        {workers.map((worker) => {
          return (
            <>
              {Object.keys(worker).map((key) => {
                return (
                  <DataList.Item align="center">
                    <DataList.Label minWidth="88px">{key}</DataList.Label>
                    <DataList.Value>{worker[key]?.toString()}</DataList.Value>
                  </DataList.Item>
                )
              })}
              <Separator size="4" />
            </>
          )
        })}
      </DataList.Root>
    </Flex>
  )
}
