import React from "react";
import {useEffect, useState} from "react";

export default function DDLXTab(dbName: string): JSX.Element {


    const [_status, _setStatus] = useState("");

    useEffect(() => {
        console.log(dbName);
    }, [])

    return (
       <div>DDLX coming soon</div>
    );
}