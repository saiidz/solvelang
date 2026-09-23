import test from 'node:test';
import assert from 'node:assert/strict';
import { previousParameters, assertMaintenanceChanges, assertPreserved, assertHealthPreserved, assertTemplateBoundary, projectMaintenanceTemplate } from '../scripts/production-maintenance.mjs';
const stack = () => ({StackStatus:'UPDATE_COMPLETE',Parameters:[['ApiAccessMode','live'],['ApiAccessEnabled','true'],['CustomerAccountsEnabled','true'],['SubscriptionBillingEnabled','true'],['Secret','****']].map(([ParameterKey,ParameterValue])=>({ParameterKey,ParameterValue}))});
const previewOrigin='https://studio-acceptance.dabcdef123456.amplifyapp.com';
const acceptanceParameter={Type:'String',Default:'',Description:'Exact dedicated Amplify acceptance-branch origin; blank disables it.',AllowedPattern:'^$|^https://studio-acceptance\\.d[a-z0-9]+\\.amplifyapp\\.com$'};
const acceptanceCondition={'Fn::Not':[{'Fn::Equals':[{Ref:'StudioAcceptanceOrigin'},'']}]};
const template = () => ({Parameters:{...Object.fromEntries(stack().Parameters.map(p=>[p.ParameterKey,{}])),StudioAcceptanceOrigin:structuredClone(acceptanceParameter)},Conditions:{StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)}});
const change = (id='ApiAccessFunction',type='AWS::Lambda::Function',property='Code') => ({Type:'Resource',ResourceChange:{Action:'Modify',LogicalResourceId:id,ResourceType:type,Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:property,RequiresRecreation:'Never'}}]}});
test('every parameter including secrets and enabled billing uses previous value',()=>{
 const result=previousParameters(stack(),template());
 assert.equal(result.length,5);assert.ok(result.every(p=>p.UsePreviousValue===true && !('ParameterValue' in p)));
 const enabling=previousParameters(stack(),template(),{studioAcceptanceOriginAction:'enable',studioAcceptanceOrigin:previewOrigin});
 assert.deepEqual(enabling.find(p=>p.ParameterKey==='StudioAcceptanceOrigin'),{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:previewOrigin});
 assert.deepEqual(previousParameters(stack(),template(),{studioAcceptanceOriginAction:'disable'}).find(p=>p.ParameterKey==='StudioAcceptanceOrigin'),{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:''});
 assert.throws(()=>previousParameters(stack(),template(),{studioAcceptanceOriginAction:'enable',studioAcceptanceOrigin:'https://evil.example'}));
 const alreadyConfigured={...stack(),Parameters:[...stack().Parameters,{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:previewOrigin}]};
 const preserved=previousParameters(alreadyConfigured,template());
 assert.deepEqual(preserved.find(p=>p.ParameterKey==='StudioAcceptanceOrigin'),{ParameterKey:'StudioAcceptanceOrigin',UsePreviousValue:true});
 assert.equal(preserved.filter(p=>p.ParameterKey==='StudioAcceptanceOrigin').length,1);
 for(const action of ['enable','disable'])assert.equal(previousParameters(alreadyConfigured,template(),{studioAcceptanceOriginAction:action,studioAcceptanceOrigin:action==='enable'?previewOrigin:''}).filter(p=>p.ParameterKey==='StudioAcceptanceOrigin').length,1);
 const modified=template();modified.Parameters.NewFlag={Default:'false'};
 assert.throws(()=>previousParameters(stack(),modified));
 assert.throws(()=>previousParameters({...stack(),StackStatus:'UPDATE_IN_PROGRESS'},template()));
});
test('code, route and bounded acceptance-environment updates pass; replacements, IAM, storage and deletions fail closed',()=>{
 assertMaintenanceChanges([change(),change('ApiAccessHttpApi','AWS::ApiGatewayV2::Api','Body')]);
 assertMaintenanceChanges([change('ApiAccessFunction','AWS::Lambda::Function','Environment')]);
 for(const target of ['Environment','Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN']){
  const combined=change();combined.ResourceChange.Details.push({Target:{Attribute:'Properties',Name:target,RequiresRecreation:'Never'}});
  assertMaintenanceChanges([combined]);
 }
 const unrelatedEnvironment=change();unrelatedEnvironment.ResourceChange.Details.push({Target:{Attribute:'Properties',Name:'Environment.Variables.UNRELATED_SETTING',RequiresRecreation:'Never'}});
 assert.throws(()=>assertMaintenanceChanges([unrelatedEnvironment]));
 for(const c of [change('ApiKeyAuthorizerFunction','AWS::Lambda::Function','Environment'),change('ApiKeyAuthorizerFunction','AWS::Lambda::Function','Code'),change('Table','AWS::DynamoDB::Table','BillingMode'),change('Role','AWS::IAM::Role','Policies'),{Type:'Resource',ResourceChange:{...change().ResourceChange,Replacement:'Conditional'}},{Type:'Resource',ResourceChange:{...change().ResourceChange,Action:'Remove'}}])assert.throws(()=>assertMaintenanceChanges([c]));
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
 const withAcceptance={...stack(),Parameters:[...stack().Parameters,{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:previewOrigin}]};
 assertPreserved(stack(),withAcceptance,{studioAcceptanceOriginAction:'enable',studioAcceptanceOrigin:previewOrigin});
 const disabledAcceptance={...stack(),Parameters:[...stack().Parameters,{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:''}]};
 assertPreserved(stack(),disabledAcceptance,{studioAcceptanceOriginAction:'disable'});
 const unexpected={...stack(),Parameters:[...stack().Parameters,{ParameterKey:'StudioAcceptanceOrigin',ParameterValue:'https://studio-acceptance.dattacker.amplifyapp.com'}]};
 assert.throws(()=>assertPreserved(stack(),unexpected,{studioAcceptanceOriginAction:'enable',studioAcceptanceOrigin:previewOrigin}),/acceptance origin/);
 const health={status:'ok',enabled:true,customerAccountsEnabled:true,customerTotpEnabled:true,subscriptionBillingEnabled:true};
 assertHealthPreserved(health,{...health});assert.throws(()=>assertHealthPreserved(health,{...health,subscriptionBillingEnabled:false}));
});

