import Modal from './Modal'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function AboutModal({ isOpen, onDismiss }: Props) {
  return (
    <Modal title="About" isOpen={isOpen} onDismiss={onDismiss}>
      <div className="flex flex-col w-full px-8 py-5 overflow-y-auto">
        TODO: add content
      </div>
    </Modal>
  )
}
