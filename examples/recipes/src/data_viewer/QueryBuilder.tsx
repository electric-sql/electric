import { QueryBuilder as ReactQueryBuilder, RuleGroupType, formatQuery } from 'react-querybuilder';
import { QueryBuilderMaterial } from '@react-querybuilder/material';
import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "./TableView";
import 'react-querybuilder/dist/query-builder.css';
import { Box, Divider, Typography } from '@mui/material';


export const QueryBuilder = ({
  columns,
  onQueryChanged,
} : {
  columns: ColumnDef[],
  onQueryChanged: (whereClause: string) => void
}) => {
  const [ query, setQuery ] = useState<RuleGroupType>( { combinator: 'and', rules: [] })
  const fields = useMemo(() => columns.map((col) => ({
    name: col.field,
    label: col.headerName,
    inputType: col.type
  })), [columns])

  useEffect(() => {
    onQueryChanged(formatQuery(query, 'sql'))
  }, [ query ])
  
  return (
    <Box>
      <Typography variant="h5">
        Filter
      </Typography>
      <Divider sx={{ my: 1 }} />
      <QueryBuilderMaterial>
        <ReactQueryBuilder
          fields={fields}
          query={query}
          controlClassnames={{ queryBuilder: 'queryBuilder-branches' }}
          onQueryChange={(q) => setQuery(q)} />
      </QueryBuilderMaterial>
    </Box>
  )
}