test('processed template comparison rejects invisible stack-level edits and preserves arbitrary key order',()=>{
 const corsBody=()=>({openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{allowOrigins:[{Ref:'SiteOrigin'}],allowMethods:['GET'],allowHeaders:['authorization']}});
 const original={Parameters:{Secret:{NoEcho:true,Type:'String'}},Outputs:{ApiAccessBaseUrl:{Value:'original'}},Rules:{rule:{Assertions:[]}},Resources:{ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{FEATURE:'true'}}}},ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:corsBody()}}}};
 const candidate=structuredClone(original);candidate.Parameters.StudioAcceptanceOrigin=structuredClone(acceptanceParameter);candidate.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};candidate.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};candidate.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};candidate.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins={'Fn::If':['StudioAcceptanceOriginConfigured',[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}],[{Ref:'SiteOrigin'}]]};
 assertTemplateBoundary(original,candidate);
 const literalOrigins=structuredClone(candidate);literalOrigins.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins=['https://www.solve-lang.com',previewOrigin];assertTemplateBoundary(original,literalOrigins,{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'enable'});
 const wrappedCors=structuredClone(candidate);const corsSettings=structuredClone(corsBody()['x-amazon-apigateway-cors']);
 wrappedCors.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['StudioAcceptanceOriginConfigured',{...corsSettings,allowOrigins:[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}]},{...corsSettings,allowOrigins:[{Ref:'SiteOrigin'}]}]};
 assertTemplateBoundary(original,wrappedCors,{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'enable'});
 const activeWrappedBefore=structuredClone(original);activeWrappedBefore.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']=structuredClone(wrappedCors.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']);
 assertTemplateBoundary(activeWrappedBefore,activeWrappedBefore,{siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'preserve'});
 const branchSettingsBefore=structuredClone(activeWrappedBefore);branchSettingsBefore.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][1].allowMethods=['GET'];branchSettingsBefore.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][2].allowMethods=['POST'];
 const swappedBranchSettings=structuredClone(branchSettingsBefore);[swappedBranchSettings.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][1].allowMethods,swappedBranchSettings.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][2].allowMethods]=[['POST'],['GET']];
 assert.throws(()=>assertTemplateBoundary(branchSettingsBefore,swappedBranchSettings,{siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'preserve'}),/settings beyond the CORS origin list/);
 const wrappedCorsDrift=structuredClone(wrappedCors);wrappedCorsDrift.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][1].allowMethods=['GET','POST'];
 assert.throws(()=>assertTemplateBoundary(original,wrappedCorsDrift,{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'enable'}),/settings beyond the CORS origin list/);
 const unexpectedOrigin=structuredClone(literalOrigins);unexpectedOrigin.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins.push('https://evil.example');assert.throws(()=>assertTemplateBoundary(original,unexpectedOrigin,{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'enable'}),/unexpected API Gateway CORS origin/);
 const activeBefore=structuredClone(original);activeBefore.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins=['https://www.solve-lang.com',previewOrigin];
 const activePreserve=structuredClone(activeBefore);assertTemplateBoundary(activeBefore,activePreserve,{siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'preserve'});
 const activeDisable=structuredClone(activeBefore);activeDisable.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins=['https://www.solve-lang.com'];assertTemplateBoundary(activeBefore,activeDisable,{siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'disable'});
 const inactivePreserve=structuredClone(original);inactivePreserve.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins=['https://www.solve-lang.com'];assertTemplateBoundary(original,inactivePreserve,{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOriginAction:'preserve'});
 const stringBody=structuredClone(candidate);stringBody.Resources.ApiAccessHttpApi.Properties.Body=JSON.stringify(stringBody.Resources.ApiAccessHttpApi.Properties.Body);assertTemplateBoundary(original,stringBody);
 const apiDrift=structuredClone(candidate);apiDrift.Resources.ApiAccessHttpApi.Properties.Body.paths['/unexpected']={};assert.throws(()=>assertTemplateBoundary(original,apiDrift),/API Gateway settings/);
 const transformedCorsShape=structuredClone(candidate);transformedCorsShape.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={allowCredentials:true};
 assert.throws(()=>assertTemplateBoundary(original,transformedCorsShape),/proposed branch .*allowCredentials/);
 const unknownConditionalCors=structuredClone(candidate);unknownConditionalCors.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['OtherCondition',{corsConfiguration:{}},{corsConfiguration:{}}]};
 assert.throws(()=>assertTemplateBoundary(original,unknownConditionalCors),/branch shapes: object\{corsConfiguration:object\{\}\}; object\{corsConfiguration:object\{\}\}/);
 const arrayConditionalCors=structuredClone(candidate);arrayConditionalCors.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['StudioAcceptanceOriginConfigured',[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}],[{Ref:'SiteOrigin'}]]};
 assert.throws(()=>assertTemplateBoundary(original,arrayConditionalCors),/branch shapes: array\(2\)<Ref\(SiteOrigin\),Ref\(StudioAcceptanceOrigin\)>; array\(1\)<Ref\(SiteOrigin\)>/);
 for(const mutate of [v=>{delete v.Outputs.ApiAccessBaseUrl;},v=>{v.Parameters.Secret.Default='new';},v=>{v.Parameters.StudioAcceptanceOrigin.AllowedPattern='.*';},v=>{v.Conditions.StudioAcceptanceOriginConfigured={'Fn::Equals':['1','1']};},v=>{delete v.Rules;},v=>{v.Resources.ApiAccessFunction.DeletionPolicy='Delete';},v=>{v.Resources.ApiAccessFunction.Properties.Environment.Variables.FEATURE='false';},v=>{v.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN=previewOrigin;}]){
   const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertTemplateBoundary(original,bad),/Maintenance|Studio acceptance environment/);
 }
});

