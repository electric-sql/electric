import React, {useEffect, useState} from "react";

export default function ShapesTab(dbName: string): JSX.Element {

    const [_status, _setStatus] = useState("");

    useEffect(() => {
        console.log(dbName);

    }, [])

    return (
       <div>Shapes coming soon</div>
    );
}