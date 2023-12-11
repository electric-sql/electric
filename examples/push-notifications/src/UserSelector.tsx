import { useLiveQuery } from "electric-sql/react";
import { useElectric } from "./ElectricWrapper";
import { Users } from "./generated/client";
import { useEffect, useMemo, useState } from "react";
import { TabPicker } from "./TabPicker";
import { UserView } from "./UserView";


export const UserSelector = () => {
  const { db } = useElectric()!
  
  // keep track of users in the system
  const { results: users = [] } = useLiveQuery<Users[]>(db.users.liveMany({
    orderBy: { first_name: 'asc' }
  }))

  // selected user will act as the "logged in" user for this demo
  const [ selectedUserId, setSelectedUserId] = useState(users[0]?.user_id)
  const selectedUser = useMemo(
    () => users.find((user) => user.user_id == selectedUserId),
    [selectedUserId]
  );

  const { results: undeliveredNotifications = [] } = useLiveQuery(db.notifications.liveMany({
    where: {
      target_id: selectedUserId,
      delivered_at: null
    }
  }));

  // sync all relevant tables
  useEffect(() => {
    const syncItems = async () => {
      const shapes = await Promise.all([
        db.users.sync(),
        db.notifications.sync({ include: {
          notification_templates: true,
          users: true,
        }})
      ]);
      await Promise.all(shapes.map((s) => s.synced));
    }
    syncItems()
  }, [])

  // make sure a user is always selected
  useEffect(() => {
    if (selectedUserId === undefined) {
      setSelectedUserId(users[0]?.user_id)
      return;
    }
  }, [users, selectedUserId])

  // mark any notifications meant for the selected user
  // as delivered - not read!
  useEffect(() => {
    if (selectedUserId == null) return;
    db.notifications.updateMany({
      where: {
        target_id: selectedUserId,
        delivered_at: null,
      },
      data: {
        delivered_at: Date.now(),
      },
    })
  }, [undeliveredNotifications, selectedUserId])


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