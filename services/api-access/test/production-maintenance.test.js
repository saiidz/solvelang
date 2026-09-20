import test from 'node:test';
import assert from 'node:assert/strict';
import { previousParameters, assertMaintenanceChanges, assertPreserved, assertHealthPreserved, assertTemplateBoundary } from '../scripts/production-maintenance.mjs';
const stack = () => ({StackStatus:'UPDATE_COMPLETE',Parameters:[['ApiAccessMode','live'],['ApiAccessEnabled','true'],['CustomerAccountsEnabled','true'],['SubscriptionBillingEnabled','true'],['Secret','****']].map(([ParameterKey,ParameterValue])=>({ParameterKey,ParameterValue}))});
const template = () => ({Parameters:Object.fromEntries(stack().Parameters.map(p=>[p.ParameterKey,{}]))});
const change = (id='ApiAccessFunction',type='AWS::Lambda::Function',property='Code') => ({Type:'Resource',ResourceChange:{Action:'Modify',LogicalResourceId:id,ResourceType:type,Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:property,RequiresRecreation:'Never'}}]}});
test('every parameter including secrets and enabled billing uses previous value',()=>{
 const result=previousParameters(stack(),template());
 assert.equal(result.length,5);assert.ok(result.every(p=>p.UsePreviousValue===true && !('ParameterValue' in p)));
 const modified=template();modified.Parameters.NewFlag={Default:'false'};
 assert.throws(()=>previousParameters(stack(),modified));
 assert.throws(()=>previousParameters({...stack(),StackStatus:'UPDATE_IN_PROGRESS'},template()));
});
test('code and route updates pass; replacements, IAM, storage, environment and deletions fail closed',()=>{
 assertMaintenanceChanges([change(),change('ApiAccessHttpApi','AWS::ApiGatewayV2::Api','Body')]);
 for(const c of [change('Table','AWS::DynamoDB::Table','BillingMode'),change('Role','AWS::IAM::Role','Policies'),change('ApiAccessFunction','AWS::Lambda::Function','Environment'),{Type:'Resource',ResourceChange:{...change().ResourceChange,Replacement:'Conditional'}},{Type:'Resource',ResourceChange:{...change().ResourceChange,Action:'Remove'}}])assert.throws(()=>assertMaintenanceChanges([c]));
 assert.throws(()=>assertMaintenanceChanges([]));
});
test('only the exact Studio invoke permissions can be added and removed on rollback',()=>{
 const c={Type:'Resource',ResourceChange:{Action:'Add',ResourceType:'AWS::Lambda::Permission',LogicalResourceId:'ApiAccessFunctionStudioWorkspaceReadPermission'}};
 assertMaintenanceChanges([c]);assert.throws(()=>assertMaintenanceChanges([c],{rollback:true}));
 c.ResourceChange.Action='Remove';assertMaintenanceChanges([c],{rollback:true});assert.throws(()=>assertMaintenanceChanges([c]));
 c.ResourceChange.LogicalResourceId='OtherPermission';assert.throws(()=>assertMaintenanceChanges([c],{rollback:true}));
});
test('parameter and health drift fails acceptance without revealing values',()=>{
 assertPreserved(stack(),stack());const changed=stack();changed.Parameters[3].ParameterValue='false';assert.throws(()=>assertPreserved(stack(),changed),/parameters changed/);
 const health={status:'ok',enabled:true,customerAccountsEnabled:true,customerTotpEnabled:true,subscriptionBillingEnabled:true};
 assertHealthPreserved(health,{...health});assert.throws(()=>assertHealthPreserved(health,{...health,subscriptionBillingEnabled:false}));
});

test('processed template comparison rejects invisible stack-level edits and preserves arbitrary key order',()=>{
 const original={Parameters:{Secret:{NoEcho:true,Type:'String'}},Outputs:{ApiAccessBaseUrl:{Value:'original'}},Rules:{rule:{Assertions:[]}},Resources:{ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{FEATURE:'true'}}}},ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{old:true}}}}};
 const candidate=structuredClone(original);candidate.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};candidate.Resources.ApiAccessHttpApi.Properties.Body={updated:true};
 assertTemplateBoundary(original,candidate);
 for(const mutate of [v=>{delete v.Outputs.ApiAccessBaseUrl;},v=>{v.Parameters.Secret.Default='new';},v=>{delete v.Rules;},v=>{v.Resources.ApiAccessFunction.DeletionPolicy='Delete';},v=>{v.Resources.ApiAccessFunction.Properties.Environment.Variables.FEATURE='false';}]){
   const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertTemplateBoundary(original,bad),/protected template/);
 }
});
