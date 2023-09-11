import React from 'react'
import './index.css'

import logo from "./logo.svg"
import { useState } from 'react'
import ReactDOM from "react-dom/client";

import ToolbarTabs from './tabs'

export function Index() {

    const [hidden, setHidden] = useState(true);

    function handleClick() {
        setHidden(!hidden);
    }

    if (hidden) {
        return <div className="Toolbar">
            <header className="Toolbar-header Toolbar-header-hidden">
                <img src={logo} className="Toolbar-logo" alt="logo"/>
                <span className="nav-text text-3xl">Electric Tools</span>
                <button onClick={handleClick}>
                    SHOW
                </button>
            </header>
        </div>
    } else {
        return <div className="Toolbar">
            <header className="Toolbar-header">
                <img src={logo} className="Toolbar-logo" alt="logo"/>
                <span className="nav-text">Electric Tools</span>
                <button onClick={handleClick}>
                    HIDE
                </button>
            </header>
            <ToolbarTabs/>
        </div>
    }
}


export default function AddToolbar() {
    console.log("AddToolbar")
    const toolbar_div = document.createElement("div");
    toolbar_div.setAttribute('id', 'electric-toolbar');
    document.body.appendChild(toolbar_div);
    const toolbar_root = ReactDOM.createRoot(document.getElementById("electric-toolbar") as HTMLElement)
    toolbar_root.render(<Index/>)
}

