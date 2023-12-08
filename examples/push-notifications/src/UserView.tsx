import { useLiveQuery } from "electric-sql/react";
import { useElectric } from "./ElectricWrapper";
import { useToast } from "./toast/ToastProvider"
import { useCallback, useEffect } from "react";
import { genUUID } from "electric-sql/util";
import { NotificationTemplates, Notifications, Users } from "./generated/client";
import { templateString } from "./template_utils";


export const UserView = ({ user } : { user: Users }) => {
  const { showToast } = useToast();
  const { db } = useElectric()!;
  const { results: notification } = useLiveQuery(db.notifications.liveFirst({
    where: {
      target_id: user.user_id,
      read_at: null,
    },
    orderBy: {
      created_at: 'asc'
    },
    include: {
      notification_templates: true,
      users: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true
        }
      }
    }
  }))

  const { results: otherUsers = [] } = useLiveQuery<Users[]>(db.users.liveMany({
    where: {
      user_id: {
        not: user.user_id
      },
    },
    orderBy: {
      first_name: 'asc'
    },
    select: {
      first_name: true,
      last_name: true
    }
  }))

  
  const sayHi = useCallback(async (targetUserId: string) => {
    const template : NotificationTemplates = await db.notification_templates.findFirst({
      where: {
        type: 'hello'
      }
    });
    db.notifications.create({
      data: {
        notification_id: genUUID(),
        template_id: template.template_id,
        source_id: user.user_id,
        target_id: targetUserId,
        created_at: Date.now(),
      }
    })
  }, [user.user_id]);

  useEffect(() => {
    if (!notification) return;
    const template = notification.notification_templates as NotificationTemplates;
    const sendingUser = notification.users as Users;
    const notificationData = notification as Notifications;

    const timer = setTimeout(async () => {
      await db.notifications.update({
        data: {
          read_at: Date.now()
        },
        where: {
          notification_id: notificationData.notification_id
        }
      })

      showToast({
        title: template.title ?? undefined,
        message: templateString(template.message, {
          first_name: sendingUser.first_name,
          last_name: sendingUser.last_name
        }),
        action: template.action != null ? {
          cta: template.action,
          actionFn: () => sayHi(notification.source_id),
        } : undefined,
      })
    }, 100)
    return () => clearTimeout(timer);
  }, [notification?.notification_id])


  return (
    <div className="flex flex-col my-8">
      {
        otherUsers.map((user) => (
          <button
            key={user.user_id}
            onClick={() => sayHi(user.user_id)}>Say hi to {user.first_name}!
          </button>
        ))
      }
    </div>
  )

}