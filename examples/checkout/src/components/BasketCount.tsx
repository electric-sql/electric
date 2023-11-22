import { useElectric } from '../electric'
import { useLiveQuery } from 'electric-sql/react'
import { IonBadge } from '@ionic/react'

function BasketCount() {
  const { db } = useElectric()!

  // TODO: this should use a raw SQL query to count
  const { results: basket } = useLiveQuery(
    db.basket_items.liveMany({
      orderBy: {
        created_at: 'desc',
      },
      where: {
        // Only show items that are not in an order
        order_id: null,
      },
      include: {
        items: true,
      },
    })
  )

  const count = (basket ?? []).reduce((acc, item) => {
    return acc + item.quantity
  }, 0)

  return count > 0 ? <IonBadge>{count}</IonBadge> : null
}
export default BasketCount