test('maintenance projection preserves deployed table and IAM settings despite source-template drift',()=>{
 const deployed={Parameters:{},Outputs:{Base:{Value:'stable'}},Resources:{
  ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{BILLING:'true'}}}},
  ApiKeyAuthorizerFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'}}},
  ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{allowOrigins:[{Ref:'SiteOrigin'}],allowMethods:['GET'],allowHeaders:['authorization']}},Name:'stable'}},
  AdminCrmTable:{Type:'AWS::DynamoDB::Table',Properties:{PointInTimeRecoverySpecification:{PointInTimeRecoveryEnabled:true}}},
  Role:{Type:'AWS::IAM::Role',Properties:{Policies:['deployed-policy']}}
 }};
 const compiled=structuredClone(deployed);
 compiled.Parameters={StudioAcceptanceOrigin:structuredClone(acceptanceParameter)};
 compiled.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};
 compiled.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};
 compiled.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};
 compiled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins={'Fn::If':['StudioAcceptanceOriginConfigured',[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}],[{Ref:'SiteOrigin'}]]};
 compiled.Resources.ApiKeyAuthorizerFunction.Properties.Code={S3Key:'unauthorized-change'};
 compiled.Resources.AdminCrmTable.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled=false;
 compiled.Resources.Role.Properties.Policies=['source-policy'];
 const result=projectMaintenanceTemplate(deployed,compiled);
 assert.deepEqual(result.Resources.ApiKeyAuthorizerFunction,deployed.Resources.ApiKeyAuthorizerFunction);
 assert.deepEqual(result.Resources.AdminCrmTable,deployed.Resources.AdminCrmTable);
 assert.deepEqual(result.Resources.Role,deployed.Resources.Role);
 assert.deepEqual(result.Resources.ApiAccessFunction.Properties.Code,{S3Key:'new'});
 assert.deepEqual(result.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN,{Ref:'StudioAcceptanceOrigin'});
 assert.deepEqual(result.Parameters.StudioAcceptanceOrigin,acceptanceParameter);
 assert.deepEqual(result.Resources.ApiAccessHttpApi.Properties.Body,compiled.Resources.ApiAccessHttpApi.Properties.Body);
 assertTemplateBoundary(deployed,result);
 compiled.Outputs.Base.Value='changed';assert.throws(()=>projectMaintenanceTemplate(deployed,compiled),/stack-level/);
});
