import { memo, useContext } from 'react'
import { useElectric } from '../electric'

import { BsChevronDoubleRight } from 'react-icons/bs'

import Modal from './Modal'
import { useLiveQuery } from 'electric-sql/react'
import { ProfileContext } from '../App'
import Avatar from './Avatar'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

function ProfilePickerModal({ isOpen, onDismiss }: Props) {
  const { db } = useElectric()!

  const { userId: currentUserId, setUserId } = useContext(ProfileContext)!
  const { results: profiles } = useLiveQuery(
    db.profile.liveMany({
      orderBy: {
        username: 'asc',
      },
    })
  )

  const onProfileSelected = (id: string) => {
    setUserId(id)
    onDismiss?.()
  }

  const body = (
    <div className="flex flex-col w-full p-4 overflow-hidden">
      <div className="mb-2 ">
        <span className="text-lg font-semibold text-gray-600">
          Select a profile
        </span>
      </div>
      <div className="flex flex-col flex-1">
        {profiles?.map((profile) => {
          const isSelected = profile.id === currentUserId
          return (
            <button
              key={profile.id}
              data-active={isSelected}
              disabled={isSelected}
              onClick={() => onProfileSelected(profile.id)}
              className="group flex flex-row items-center justify-between p-2 rounded hover:bg-gray-100 data-[active=true]:bg-gray-100 data-[active=true]:border-2 border-gray-200"
            >
              <div className="flex flex-row">
                <Avatar
                  key={profile.id}
                  online={isSelected}
                  name={profile.username}
                />
                <span className="text-sm text-gray-500 ml-2">
                  {profile.username}
                </span>
              </div>
              <div className="text-gray-500">
                {isSelected ? (
                  <span>Current</span>
                ) : (
                  <div className="opacity-0 group-hover:opacity-100 flex flex-row items-center">
                    <span>Select</span>
                    <BsChevronDoubleRight className="ml-0.5" />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <Modal isOpen={isOpen} center={false} size="normal" onDismiss={onDismiss}>
      {body}
    </Modal>
  )
}

const ProfilePickerModalMemo = memo(ProfilePickerModal)
export default ProfilePickerModalMemo
