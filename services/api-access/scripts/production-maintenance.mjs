// Code/route maintenance only: preserve every CloudFormation parameter and data resource.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function previousParameters(stack, template) {
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error('Production stack must be stable.');
  const current = (stack.Parameters ?? []).map(p => p.ParameterKey).sort();
  if (JSON.stringify(current) !== JSON.stringify(Object.keys(template.Parameters ?? {}).sort())) throw new Error('Maintenance cannot add or remove parameters.');
  const values = Object.fromEntries(stack.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
  if (values.ApiAccessMode !== 'live' || values.ApiAccessEnabled !== 'true' || values.CustomerAccountsEnabled !== 'true') throw new Error('Expected enabled live customer API.');
  return current.map(ParameterKey => ({ParameterKey, UsePreviousValue:true}));
}

const functionIds = new Set(['ApiAccessFunction', 'ApiKeyAuthorizerFunction']);
const permissionIds = new Set(['ApiAccessFunctionStudioWorkspaceReadPermission', 'ApiAccessFunctionStudioWorkspaceSavePermission']);
export function assertMaintenanceChanges(changes, {rollback = false} = {}) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('No maintenance changes found.');
  for (const item of changes) {
    const c = item.ResourceChange;
    if (!c || item.Type !== 'Resource' || c.Replacement && c.Replacement !== 'False') throw new Error('Replacement or unknown change is forbidden.');
    if (c.ResourceType === 'AWS::Lambda::Permission' && permissionIds.has(c.LogicalResourceId) && c.Action === (rollback ? 'Remove' : 'Add')) continue;
    const permittedProperty = c.ResourceType === 'AWS::Lambda::Function' && functionIds.has(c.LogicalResourceId) ? 'Code'
      : c.ResourceType === 'AWS::ApiGatewayV2::Api' && c.LogicalResourceId === 'ApiAccessHttpApi' ? 'Body' : null;
    if (!permittedProperty || c.Action !== 'Modify' || !c.Details?.length || c.Scope?.some(s => s !== 'Properties')
      || c.Details.some(d => d.Target?.Attribute !== 'Properties' || d.Target.Name !== permittedProperty || d.Target.RequiresRecreation !== 'Never')) {
      throw new Error(`Maintenance refuses ${c.Action} ${c.ResourceType} ${c.LogicalResourceId}.`);
    }
  }
}

// Compare the processed templates as well as resource-level change-set entries.
// Outputs, Rules, Conditions, parameter constraints/defaults and resource attributes
// are all part of the preserved contract.
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item;
});
export function assertTemplateBoundary(before, after, {rollback = false} = {}) {
  const left = structuredClone(before), right = structuredClone(after);
  for (const template of [left, right]) {
    for (const id of functionIds) if (template.Resources?.[id]?.Properties) delete template.Resources[id].Properties.Code;
    if (template.Resources?.ApiAccessHttpApi?.Properties) delete template.Resources.ApiAccessHttpApi.Properties.Body;
  }
  for (const id of permissionIds) {
    const old = left.Resources?.[id], next = right.Resources?.[id];
    if ((!old && next && !rollback) || (old && !next && rollback)) {
      const permission = next ?? old;
      if (permission.Type !== 'AWS::Lambda::Permission' || permission.Properties?.Action !== 'lambda:InvokeFunction'
        || permission.Properties?.Principal !== 'apigateway.amazonaws.com') throw new Error('Unexpected Studio permission.');
      delete left.Resources[id]; delete right.Resources[id];
    }
  }
  if (canonical(left) !== canonical(right)) throw new Error('Maintenance changes protected template sections or resource configuration.');
}

export function assertPreserved(before, after) {
  const normalized = stack => (stack.Parameters ?? []).map(p => [p.ParameterKey, p.ParameterValue, p.ResolvedValue ?? null]).sort((a,b) => a[0].localeCompare(b[0]));
  if (JSON.stringify(normalized(before)) !== JSON.stringify(normalized(after))) throw new Error('Production parameters changed.');
}
const healthKeys = ['status', 'enabled', 'customerAccountsEnabled', 'customerTotpEnabled', 'subscriptionBillingEnabled'];
export function assertHealthPreserved(before, after) {
  if (after.status !== 'ok' || healthKeys.some(k => before[k] !== after[k])) throw new Error('Production health or feature state changed.');
}

