import { IonRouterLink } from '@ionic/react'
import './EmptyCart.css'

const EmptyCart: React.FC = () => {
  return (
    <div className="empty-cart">
      <strong>Your cart is empty.</strong>
      <p>
        Explore <IonRouterLink routerLink="/shop">the Store</IonRouterLink>
      </p>
    </div>
  )
}

export default EmptyCart
