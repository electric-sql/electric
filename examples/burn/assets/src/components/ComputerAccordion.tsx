import { useState } from 'react'
import { Flex } from '@radix-ui/themes'

import AccordionSection from './ComputerAccordion/AccordionSection'
import EventsList from './ComputerAccordion/EventsList'
import FactsList from './ComputerAccordion/FactsList'
import FilterInput from './ComputerAccordion/FilterInput'

type Props = {
  threadId: string
}

function ComputerAccordion({ threadId }: Props) {
  const [openSections, setOpenSections] = useState({
    memory: true,
    context: true,
    agents: false,
  })

  const [factsFilter, setFactsFilter] = useState('')
  const [eventsFilter, setEventsFilter] = useState('')

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  return (
    <Flex direction="column" width="100%">
      <AccordionSection
        title="Memory"
        isOpen={openSections.memory}
        isDisabled={false}
        onToggle={() => toggleSection('memory')}
      >
        <>
          <FilterInput
            value={factsFilter}
            placeholder="Filter facts..."
            onChange={setFactsFilter}
          />
          <FactsList threadId={threadId} filter={factsFilter} />
        </>
      </AccordionSection>
      <AccordionSection
        title="Context"
        isOpen={openSections.context}
        isDisabled={false}
        onToggle={() => toggleSection('context')}
      >
        <>
          <FilterInput
            value={eventsFilter}
            placeholder="Filter events..."
            onChange={setEventsFilter}
          />
          <EventsList threadId={threadId} filter={eventsFilter} />
        </>
      </AccordionSection>
      <AccordionSection
        title="Processes"
        isOpen={openSections.agents}
        isDisabled={true}
        onToggle={() => toggleSection('agents')}
      />
    </Flex>
  )
}

export default ComputerAccordion
