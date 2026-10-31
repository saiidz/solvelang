// Point-in-time recovery restore drill for the production DynamoDB tables.
//
// Default mode is inventory only: report the deployed PITR status of every
// table in the two production stacks and change nothing. With
// EXECUTE_DRILL=true and an explicit SOURCE_TABLE, restore that table into a
// throwaway `pitr-drill-` table, verify it, and delete it in the same run.
// Source tables and stacks are never modified.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-2';
export const DRILL_PREFIX = 'pitr-drill-';
export const RESTORE_AGE_MINUTES = 60;
const POLL_SECONDS = 20;
const MAX_POLLS = 120; // 40 minutes, inside the 60-minute job budget

function awsJson(args) {
  try {
    const out = execFileSync('aws', [...args, '--region', AWS_REGION, '--output', 'json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out ? JSON.parse(out) : {};
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${stderr}`);
  }
}

function sleep(seconds) {
  execFileSync('sleep', [String(seconds)]);
}

export function sanitizeTableComponent(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

export function drillTargetName(sourceTable, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', 't');
  const source = sanitizeTableComponent(sourceTable).slice(-80);
  const name = `${DRILL_PREFIX}${source}-${stamp}`;
  if (name.length < 3 || name.length > 255) throw new Error(`Drill target name is out of DynamoDB bounds: ${name}`);
  return name;
}

export function buildInventory(stackName, resources, detailsByTable) {
  return resources
    .filter((resource) => resource.ResourceType === 'AWS::DynamoDB::Table')
    .map((resource) => {
      const table = resource.PhysicalResourceId;
      const details = detailsByTable[table] ?? {};
      const pitr = details.backups?.PointInTimeRecoveryDescription ?? {};
      return {
        stack: stackName,
        logicalId: resource.LogicalResourceId,
        table,
        tableStatus: details.table?.TableStatus ?? 'UNKNOWN',
        itemCount: details.table?.ItemCount ?? null,
        pitrStatus: pitr.PointInTimeRecoveryStatus ?? 'DISABLED',
        earliestRestorable: pitr.EarliestRestorableDateTime ?? null,
        latestRestorable: pitr.LatestRestorableDateTime ?? null,
      };
    });
}

export function assertDrillCandidate(inventory, sourceTable) {
  const entry = inventory.find((candidate) => candidate.table === sourceTable);
  if (!entry) throw new Error(`Source table is not in the production inventory: ${sourceTable}`);
  if (entry.pitrStatus !== 'ENABLED') {
    throw new Error(`Source table does not have PITR enabled (status: ${entry.pitrStatus}): ${sourceTable}`);
  }
  return entry;
}

export function chooseRestorePoint(entry, now = new Date()) {
  const point = new Date(now.getTime() - RESTORE_AGE_MINUTES * 60_000);
  const earliest = entry.earliestRestorable ? new Date(entry.earliestRestorable) : null;
  const latest = entry.latestRestorable ? new Date(entry.latestRestorable) : null;
  if (earliest && point < earliest) {
    throw new Error(`Restore point ${point.toISOString()} predates the earliest restorable point ${entry.earliestRestorable}.`);
  }
  if (latest && point > latest) {
    throw new Error(`Restore point ${point.toISOString()} is after the latest restorable point ${entry.latestRestorable}.`);
  }
  return point;
}

function stackTables(stackName) {
  const result = awsJson(['cloudformation', 'describe-stack-resources', '--stack-name', stackName]);
  const detailsByTable = {};
  for (const resource of result.StackResources ?? []) {
    if (resource.ResourceType !== 'AWS::DynamoDB::Table') continue;
    const table = resource.PhysicalResourceId;
    const described = awsJson(['dynamodb', 'describe-table', '--table-name', table]);
    const backups = awsJson(['dynamodb', 'describe-continuous-backups', '--table-name', table]);
    detailsByTable[table] = { table: described.Table ?? {}, backups: backups.ContinuousBackupsDescription ?? {} };
  }
  return buildInventory(stackName, result.StackResources ?? [], detailsByTable);
}

function describeTableStatus(table) {
  try {
    const described = awsJson(['dynamodb', 'describe-table', '--table-name', table]);
    return described.Table ?? null;
  } catch (error) {
    if (/ResourceNotFoundException/.test(error.message)) return null;
    throw error;
  }
}

function waitForTableState(table, wanted, label) {
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const current = describeTableStatus(table);
    if (wanted === 'ACTIVE' && current?.TableStatus === 'ACTIVE') return current;
    if (wanted === 'GONE' && current === null) return null;
    if (poll % 6 === 0) console.log(`Waiting for drill table ${label}: ${current?.TableStatus ?? 'absent'}`);
    sleep(POLL_SECONDS);
  }
  throw new Error(`Timed out waiting for drill table to become ${wanted}: ${table}`);
}

export function main() {
  const apiAccessStack = process.env.STACK_NAME ?? '';
  const entitlementStack = process.env.ENTITLEMENT_STACK_NAME ?? '';
  if (apiAccessStack !== 'solvelang-api-access-production') {
    throw new Error(`Refusing to run against unexpected API access stack: ${apiAccessStack || '(unset)'}`);
  }
  if (!entitlementStack) throw new Error('ENTITLEMENT_STACK_NAME is not set.');

  const inventory = [...stackTables(apiAccessStack), ...stackTables(entitlementStack)];
  for (const entry of inventory) {
    console.log(
      `INVENTORY stack=${entry.stack} table=${entry.table} status=${entry.tableStatus} items=${entry.itemCount ?? '?'} pitr=${entry.pitrStatus} earliest=${entry.earliestRestorable ?? '-'} latest=${entry.latestRestorable ?? '-'}`,
    );
  }
  const enabled = inventory.filter((entry) => entry.pitrStatus === 'ENABLED');
  console.log(`Inventory complete: ${inventory.length} tables, ${enabled.length} with PITR enabled.`);

  if (process.env.EXECUTE_DRILL !== 'true') {
    console.log('Inventory only (EXECUTE_DRILL is not true). No production change made.');
    return;
  }

  const sourceTable = process.env.SOURCE_TABLE ?? '';
  if (!sourceTable) throw new Error('SOURCE_TABLE is required when EXECUTE_DRILL=true.');
  const candidate = assertDrillCandidate(inventory, sourceTable);
  const restorePoint = chooseRestorePoint(candidate);
  const target = drillTargetName(sourceTable);
  if (describeTableStatus(target) !== null) throw new Error(`Drill target already exists: ${target}`);

  console.log(`Restoring ${sourceTable} at ${restorePoint.toISOString()} into ${target} ...`);
  let restored = false;
  try {
    awsJson([
      'dynamodb', 'restore-table-to-point-in-time',
      '--source-table-name', sourceTable,
      '--target-table-name', target,
      '--restore-date-time', restorePoint.toISOString(),
    ]);
    restored = true;
    const drillTable = waitForTableState(target, 'ACTIVE', 'restore');
    const sourceNow = describeTableStatus(sourceTable);
    console.log(`Drill table ACTIVE. Source items (describe): ${sourceNow?.ItemCount ?? '?'}; drill items (describe): ${drillTable?.ItemCount ?? '?'}. Counts are eventually consistent; the hard gate is a non-empty drill table for a non-empty source.`);
    if ((sourceNow?.ItemCount ?? 0) > 0 && (drillTable?.ItemCount ?? 0) === 0) {
      throw new Error('Drill table is empty while the source table is not; restore did not verify.');
    }
    const scan = awsJson(['dynamodb', 'scan', '--table-name', target, '--limit', '1']);
    console.log(`Drill table scan sanity: returned ${scan.Count ?? 0} item(s) on a limit-1 scan.`);
  } finally {
    if (restored) {
      console.log(`Deleting drill table ${target} ...`);
      try {
        awsJson(['dynamodb', 'delete-table', '--table-name', target]);
        waitForTableState(target, 'GONE', 'delete');
        console.log('Drill table deleted; nothing drill-named remains.');
      } catch (cleanupError) {
        console.error(`CLEANUP FAILED for ${target}: ${cleanupError.message}`);
        throw cleanupError;
      }
    }
  }
  console.log(`PITR DRILL COMPLETE: ${sourceTable} -> ${target} restored, verified, and cleaned up.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
