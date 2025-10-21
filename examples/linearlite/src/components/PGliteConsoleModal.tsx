import { Repl } from "@electric-sql/pglite-repl"
import Modal from "./Modal"
import { usePGlite } from "@electric-sql/pglite-react"

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function PGliteConsoleModal({ isOpen, onDismiss }: Props) {
  const pg = usePGlite()

  return (
    <Modal
      title="PGlite Console"
      isOpen={isOpen}
      onDismiss={onDismiss}
      size="large"
    >
      <div className="flex flex-col w-full h-100">
        <Repl pg={pg} showTime={true} />
      </div>
    </Modal>
  )
}
