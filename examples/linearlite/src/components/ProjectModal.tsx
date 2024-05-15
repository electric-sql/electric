import { memo, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useElectric } from '../electric'
import { showInfo, showWarning } from '../utils/notification'
import { generateKeyBetween } from 'fractional-indexing'

import { BsChevronRight as ChevronRight } from 'react-icons/bs'
import CloseIcon from '../assets/icons/close.svg?react'
import ElectricIcon from '../assets/images/icon.inverse.svg?react'

import Modal from './Modal'
import Editor from './editor/Editor'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

function ProjectModal({ isOpen, onDismiss }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState<string>()
  const { db } = useElectric()!

  const handleSubmit = async () => {
    if (title === '') {
      showWarning('Please enter a title before submitting', 'Title required')
      return
    }

    const lastProject = await db.project.findFirst({
      orderBy: {
        kanbanorder: 'desc',
      },
    })

    const kanbanorder = generateKeyBetween(lastProject?.kanbanorder, null)

    const date = new Date()
    db.project.create({
      data: {
        id: uuidv4(),
        name: title,
        description: description ?? '',
        created: date,
        modified: date,
        kanbanorder: kanbanorder,
      },
    })

    if (onDismiss) onDismiss()
    reset()
    showInfo('You created new project.', 'Project created')
  }

  const handleClickCloseBtn = () => {
    if (onDismiss) onDismiss()
    reset()
  }

  const reset = () => {
    setTimeout(() => {
      setTitle('')
      setDescription('')
    }, 250)
  }

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        ref.current?.focus()
      }, 250)
    }
  }, [isOpen])

  const body = (
    <div className="flex flex-col w-full py-4 overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between flex-shrink-0 px-4">
        <div className="flex items-center">
          <span className="inline-flex items-center p-1 px-2 text-gray-400 bg-gray-100 rounded">
            <ElectricIcon className="w-3 h-3 scale-150 mr-1" />
            <span>electric</span>
          </span>
          <ChevronRight className="ml-1" />
          <span className="ml-1 font-normal text-gray-700">New Project</span>
        </div>
        <div className="flex items-center">
          <button
            className="inline-flex rounded items-center justify-center ml-2 text-gray-500 h-7 w-7 hover:bg-gray-100 rouned hover:text-gray-700"
            onClick={handleClickCloseBtn}
          >
            <CloseIcon className="w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col flex-1 pb-3.5 overflow-y-auto">
        {/* Project title */}
        <div className="flex items-center w-full mt-1.5 px-4">
          <input
            className="w-full p-1 text-lg font-semibold placeholder-gray-400 border-none h-7 focus:border-none focus:outline-none focus:ring-0"
            placeholder="Project title"
            value={title}
            ref={ref}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Project description editor */}
        <div className="w-full px-4">
          <Editor
            className="prose w-full max-w-full mt-2 font-normal appearance-none min-h-12 p-1 text-md editor border border-transparent focus:outline-none focus:ring-0"
            value={description || ''}
            onChange={(val) => setDescription(val)}
            placeholder="Add description..."
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center flex-shrink-0 px-4 pt-3">
        <button
          className="px-3 ml-auto text-white bg-indigo-600 rounded hover:bg-indigo-700 h-7"
          onClick={handleSubmit}
        >
          Create Project
        </button>
      </div>
    </div>
  )

  return (
    <Modal isOpen={isOpen} center={false} size="large" onDismiss={onDismiss}>
      {body}
    </Modal>
  )
}

const ProjectModalMemo = memo(ProjectModal)
export default ProjectModalMemo