async function main() {
  const {STACK_NAME, AWS_REGION, GITHUB_SHA, GITHUB_REF, RUNNER_TEMP, EXECUTE_MAINTENANCE} = process.env;
  if (GITHUB_REF !== 'refs/heads/main' || STACK_NAME !== 'solvelang-api-access-production' || !/^[a-z0-9-]+$/.test(AWS_REGION ?? '') || !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? '') || !RUNNER_TEMP) throw new Error('Invalid protected production context.');
  const aws = (...args) => {
    try { return execFileSync('aws', [...args, '--region', AWS_REGION, '--output', 'json'], {encoding:'utf8', maxBuffer:16*1024*1024, stdio:['ignore','pipe','pipe']}).trim(); }
    catch { throw new Error(`AWS ${args[0]} ${args[1]} failed; secret-bearing CLI output was suppressed.`); }
  };
  const json = (...args) => JSON.parse(aws(...args));
  const stack = () => json('cloudformation','describe-stacks','--stack-name',STACK_NAME).Stacks[0];
  const before = stack();
  const candidate = JSON.parse(readFileSync(`${RUNNER_TEMP}/maintenance-packaged.json`, 'utf8'));
  const parameters = previousParameters(before, candidate);
  const api = before.Outputs.find(o => o.OutputKey === 'ApiAccessBaseUrl')?.OutputValue;
  if (!/^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(api ?? '')) throw new Error('Invalid API endpoint.');
  const health = async () => {const r = await fetch(`${api}/health`, {signal:AbortSignal.timeout(15000)}); if (!r.ok) throw new Error('API health request failed.'); return r.json();};
  const initialHealth = await health();
  assertHealthPreserved(initialHealth, initialHealth);
  const previousResult = json('cloudformation','get-template','--stack-name',STACK_NAME,'--template-stage','Processed').TemplateBody;
  const previous = typeof previousResult === 'string' ? JSON.parse(previousResult) : previousResult;
  previousParameters(before, previous);
  const account = json('sts','get-caller-identity').Account;
  const bucket = `solvelang-api-access-production-artifacts-${account}-${createHash('sha256').update(AWS_REGION).digest('hex').slice(0,8)}`;
  const prefix = `maintenance/${GITHUB_SHA}/${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const paramPath = `${RUNNER_TEMP}/maintenance-parameters.json`;
  writeFileSync(paramPath, JSON.stringify(parameters), {mode:0o600});
  const deploy = (template, rollback = false) => {
    const name = `${rollback ? 'rollback' : 'update'}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
    const path = `${RUNNER_TEMP}/maintenance-${name}.json`;
    writeFileSync(path, JSON.stringify(template), {mode:0o600});
    aws('s3api','put-object','--bucket',bucket,'--key',`${prefix}/${name}.json`,'--body',path,'--server-side-encryption','AES256');
    const url = `https://s3.${AWS_REGION}.amazonaws.com/${bucket}/${prefix}/${name}.json`;
    const result = json('cloudformation','create-change-set','--stack-name',STACK_NAME,'--change-set-name',name,'--change-set-type','UPDATE','--template-url',url,'--parameters',`file://${paramPath}`,'--capabilities','CAPABILITY_IAM','--description',`Reviewed code maintenance ${GITHUB_SHA}`);
    let retainPlan = false;
    try {
      aws('cloudformation','wait','change-set-create-complete','--stack-name',STACK_NAME,'--change-set-name',result.Id);
      const changes = json('cloudformation','describe-change-set','--stack-name',STACK_NAME,'--change-set-name',result.Id);
      if (changes.NextToken) throw new Error('Unexpected paginated maintenance change set.');
      assertMaintenanceChanges(changes.Changes, {rollback});
      const processedResult = json('cloudformation','get-template','--stack-name',STACK_NAME,'--change-set-name',result.Id,'--template-stage','Processed').TemplateBody;
      const processed = typeof processedResult === 'string' ? JSON.parse(processedResult) : processedResult;
      const deployedResult = json('cloudformation','get-template','--stack-name',STACK_NAME,'--template-stage','Processed').TemplateBody;
      const deployed = typeof deployedResult === 'string' ? JSON.parse(deployedResult) : deployedResult;
      assertTemplateBoundary(deployed, processed, {rollback});
      assertPreserved(before, stack());
      console.log(`${rollback ? 'Rollback' : 'Maintenance'}: ${changes.Changes.length} allowed code/route changes; all parameters preserved.`);
      if (!rollback && EXECUTE_MAINTENANCE !== 'true') {
        retainPlan = true;
        console.log(`Validated plan retained for inspection: ${result.Id}`);
        const summary = process.env.GITHUB_STEP_SUMMARY;
        if (summary) writeFileSync(summary, `\nValidated change set: ${result.Id}\nCommit: ${GITHUB_SHA}\n\n` + changes.Changes.map(({ResourceChange:c}) => `- ${c.Action} ${c.LogicalResourceId} (${c.ResourceType}); scope: ${(c.Scope ?? []).join(', ')}`).join('\n') + '\n', {flag:'a'});
        return false;
      }
      aws('cloudformation','execute-change-set','--stack-name',STACK_NAME,'--change-set-name',result.Id);
      aws('cloudformation','wait','stack-update-complete','--stack-name',STACK_NAME);
      return true;
    } finally {
      // Executed change sets are normally deleted by CloudFormation; cleanup is best effort.
      try { if (!retainPlan) aws('cloudformation','delete-change-set','--stack-name',STACK_NAME,'--change-set-name',result.Id); } catch {}
    }
  };
  const executed = deploy(candidate);
  if (!executed) { console.log('Plan validated; no stack update executed.'); return; }
  try {
    assertPreserved(before, stack());
    assertHealthPreserved(initialHealth, await health());
    const probe = await fetch(`${api}/customer/studio/workspace`, {signal:AbortSignal.timeout(15000)});
    if (probe.status !== 401) throw new Error('Studio route must require a customer session.');
    console.log('Maintenance deployed; parameter/health preservation and Studio authentication gate verified.');
  } catch (error) {
    console.error('Post-deployment acceptance failed; restoring the previous processed template.');
    deploy(previous, true);
    assertPreserved(before, stack());
    assertHealthPreserved(initialHealth, await health());
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {console.error(error.message);process.exitCode=1;});
