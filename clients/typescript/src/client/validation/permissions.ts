/*
 * This file implements the algorithm for validating writes
 * based on the user's roles and the permissions that were granted to roles.
 * The algorithm is defined here: https://electric-sql.slab.com/posts/specification-for-validation-of-writes-2qfuh3d8
 */

import { Row, SqlValue } from "../../util"
import isEqual from 'lodash.isequal'

type Relation = { schema: string, table: string }
type Privilege = 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT'
type WritePrivilege = Omit<Privilege, 'SELECT'>

// Grants give permissions to global roles and scoped roles
type GlobalRole = {
  role: string
}

type ScopedRole = GlobalRole & {
  scope: Relation // table of the scope
}

/**
 * Assignments give roles to users.
 * These roles can be global or scoped.
 * In case of scoped roles, the assignment also contains the rootPK of the scope.
 * 
 * When validating a write, we can compute the `AssignedRole`s that allow the write.
 * For example:
 *   `ELECTRIC GRANT WRITE ON issues TO 'projects:editor'`
 *   The above grant is scoped to the projects table such
 *   that users can only insert issues into projects
 *   for which they are an editor.
 * 
 *   Now assume the following query:
 *   `INSERT INTO issues (project_id, text) VALUES (1, 'foo')`
 *   For this insertion, the role 'projects:editor' is scoped to
 *   the row with project_id = 1 in the projects table.
 *   We can find this by following the path from the change
 *   to the role's scope, which can require several hops.
 *   Thus, any user that has the role 'projects:editor' on project 1 is allowed to execute this insertion.
 */
type AssignedRole = ScopedRole & {
  rootPK: SqlValue // PK of the root of the scope in that table
}

//type GrantedRole = GlobalRole | ScopedRole
type UserRole = GlobalRole | AssignedRole
type Role = GlobalRole | ScopedRole | AssignedRole

// TODO: define `Auth` type
type Auth = {}

type Grant = {
  relation: Relation // the table on which to grant
  privilege: Privilege
  columns: Array<string> // only for updates, otherwise the empty array
  check: (oldRow: Row | undefined, newRow: Row | undefined, auth: Auth) => boolean // defaults to (_, _, _) => true
  path: Array<string> // path from `table` to `role.scope`, empty array if role is global
  role: Role
}

type GrantWithScopedRole = Omit<Grant, 'role'> & {
  role: ScopedRole
}

type GrantWithAssignedRole = Omit<Grant, 'role'> & {
  role: AssignedRole
}

type Change = {
  relation: Relation
  type: WritePrivilege
  record?: Row
  oldRecord?: Row
  modifiedColumns: Array<string> // only for updates, otherwise the empty set
}

type User = {
  roles: Array<UserRole>
  // additional authentication information about the user
  // which can be used in the `check` function of a grant
  auth: Auth
}

export async function validateChange(change: Change, user: User): Promise<boolean> {
  if (change.type === 'UPDATE' && change.modifiedColumns.length > 1) {
    // for each column update find a role that permits it
    return change.modifiedColumns.every(updatedColumn =>
      validateCore({
        ...change,
        modifiedColumns: [updatedColumn]
      }, user)  
    )
  }
  return validateCore(change, user)
}

async function validateCore(change: Change, user: User): Promise<boolean> {
  const grants = getGrants(change.relation, change.type)
  const unscopedGrants = grants.filter(isGlobalScope)
  const scopedGrants = grants.filter(isScopedRole) as GrantWithScopedRole[]
  const assignedGrants = await Promise.all(scopedGrants.map(grant => concretiseGrant(grant, change)))
  // Roles that are allowed to perform the change
  const allowedRoles = [...unscopedGrants, ...assignedGrants]
    .filter(grant => isAllowed(grant, change, user.auth))
    .map(grant => grant.role)
  // User must have at least 1 acceptable role
  return user.roles.some(role => allowedRoles.some(allowedRole => {
    return isEqual(role, allowedRole) // deep equality
  }))
}

function isAllowed(grant: Grant, change: Change, auth: Auth): boolean {
  // check privilege
  if (grant.privilege !== change.type) return false
  // If it is an update, it must have been split into single column updates
  if (grant.privilege === 'UPDATE' && change.modifiedColumns.length > 1) {
    throw new Error('Expected update change to contain a single modified column.')
  }
  // in case of update, the grant must have permission to update that column
  if (grant.privilege === 'UPDATE' && !change.modifiedColumns.every(column => grant.columns.includes(column))) {
    return false
  }
  // check grant conditions
  return grant.check(change.oldRecord, change.record, auth)
}

/**
 * Takes a scoped grant and a change
 * and computes the assigned role that is needed for the change.
 * @param grant The scoped grant
 * @param change The change
 * @returns The assigned role that allows the change
 */
async function concretiseGrant(grant: GrantWithScopedRole, change: Change): Promise<GrantWithAssignedRole> {
  // fetch the PK of the root of the scope
  // by following the path, starting from the changed table
  const rootPK = await followPath(change.relation, change.record ?? change.oldRecord, grant.path)
  // Create an extended role containing the root PK
  const assignedRole = {
    ...grant.role,
    rootPK
  }
  // Create an extended grant containing the concrete role
  return {
    ...grant,
    role: assignedRole
  }
}

// TODO: turn this into a class that you pass a map of grants
//       as well as a DB adapter that it can use to query the DB

/**
 * Follows the path starting from the given row `row` in the given table `from`.
 * @param from Table where to start
 * @param row Row from which to start
 * @param path Path of FKs to follow. The last element of the path must be the name of the column in the destination table.
 *             If there are no FKs to follow, the path should contain a single element which is the name of the column to read.
 */
async function followPath(from: Relation, row: Row, path: Array<string>): Promise<SqlValue> {
  // Fetch the PK of this row
  const pkCols = await executeSQL(`SELECT name FROM pragma_table_info("${from.table}", "${from.schema}") WHERE pk <> 1 ORDER BY pk`)
  if (pkCols.length > 1) {
    throw new Error('Composite PKs are not supported.')
  }
  const pkCol = pkCols[0].name
  const pk = row[pkCol]

  if (path.length === 0) {
    throw new Error('At least one column is needed in the path.')
  }

  const [fkCol, ...rest] = path
  const fk = row[fkCol] // value of the FK

  if (rest.length === 0) {
    // We're at the end of the path
    return fk
  }

  // Lookup which table and column are being referenced by the FK
  const refTableInfo = await executeSQL(`SELECT table, to FROM pragma_foreign_key_list("${from.table}", "${from.schema}") WHERE from = ?`, fkCol)
  const referencedTable = refTableInfo[0].table
  const referencedColumn = refTableInfo[0].to
  // Fetch the row that is referenced by the FK
  const selectReferencedRow = await executeSQL(`SELECT * FROM ${from.schema}.${referencedTable} WHERE ${referencedColumn} = ?`, fk)
  const referencedRow = selectReferencedRow[0]
  
  // Assuming getTable is a function that returns the table to which the FK points
  const referencedRelation = {
    schema: from.schema,
    table: referencedTable,
  }
  return followPath(referencedRelation, referencedRow, rest)
}

function isScopedRole(grant: Grant): boolean {
  return grant.role.hasOwnProperty('scope')
}

function isGlobalScope(grant: Grant): boolean {
  return !isScopedRole(grant)
}

// TODO: implement this function
function getGrants(relation: Relation, privilege: WritePrivilege): Array<Grant> {
  return []
}