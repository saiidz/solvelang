// Code/route maintenance with one explicit acceptance-origin exception; preserve every other parameter and data resource.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseStudioAcceptanceOrigin, STUDIO_ACCEPTANCE_ORIGIN_CLOUDFORMATION_PATTERN } from '../src/studio-acceptance-origin.js';

const acceptanceParameter = 'StudioAcceptanceOrigin';
const acceptanceCondition = 'StudioAcceptanceOriginConfigured';
const acceptanceParameterDefinition = {
  Type: 'String',
  Default: '',
  Description: 'Exact dedicated Amplify acceptance-branch origin; blank disables it.',
  AllowedPattern: STUDIO_ACCEPTANCE_ORIGIN_CLOUDFORMATION_PATTERN,
};
const acceptanceConditionDefinition = { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: acceptanceParameter }, ''] }] };

function acceptanceRequest(options = {}) {
  const action = options.studioAcceptanceOriginAction ?? 'preserve';
  const origin = options.studioAcceptanceOrigin ?? '';
  if (!['preserve', 'enable', 'disable'].includes(action)) throw new Error('Invalid Studio acceptance-origin action.');
  if (action === 'enable') {
    const parsed = parseStudioAcceptanceOrigin(origin);
    if (!parsed) throw new Error('An exact Studio acceptance origin is required when enabling the origin.');
    return { action, origin: parsed };
  }
  if (origin !== '') throw new Error('An origin value is only allowed when enabling the acceptance origin.');
  return { action, origin: '' };
}

function siteOriginFrom(stack, template) {
  return stack.Parameters?.find(parameter => parameter.ParameterKey === 'SiteOrigin')?.ParameterValue
    ?? template.Parameters?.SiteOrigin?.Default;
}

