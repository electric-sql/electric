import { memo, useContext } from 'react'
import { useElectric } from '../electric'

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
    <div className="flex flex-col w-full py-4 overflow-hidden">
      <div className="flex flex-row flex-1 pb-3.5 overflow-x-auto">
        {profiles?.map((profile) => (
          <Avatar
            key={profile.id}
            online={profile.id === currentUserId}
            onClick={() => onProfileSelected(profile.id)}
            name={profile.username}
          />
        ))}
      </div>
    </div>
  )

  return (
    <Modal isOpen={isOpen} center={false} size="large" onDismiss={onDismiss}>
      {body}
    </Modal>
  )
}

const ProfilePickerModalMemo = memo(ProfilePickerModal)
export default ProfilePickerModalMemo
