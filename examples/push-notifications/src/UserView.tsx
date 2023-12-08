import { useToast } from "./toast/ToastProvider"


export const UserView = ({ userId } : { userId: string }) => {

  const { showToast } = useToast();
  const showToastFn = () => showToast({ message: 'hello + ' + Math.random().toString().slice(0, 3) })

  return (
    <div>
      <button onClick={showToastFn}>show toast</button>
    </div>
  )

}