import { ColumnDef } from "./TableView";

export const columns : ColumnDef[] = [
  {
    field: 'order_id',
    headerName: 'Order ID',
    type: 'text',
    width: 300,
  },
  {
    field: 'timestamp',
    headerName: 'Timestamp',
    type: 'date',
    format: (val) => (val as Date)?.toLocaleString(),
    width: 200,
  },
  {
    field: 'price_amount',
    headerName: 'Price',
    type: 'number',
    width: 80
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
    width: 80
  },
  {
    field: 'customer_full_name',
    headerName: 'Customer',
    type: 'text',
    width: 180
  },
  {
    field: 'country',
    headerName: 'Country',
    type: 'text',
    width: 150
  },
  {
    field: 'product',
    headerName: 'Product',
    type: 'text',
    width: 80
  },
];