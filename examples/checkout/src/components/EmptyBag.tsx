import { IonRouterLink } from '@ionic/react'
import './EmptyBag.css'

const EmptyBag: React.FC = () => {
  return (
    <div className="empty-bag">
      <strong>Your bag is empty.</strong>
      <p>
        Explore <IonRouterLink routerLink="/shop">the Store</IonRouterLink>
      </p>
    </div>
  )
}

export default EmptyBag
