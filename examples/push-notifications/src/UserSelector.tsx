import { useLiveQuery } from "electric-sql/react";
import { useElectric } from "./ElectricWrapper";
import { useToast } from "./toast/ToastProvider"
import { Users } from "./generated/client";
import { useEffect, useState } from "react";
import { TabPicker } from "./TabPicker";
import { UserView } from "./UserView";


export const UserSelector = () => {
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
    <div>
      <TabPicker 
        items={users.map((user) => ({
          key: user.user_id,
          value: [user.first_name, user.last_name]
            .filter((v) => v !== null)
            .join(' ')
        }))}
        selected={selectedUserId}
        onSelected={(key) => setSelectedUserId(key as string)}
        />
      <UserView userId={selectedUserId} />
    </div>
  )

}