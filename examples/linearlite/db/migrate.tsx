const createPool = require('@databases/pg');
const {sql} = require('@databases/pg');
const fs = require("fs");

const pg = {
  username: "postgres",
  password: "password",
  dbname: "electric",
  address: "localhost",
  port: 5432,
};

const db = createPool(
  `postgresql://${pg.username}:${pg.password}@${pg.address}:${pg.port}/${pg.dbname}`
);

db.query(sql.file("./db/migrations.sql"))
  .catch((ex) => {
    console.error(ex);
    process.exitCode = 1;
  })
  .then(() => db.dispose());
