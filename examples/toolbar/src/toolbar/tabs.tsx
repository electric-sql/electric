
import React, { useState } from "react";

import LocalDBTab from "./tabs/LocalDBTab"
// import SQLTab from "./tabs/SQLTab"
import DDLXTab from "./tabs/DDLXTab"
import ShapesTab from "./tabs/ShapesTab"
import XTermTab from "./tabs/XTermTab";

let tabs = {};

function TabItem(label, name, element, handleClick, active): JSX.Element {
    let click = (e) => {
        handleClick(e, name)
    };
    tabs[name] = element;

    if (active == name){
        return (<li className="Toolbar-tab-item Toolbar-tab-item-active" onClick={click}>{label}</li>);
    } else {
        return (<li className="Toolbar-tab-item" onClick={click}>{label}</li>);
    }
}

export default function ToolbarTabs(): JSX.Element {
    const [active, setActive] = useState("db");
    function handleClick(_, name) {
        setActive(name);
    }
    return (
        <div className="Toolbar-tabs">
            <ul className="Toolbar-tab-items">
                {TabItem("Local DB", "db", LocalDBTab, handleClick, active)}
                {TabItem("SQL", "sql", XTermTab, handleClick, active)}
                {TabItem("Shapes", "shapes", ShapesTab, handleClick, active)}
                {TabItem("DDLX", "ddlx", DDLXTab, handleClick, active)}
            </ul>
            <div className="Toolbar-tab-content">
                {tabs[active]()}
            </div>
        </div>
    );
}


