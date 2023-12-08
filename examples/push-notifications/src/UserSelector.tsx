import { useLiveQuery } from "electric-sql/react";
import { useElectric } from "./ElectricWrapper";
import { useToast } from "./toast/ToastProvider"
import { Users } from "./generated/client";
import { useEffect, useMemo, useState } from "react";
import { TabPicker } from "./TabPicker";
import { UserView } from "./UserView";


export const UserSelector = () => {
  const { db } = useElectric()!
  const { results: users = [] } = useLiveQuery<Users[]>(db.users.liveMany({
    orderBy: { first_name: 'asc' }
  }))

  const [ selectedUserId, setSelectedUserId] = useState(users[0]?.user_id)
  const { results: undeliveredNotifications = [] } = useLiveQuery(db.notifications.liveMany({
    where: {
      target_id: selectedUserId,
      delivered_at: null
    }
  }));


  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      db.users.sync()
      const shapes = await Promise.all([
        db.users.sync(),
        db.notifications.sync({ include: {
          notification_templates: true,
          users: true,
        }})
      ]);
      

      // Resolves when the data has been synced into the local database.
      await Promise.all(shapes.map((s) => s.synced));


    }

    syncItems()
  }, [])

  useEffect(() => {
    if (selectedUserId === undefined) {
      setSelectedUserId(users[0]?.user_id)
      return;
    }
    
    db.notifications.findMany({
      where: {
        target_id: selectedUserId,
        delivered_at: null
      }
    })
  }, [users])

  useEffect(() => {
    if (selectedUserId == null) return;
    db.notifications.updateMany({
      data: {
        delivered_at: Date.now(),
      },
      where: {
        delivered_at: null,
        target_id: selectedUserId,
      }
    })
  }, [undeliveredNotifications])


  const selectedUser = useMemo(
    () => users.find((user) => user.user_id == selectedUserId),
    [selectedUserId]
  );



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
      {
        selectedUser !== undefined ?
          <UserView user={selectedUser} />
          : null
      }
    </div>
  )

}