export function previousParameters(stack, template, options = {}) {
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error('Production stack must be stable.');
  const current = (stack.Parameters ?? []).map(p => p.ParameterKey).sort();
  const templateKeys = Object.keys(template.Parameters ?? {}).sort();
  if (!templateKeys.includes(acceptanceParameter) && current.includes(acceptanceParameter)) throw new Error('Maintenance cannot remove the Studio acceptance-origin parameter.');
  if (JSON.stringify(current.filter(key => key !== acceptanceParameter)) !== JSON.stringify(templateKeys.filter(key => key !== acceptanceParameter))) throw new Error('Maintenance cannot add or remove unrelated parameters.');
  const values = Object.fromEntries(stack.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
  if (values.ApiAccessMode !== 'live' || values.ApiAccessEnabled !== 'true' || values.CustomerAccountsEnabled !== 'true') throw new Error('Expected enabled live customer API.');
  const request = acceptanceRequest(options);
  if (request.action === 'enable') parseStudioAcceptanceOrigin(request.origin, siteOriginFrom(stack, template));
  const result = current.filter(ParameterKey => ParameterKey !== acceptanceParameter).map(ParameterKey => ({ParameterKey, UsePreviousValue:true}));
  if (templateKeys.includes(acceptanceParameter)) {
    if (request.action === 'enable') result.push({ ParameterKey: acceptanceParameter, ParameterValue: request.origin });
    else if (request.action === 'disable') result.push({ ParameterKey: acceptanceParameter, ParameterValue: '' });
    else if (current.includes(acceptanceParameter)) result.push({ ParameterKey: acceptanceParameter, UsePreviousValue:true });
  }
  return result.sort((left, right) => left.ParameterKey.localeCompare(right.ParameterKey));
}

const functionIds = new Set(['ApiAccessFunction']);
const permissionIds = new Set(['ApiAccessFunctionStudioWorkspaceReadPermission', 'ApiAccessFunctionStudioWorkspaceSavePermission']);
export function assertMaintenanceChanges(changes, {rollback = false} = {}) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('No maintenance changes found.');
  for (const item of changes) {
    const c = item.ResourceChange;
    if (!c || item.Type !== 'Resource' || c.Replacement && c.Replacement !== 'False') throw new Error('Replacement or unknown change is forbidden.');
    if (c.ResourceType === 'AWS::Lambda::Permission' && permissionIds.has(c.LogicalResourceId) && c.Action === (rollback ? 'Remove' : 'Add')) continue;
    const details = c.Details;
    const targetNames = details?.map(detail => detail.Target?.Name) ?? [];
    const apiAccessFunctionOnly = c.ResourceType === 'AWS::Lambda::Function' && c.LogicalResourceId === 'ApiAccessFunction'
      && targetNames.length > 0 && targetNames.every(name => ['Code', 'Environment', 'Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN'].includes(name));
    const apiBodyOnly = c.ResourceType === 'AWS::ApiGatewayV2::Api' && c.LogicalResourceId === 'ApiAccessHttpApi'
      && targetNames.length > 0 && targetNames.every(name => name === 'Body');
    const permitted = apiAccessFunctionOnly || apiBodyOnly;
    if (!permitted || c.Action !== 'Modify' || !Array.isArray(c.Scope) || c.Scope.some(scope => scope !== 'Properties')
      || details.some(detail => detail.Target?.Attribute !== 'Properties' || detail.Target.RequiresRecreation !== 'Never')) {
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
function assertApiCorsOriginOnly(beforeBody, afterBody, {
  siteOrigin,
  studioAcceptanceOrigin,
  currentStudioAcceptanceOrigin = '',
  studioAcceptanceOriginAction = 'preserve',
} = {}) {
  const parseBody = body => {
    if (typeof body !== 'string') return body;
    try { return JSON.parse(body); }
    catch { throw new Error('Maintenance could not parse the processed API Gateway definition.'); }
  };
  beforeBody = parseBody(beforeBody);
  afterBody = parseBody(afterBody);
  const locateCors = (body, label) => {
    const matches = [];
    const visit = (value, path = []) => {
      if (!value || typeof value !== 'object') return;
      if (Object.hasOwn(value, 'x-amazon-apigateway-cors')) matches.push({ path: [...path, 'x-amazon-apigateway-cors'], cors: value['x-amazon-apigateway-cors'] });
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
    };
    visit(body);
    if (matches.length !== 1) throw new Error(`Maintenance requires one API Gateway CORS definition in the ${label} API body (found ${matches.length}).`);
    if (!matches[0].cors || typeof matches[0].cors !== 'object') throw new Error(`Maintenance requires a structured API Gateway CORS definition in the ${label} API body.`);
    return matches[0];
  };
  const beforeCors = locateCors(beforeBody, 'deployed'), afterCors = locateCors(afterBody, 'proposed');
  if (canonical(beforeCors.path) !== canonical(afterCors.path)) throw new Error('Maintenance moved the API Gateway CORS configuration.');
  const withoutCorsExtension = (body, path) => {
    const copy = structuredClone(body);
    const parent = path.slice(0, -1).reduce((value, key) => value[key], copy);
    delete parent[path.at(-1)];
    return copy;
  };
  if (canonical(withoutCorsExtension(beforeBody, beforeCors.path)) !== canonical(withoutCorsExtension(afterBody, afterCors.path))) {
    throw new Error('Maintenance changes API Gateway settings beyond the CORS origin list.');
  }
  const corsVariants = (cors, label) => {
    if (Object.hasOwn(cors, 'allowOrigins')) return {condition: null, variants: [cors]};
    const conditional = cors['Fn::If'];
    if (Object.keys(cors).length === 1 && Array.isArray(conditional) && conditional.length === 3
      && conditional[1] && typeof conditional[1] === 'object' && !Array.isArray(conditional[1])
      && conditional[2] && typeof conditional[2] === 'object' && !Array.isArray(conditional[2])
      && conditional.slice(1).every(branch => Object.hasOwn(branch, 'allowOrigins'))) {
      return {condition: conditional[0], variants: conditional.slice(1)};
    }
    const keys = Object.keys(cors).sort().join(', ') || 'none';
    throw new Error(`Maintenance requires explicit API Gateway CORS origin lists in every ${label} branch (found keys: ${keys}).`);
  };
  const beforeVariants = corsVariants(beforeCors.cors, 'deployed');
  const afterVariants = corsVariants(afterCors.cors, 'proposed');
  const baselineOrigins = [[{ Ref: 'SiteOrigin' }]];
  if (siteOrigin) baselineOrigins.push([siteOrigin, ...(currentStudioAcceptanceOrigin ? [currentStudioAcceptanceOrigin] : [])]);
  const originsMatchBaseline = origins => baselineOrigins.some(expected => canonical(origins) === canonical(expected));
  const baselineConditional = beforeVariants.condition === acceptanceCondition
    && canonical(beforeVariants.variants[0].allowOrigins) === canonical([{ Ref: 'SiteOrigin' }, { Ref: acceptanceParameter }])
    && canonical(beforeVariants.variants[1].allowOrigins) === canonical([{ Ref: 'SiteOrigin' }]);
  if (!baselineConditional && !beforeVariants.variants.every(variant => originsMatchBaseline(variant.allowOrigins))) {
    throw new Error('Maintenance changes the existing API Gateway origin.');
  }
  const withoutOrigins = variant => { const copy = structuredClone(variant); delete copy.allowOrigins; return copy; };
  const beforeSettings = beforeVariants.variants.map(withoutOrigins);
  if (!afterVariants.variants.every(variant => beforeSettings.some(settings => canonical(settings) === canonical(withoutOrigins(variant))))
    || !beforeSettings.every(settings => afterVariants.variants.some(variant => canonical(settings) === canonical(withoutOrigins(variant))))) {
    throw new Error('Maintenance changes API Gateway settings beyond the CORS origin list.');
  }
  const expected = { 'Fn::If': [acceptanceCondition, [{ Ref: 'SiteOrigin' }, { Ref: acceptanceParameter }], [{ Ref: 'SiteOrigin' }]] };
  const resolvedAcceptanceOrigin = studioAcceptanceOriginAction === 'enable' ? studioAcceptanceOrigin
    : studioAcceptanceOriginAction === 'disable' ? '' : currentStudioAcceptanceOrigin;
  const exactLiteralOrigins = siteOrigin ? [siteOrigin, ...(resolvedAcceptanceOrigin ? [resolvedAcceptanceOrigin] : [])] : undefined;
  const symbolicBranches = afterVariants.condition === acceptanceCondition
    && canonical(afterVariants.variants[0].allowOrigins) === canonical([{ Ref: 'SiteOrigin' }, { Ref: acceptanceParameter }])
    && canonical(afterVariants.variants[1].allowOrigins) === canonical([{ Ref: 'SiteOrigin' }]);
  const literalBranches = siteOrigin && afterVariants.condition === acceptanceCondition
    && canonical(afterVariants.variants[0].allowOrigins) === canonical([siteOrigin, ...(resolvedAcceptanceOrigin ? [resolvedAcceptanceOrigin] : [])])
    && canonical(afterVariants.variants[1].allowOrigins) === canonical([siteOrigin]);
  const directExpected = afterVariants.condition === null && (canonical(afterVariants.variants[0].allowOrigins) === canonical(expected)
    || Boolean(exactLiteralOrigins && canonical(afterVariants.variants[0].allowOrigins) === canonical(exactLiteralOrigins)));
  if (!symbolicBranches && !literalBranches && !directExpected) {
    throw new Error('Maintenance adds an unexpected API Gateway CORS origin.');
  }
}
function stripAcceptanceRootTransition(left, right, {rollback = false} = {}) {
  const beforeParameter = left.Parameters?.[acceptanceParameter];
  const afterParameter = right.Parameters?.[acceptanceParameter];
  if (!beforeParameter && afterParameter && !rollback) {
    if (canonical(afterParameter) !== canonical(acceptanceParameterDefinition)) throw new Error('Maintenance adds an unexpected Studio acceptance parameter.');
    delete right.Parameters[acceptanceParameter];
    if (!left.Parameters && Object.keys(right.Parameters).length === 0) delete right.Parameters;
  } else if (beforeParameter && !afterParameter && rollback) {
    delete left.Parameters[acceptanceParameter];
    if (!right.Parameters && Object.keys(left.Parameters).length === 0) delete left.Parameters;
  }
  const beforeCondition = left.Conditions?.[acceptanceCondition];
  const afterCondition = right.Conditions?.[acceptanceCondition];
  if (!beforeCondition && afterCondition && !rollback) {
    if (canonical(afterCondition) !== canonical(acceptanceConditionDefinition)) throw new Error('Maintenance adds an unexpected Studio acceptance condition.');
    delete right.Conditions[acceptanceCondition];
    if (!left.Conditions && Object.keys(right.Conditions).length === 0) delete right.Conditions;
  } else if (beforeCondition && !afterCondition && rollback) {
    delete left.Conditions[acceptanceCondition];
    if (!right.Conditions && Object.keys(left.Conditions).length === 0) delete left.Conditions;
  }
}

function assertRootBoundary(before, after, options = {}) {
  const left = structuredClone(before), right = structuredClone(after);
  stripAcceptanceRootTransition(left, right, options);
  if (canonical(left) !== canonical(right)) throw new Error('Maintenance changes protected stack-level template sections.');
}

export function assertTemplateBoundary(before, after, options = {}) {
  const {rollback = false} = options;
  const left = structuredClone(before), right = structuredClone(after);
  if (!rollback && left.Resources?.ApiAccessHttpApi?.Properties?.Body && right.Resources?.ApiAccessHttpApi?.Properties?.Body) {
    assertApiCorsOriginOnly(left.Resources.ApiAccessHttpApi.Properties.Body, right.Resources.ApiAccessHttpApi.Properties.Body, options);
  }
  for (const template of [left, right]) {
    for (const id of functionIds) if (template.Resources?.[id]?.Properties) delete template.Resources[id].Properties.Code;
    const variables = template.Resources?.ApiAccessFunction?.Properties?.Environment?.Variables;
    if (variables && Object.hasOwn(variables, 'STUDIO_ACCEPTANCE_ORIGIN')) {
      if (canonical(variables.STUDIO_ACCEPTANCE_ORIGIN) !== canonical({ Ref: acceptanceParameter })) throw new Error('Studio acceptance environment must reference only its bounded parameter.');
      delete variables.STUDIO_ACCEPTANCE_ORIGIN;
    }
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
  stripAcceptanceRootTransition(left, right, {rollback});
  if (canonical(left) !== canonical(right)) throw new Error('Maintenance changes protected template sections or resource configuration.');
}

// Production data-resource settings can legitimately differ from source defaults
// (for example, operations hardening). Build the maintenance template from the
// deployed template and copy only the reviewed executable properties into it.
export function projectMaintenanceTemplate(deployed, compiled, options = {}) {
  const roots = template => { const root = structuredClone(template); delete root.Resources; return root; };
  assertRootBoundary(roots(deployed), roots(compiled));
  const original = deployed.Resources ?? {}, candidate = compiled.Resources ?? {};
  for (const id of Object.keys(original)) if (!candidate[id]) throw new Error(`Candidate removes existing resource ${id}.`);
  for (const id of Object.keys(candidate)) if (!original[id] && !permissionIds.has(id)) throw new Error(`Candidate adds unrelated resource ${id}.`);
  const result = structuredClone(deployed);
  if (!result.Parameters?.[acceptanceParameter]) {
    if (!compiled.Parameters?.[acceptanceParameter]) throw new Error('Missing reviewed Studio acceptance-origin parameter.');
    result.Parameters ??= {};
    result.Parameters[acceptanceParameter] = structuredClone(compiled.Parameters[acceptanceParameter]);
  }
  if (!result.Conditions?.[acceptanceCondition]) {
    if (!compiled.Conditions?.[acceptanceCondition]) throw new Error('Missing reviewed Studio acceptance-origin condition.');
    result.Conditions ??= {};
    result.Conditions[acceptanceCondition] = structuredClone(compiled.Conditions[acceptanceCondition]);
  }
  for (const [id, type, property] of [
    ...[...functionIds].map(id => [id, 'AWS::Lambda::Function', 'Code']),
    ['ApiAccessHttpApi', 'AWS::ApiGatewayV2::Api', 'Body'],
  ]) {
    if (original[id]?.Type !== type || candidate[id]?.Type !== type || !candidate[id].Properties?.[property]) throw new Error(`Missing maintenance property ${id}.${property}.`);
    result.Resources[id].Properties[property] = structuredClone(candidate[id].Properties[property]);
  }
  const deployedVariables = original.ApiAccessFunction?.Properties?.Environment?.Variables;
  const compiledVariables = candidate.ApiAccessFunction?.Properties?.Environment?.Variables;
  if (!deployedVariables || !compiledVariables || !Object.hasOwn(compiledVariables, 'STUDIO_ACCEPTANCE_ORIGIN')) throw new Error('Missing maintenance property ApiAccessFunction.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN.');
  result.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN = structuredClone(compiledVariables.STUDIO_ACCEPTANCE_ORIGIN);
  for (const id of permissionIds) if (!original[id] && candidate[id]) result.Resources[id] = structuredClone(candidate[id]);
  assertTemplateBoundary(deployed, result, options);
  return result;
}

export function assertPreserved(before, after, options = {}) {
  const normalized = stack => (stack.Parameters ?? []).map(p => [p.ParameterKey, p.ParameterValue, p.ResolvedValue ?? null]).sort((a,b) => a[0].localeCompare(b[0]));
  const beforeParameters = normalized(before).filter(([key]) => key !== acceptanceParameter);
  const afterParameters = normalized(after).filter(([key]) => key !== acceptanceParameter);
  if (JSON.stringify(beforeParameters) !== JSON.stringify(afterParameters)) throw new Error('Production parameters changed.');
  const request = acceptanceRequest(options);
  const previousOrigin = before.Parameters?.find(parameter => parameter.ParameterKey === acceptanceParameter)?.ParameterValue ?? '';
  const expected = options.rollback ? previousOrigin
    : request.action === 'enable' ? request.origin
      : request.action === 'disable' ? '' : previousOrigin;
  const actualParameter = after.Parameters?.find(parameter => parameter.ParameterKey === acceptanceParameter);
  const actual = actualParameter?.ParameterValue ?? '';
  if (actual !== expected || (!options.rollback && request.action !== 'preserve' && !actualParameter)
    || (options.rollback && !before.Parameters?.some(parameter => parameter.ParameterKey === acceptanceParameter) && actualParameter)) {
    throw new Error('Studio acceptance origin did not match the requested state.');
  }
}
const healthKeys = ['status', 'enabled', 'customerAccountsEnabled', 'customerTotpEnabled', 'subscriptionBillingEnabled'];
export function assertHealthPreserved(before, after) {
  if (after.status !== 'ok' || healthKeys.some(k => before[k] !== after[k])) throw new Error('Production health or feature state changed.');
}

async function main() {
  const {STACK_NAME, AWS_REGION, GITHUB_SHA, GITHUB_REF, RUNNER_TEMP, EXECUTE_MAINTENANCE,
    STUDIO_ACCEPTANCE_ORIGIN_ACTION, STUDIO_ACCEPTANCE_ORIGIN} = process.env;
  if (GITHUB_REF !== 'refs/heads/main' || STACK_NAME !== 'solvelang-api-access-production' || !/^[a-z0-9-]+$/.test(AWS_REGION ?? '') || !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? '') || !RUNNER_TEMP) throw new Error('Invalid protected production context.');
  const acceptanceOptions = {
    studioAcceptanceOriginAction: STUDIO_ACCEPTANCE_ORIGIN_ACTION ?? 'preserve',
    studioAcceptanceOrigin: STUDIO_ACCEPTANCE_ORIGIN ?? '',
  };
  const acceptedOriginRequest = acceptanceRequest(acceptanceOptions);
  const aws = (...args) => {
    try { return execFileSync('aws', [...args, '--region', AWS_REGION, '--output', 'json'], {encoding:'utf8', maxBuffer:16*1024*1024, stdio:['ignore','pipe','pipe']}).trim(); }
    catch { throw new Error(`AWS ${args[0]} ${args[1]} failed; secret-bearing CLI output was suppressed.`); }
  };
  const json = (...args) => JSON.parse(aws(...args));
  const stack = () => json('cloudformation','describe-stacks','--stack-name',STACK_NAME).Stacks[0];
  const before = stack();
  const candidate = JSON.parse(readFileSync(`${RUNNER_TEMP}/maintenance-packaged.json`, 'utf8'));
  const parameters = previousParameters(before, candidate, acceptanceOptions);
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
  const rollbackParameters = (before.Parameters ?? []).map(parameter => parameter.ParameterKey === acceptanceParameter
    ? { ParameterKey: parameter.ParameterKey, ParameterValue: parameter.ParameterValue }
    : { ParameterKey: parameter.ParameterKey, UsePreviousValue: true });
  const rollbackParamPath = `${RUNNER_TEMP}/maintenance-rollback-parameters.json`;
  writeFileSync(rollbackParamPath, JSON.stringify(rollbackParameters), {mode:0o600});
  const deploy = (template, rollback = false) => {
    const planningBaseline = rollback ? stack() : before;
    if (!rollback) assertPreserved(before, planningBaseline);
    const name = `${rollback ? 'rollback' : 'update'}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
    const path = `${RUNNER_TEMP}/maintenance-${name}.json`;
    writeFileSync(path, JSON.stringify(template), {mode:0o600});
    aws('s3api','put-object','--bucket',bucket,'--key',`${prefix}/${name}.json`,'--body',path,'--server-side-encryption','AES256');
    const url = `https://s3.${AWS_REGION}.amazonaws.com/${bucket}/${prefix}/${name}.json`;
    const parametersPath = rollback ? rollbackParamPath : paramPath;
    const result = json('cloudformation','create-change-set','--stack-name',STACK_NAME,'--change-set-name',name,'--change-set-type','UPDATE','--template-url',url,'--parameters',`file://${parametersPath}`,'--capabilities','CAPABILITY_IAM','--description',`Reviewed code maintenance ${GITHUB_SHA}`);
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
      assertTemplateBoundary(deployed, processed, {
        rollback,
        siteOrigin: siteOriginFrom(planningBaseline, deployed),
        studioAcceptanceOrigin: acceptedOriginRequest.action === 'enable' ? acceptedOriginRequest.origin : undefined,
        currentStudioAcceptanceOrigin: planningBaseline.Parameters?.find(parameter => parameter.ParameterKey === acceptanceParameter)?.ParameterValue ?? '',
        studioAcceptanceOriginAction: acceptedOriginRequest.action,
      });
      assertPreserved(planningBaseline, stack());
      console.log(`${rollback ? 'Rollback' : 'Maintenance'}: ${changes.Changes.length} allowed code/route/acceptance-origin changes; unrelated parameters are preserved.`);
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
  // This first change set only expands SAM. It is never executable by this code.
  const compileName = `compile-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const compilePath = `${RUNNER_TEMP}/maintenance-compile.json`;
  writeFileSync(compilePath, JSON.stringify(candidate), {mode:0o600});
  aws('s3api','put-object','--bucket',bucket,'--key',`${prefix}/compile.json`,'--body',compilePath,'--server-side-encryption','AES256');
  const compilation = json('cloudformation','create-change-set','--stack-name',STACK_NAME,'--change-set-name',compileName,'--change-set-type','UPDATE',
    '--template-url',`https://s3.${AWS_REGION}.amazonaws.com/${bucket}/${prefix}/compile.json`,'--parameters',`file://${paramPath}`,'--capabilities','CAPABILITY_IAM');
  let projected;
  try {
    aws('cloudformation','wait','change-set-create-complete','--stack-name',STACK_NAME,'--change-set-name',compilation.Id);
    const body = json('cloudformation','get-template','--stack-name',STACK_NAME,'--change-set-name',compilation.Id,'--template-stage','Processed').TemplateBody;
    projected = projectMaintenanceTemplate(previous, typeof body === 'string' ? JSON.parse(body) : body, {
      siteOrigin: siteOriginFrom(before, previous),
      studioAcceptanceOrigin: acceptedOriginRequest.action === 'enable' ? acceptedOriginRequest.origin : undefined,
      currentStudioAcceptanceOrigin: before.Parameters?.find(parameter => parameter.ParameterKey === acceptanceParameter)?.ParameterValue ?? '',
      studioAcceptanceOriginAction: acceptedOriginRequest.action,
    });
  } finally {
    aws('cloudformation','delete-change-set','--stack-name',STACK_NAME,'--change-set-name',compilation.Id);
  }
  const executed = deploy(projected);
  if (!executed) { console.log('Plan validated; no stack update executed.'); return; }
  try {
    assertPreserved(before, stack(), acceptanceOptions);
    assertHealthPreserved(initialHealth, await health());
    const activeAcceptanceOrigin = acceptedOriginRequest.action === 'enable' ? acceptedOriginRequest.origin
      : acceptedOriginRequest.action === 'disable' ? ''
        : before.Parameters?.find(parameter => parameter.ParameterKey === acceptanceParameter)?.ParameterValue ?? '';
    if (activeAcceptanceOrigin) {
      const preflight = await fetch(`${api}/customer/studio/workspace`, {
        method: 'OPTIONS', signal: AbortSignal.timeout(15000),
        headers: {
          origin: activeAcceptanceOrigin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'content-type,x-solvelang-csrf',
        },
      });
      if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== activeAcceptanceOrigin
        || preflight.headers.get('access-control-allow-credentials') !== 'true') throw new Error('Studio acceptance-origin CORS preflight failed.');
    }
    const probe = await fetch(`${api}/customer/studio/workspace`, {signal:AbortSignal.timeout(15000)});
    if (probe.status !== 401) throw new Error('Studio route must require a customer session.');
    console.log('Maintenance deployed; parameter/health preservation and Studio authentication gate verified.');
  } catch (error) {
    console.error('Post-deployment acceptance failed; restoring the previous processed template.');
    deploy(previous, true);
    assertPreserved(before, stack(), { ...acceptanceOptions, rollback: true });
    assertHealthPreserved(initialHealth, await health());
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {console.error(error.message);process.exitCode=1;});
