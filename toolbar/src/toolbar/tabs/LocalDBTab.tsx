import React, {useEffect, useState} from "react";
import { getApi } from "../client/api";



export default function LocalDBTab(dbName: string): JSX.Element {

    const [status, setStatus] = useState("");

    useEffect(() => {
        if (dbName !== undefined) {
            setStatus(getApi().getSatelliteStatus(dbName));
        }
    }, [])


    return (
        <div>
            <h3>IndexDB: { dbName }</h3>
            <ul>
                <li>status: { status }</li>
            </ul>
            <button onClick={() => getApi().resetDB(dbName)}>
               RESET LOCAL DB
            </button>
        </div>

    );
}