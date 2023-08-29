import React, { useState } from 'react'

import '../styles.css'
import logo from '../images/logo.svg'
import qrCodeIcon from '../images/qr-code-icon.svg'
import closeIcon from '../images/close-icon.svg'

import MainPage from './MainPage'
import QRModal from './QRModal'

const Layout = () => {
  const [ showModal, setShowModal ] = useState<boolean>(false)

  const hideModal = () => setShowModal(false)
  const toggleModal = () => setShowModal(!showModal)

  const page = showModal
    ? <QRModal />
    : <MainPage />

  return (
    <div className="app">
      <header className="nav-bar">
        <a className="qr-link" onClick={ toggleModal }>
          {!showModal
            ? <img src={qrCodeIcon} className="qr-link-icon"/>
            : <img src={closeIcon} className="qr-link-icon close" />
          }
        </a>
        <a onClick={ hideModal }>
          <img src={ logo } className="logo" alt="logo" />
        </a>
      </header>
      { page }
    </div>
  );
}

export default Layout
