import { ColumnDef } from "./TableView";

export const columns : ColumnDef[] = [
  {
    field: 'order_id',
    headerName: 'Order ID',
    type: 'text',
    width: 140,
  },
  {
    field: 'timestamp',
    headerName: 'Timestamp',
    type: 'date',
    format: (val) => (val as Date)?.toLocaleString(),
    width: 200,
  },
  {
    field: 'price_amount_cents',
    headerName: 'Price',
    type: 'number',
    format: (val) => isNaN(val) ? '' : ((val as number) / 100).toLocaleString(),
    width: 110
  },
  {
    field: 'price_currency',
    headerName: 'Currency',
    type: 'text',
    width: 80
  },
  {
    field: 'promo_code',
    headerName: 'Promo Code',
    type: 'text',
    width: 120
  },
  {
    field: 'customer_full_name',
    headerName: 'Customer',
    type: 'text',
    width: 150
  },
  {
    field: 'country',
    headerName: 'Country',
    type: 'text',
    width: 150
  },
  {
    field: 'city',
    headerName: 'City',
    type: 'text',
    width: 150
  },
];