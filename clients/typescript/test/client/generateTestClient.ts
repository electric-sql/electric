import { fileURLToPath } from 'url'
import { generateClient } from '../../src/cli/migrations/migrate'
import fs from 'fs'
import path from 'path'

const prismaSchema = `
datasource db {
  provider = "postgresql"
  url      = env("PRISMA_DB_URL")
}

model Items {
  value String @id
  nbr   Int?
}

model User {
  id      Int      @id
  name    String?
  meta    String?
  posts   Post[]
  profile Profile?
}

model Post {
  id        Int    @id
  title     String @unique
  contents  String
  nbr       Int?
  authorId  Int
  author    User?  @relation(fields: [authorId], references: [id])
}

model Profile {
  id     Int    @id
  bio    String
  meta   Json?
  userId Int    @unique
  user   User?  @relation(fields: [userId], references: [id])
}

model DataTypes {
  id          Int       @id
  date        DateTime? @db.Date
  time        DateTime? @db.Time(3)
  timetz      DateTime? @db.Timetz(3)
  timestamp   DateTime? @unique @db.Timestamp(3)
  timestamptz DateTime? @db.Timestamptz(3)
  bool        Boolean?
  uuid        String?   @db.Uuid
  int2        Int?      @db.SmallInt
  int4        Int?
  int8        BigInt?
  float4      Float?    @db.Real
  float8      Float?    @db.DoublePrecision
  json        Json?
  bytea       Bytes?
  relatedId   Int?
  related     Dummy?    @relation(fields: [relatedId], references: [id])
}

model Dummy {
  id          Int        @id
  timestamp   DateTime?  @db.Timestamp(3)
  datatype    DataTypes[]
}
`

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const prismaSchemaDir = path.join(thisDir, 'prisma')
const prismaSchemaPath = path.join(prismaSchemaDir, 'schema.prisma')
const generatedClientDir = path.join(thisDir, 'generated')
const generatedClientPath = path.join(generatedClientDir, 'index.ts')
const migrationsPath = path.join(generatedClientDir, 'migrations.ts')

// remove the current generated client if present
fs.rmSync(generatedClientDir, { recursive: true, force: true })

// create the prisma schema file
if (!fs.existsSync(prismaSchemaDir)) {
  fs.mkdirSync(prismaSchemaDir)
}
fs.writeFileSync(prismaSchemaPath, prismaSchema)

// enhance schema and generate client along with mock migrations
await generateClient(prismaSchemaPath, generatedClientDir)
fs.writeFileSync(migrationsPath, 'export default []')

// fix the generated client import path to point to local schema
const clientStr = fs.readFileSync(generatedClientPath).toString()
const fixedClientStr = clientStr.replace(
  'electric-sql/client/model',
  '../../../src/client/model'
)
fs.writeFileSync(generatedClientPath, fixedClientStr)

// remove prisma schema file
fs.rmSync(prismaSchemaDir, { recursive: true, force: true })
