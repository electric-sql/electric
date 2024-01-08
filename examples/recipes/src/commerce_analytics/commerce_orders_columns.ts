import { ColumnDef } from "./TableView";

export const columns : ColumnDef[] = [
  {
    field: 'order_id',
    headerName: 'Order ID',
    width: 140,
  },
  {
    field: 'timestamp',
    headerName: 'Timestamp',
    format: (val) => (val as Date)?.toLocaleString(),
    width: 200,
  },
  {
    field: 'price_amount_cents',
    headerName: 'Price',
    format: (val) => isNaN(val) ? '' : ((val as number) / 100).toLocaleString(),
    width: 110
  },
  {
    field: 'price_currency',
    headerName: 'Currency',
    width: 80
  },
  {
    field: 'promo_code',
    headerName: 'Promo Code',
    width: 120
  },
  {
    field: 'customer_full_name',
    headerName: 'Customer',
    width: 150
  },
  {
    field: 'country',
    headerName: 'Country',
    width: 150
  },
  {
    field: 'city',
    headerName: 'City',
    width: 150
  },
];