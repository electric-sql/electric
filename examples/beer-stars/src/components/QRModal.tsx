import React from 'react'
import qrCode from '../images/qr-code.png'

const QRModal = () => (
  <div className="qr-modal">
    <div className="qr-modal-url">
      <a href="https://github.com/electric-sql/electric">
        github.com/electric-sql/electric
      </a>
    </div>
    <img src={qrCode} />
  </div>
)

export default QRModal
