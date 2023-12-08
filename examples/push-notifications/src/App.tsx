import logo from './logo.svg'
import './App.css'
import './style.css'

import { ElectricWrapper } from './ElectricWrapper'
import { Toast } from './toast/Toast'
import { ToastProvider } from './toast/ToastProvider'
import { UserView } from './UserView'
import { UserSelector } from './UserSelector'

export default function App() {

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo.toString()} className="App-logo" alt="logo" />
        <ElectricWrapper>
          <ToastProvider>
            <UserSelector />
          </ToastProvider>
        </ElectricWrapper>
      </header>
    </div>
  );
}
