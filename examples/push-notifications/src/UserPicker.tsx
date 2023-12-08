import React, { useEffect, useState } from 'react'
import { useElectric } from './ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { Users } from './generated/client';

import './UserPicker.css';

export const UserPicker = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.users.liveMany({
    orderBy: { first_name: 'asc' }
  }))
  const users : Users[] = results || [];
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.users.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [])


  const [ selectedUserId, setSelectedUserId] = useState(users[0]?.user_id)
  useEffect(() => {
    if (selectedUserId === undefined) {
      setSelectedUserId(users[0]?.user_id)
    }
  }, [users])


  return (
    <ul className="tabContainer">
    {
      users.map((user: Users, idx) => (
        <li key={user.user_id} className="me-2">
          <a href="#" className={"userTab" + (user.user_id === selectedUserId ? " active": "")}
            onClick={() => setSelectedUserId(user.user_id)}>
            {
              [user.first_name, user.last_name]
                .filter((s) => s !== undefined)
                .join(' ')
            }
          </a>
        </li>
      ))
    }
  </ul>
  )
}
