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
 assert.throws(()=>assertTemplateBoundary(original,arrayConditionalCors),/must be projected into the deployed definition/);
 for(const mutate of [v=>{delete v.Outputs.ApiAccessBaseUrl;},v=>{v.Parameters.Secret.Default='new';},v=>{v.Parameters.StudioAcceptanceOrigin.AllowedPattern='.*';},v=>{v.Conditions.StudioAcceptanceOriginConfigured={'Fn::Equals':['1','1']};},v=>{delete v.Rules;},v=>{v.Resources.ApiAccessFunction.DeletionPolicy='Delete';},v=>{v.Resources.ApiAccessFunction.Properties.Environment.Variables.FEATURE='false';},v=>{v.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN=previewOrigin;}]){
   const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertTemplateBoundary(original,bad),/Maintenance|Studio acceptance environment/);
 }
});

test('maintenance projection preserves deployed table and IAM settings despite source-template drift',()=>{
 const deployed={Parameters:{},Outputs:{Base:{Value:'stable'}},Resources:{
  ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{BILLING:'true'}}}},
  ApiKeyAuthorizerFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'}}},
  ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{allowOrigins:[{Ref:'SiteOrigin'}],allowMethods:['GET'],allowHeaders:['authorization'],allowCredentials:true}},Name:'stable'}},
  AdminCrmTable:{Type:'AWS::DynamoDB::Table',Properties:{PointInTimeRecoverySpecification:{PointInTimeRecoveryEnabled:true}}},
  Role:{Type:'AWS::IAM::Role',Properties:{Policies:['deployed-policy']}}
 }};
 const compiled=structuredClone(deployed);
 compiled.Parameters={StudioAcceptanceOrigin:structuredClone(acceptanceParameter)};
 compiled.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};
 compiled.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};
 compiled.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};
 compiled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com',previewOrigin],['https://www.solve-lang.com']]};
 compiled.Resources.ApiKeyAuthorizerFunction.Properties.Code={S3Key:'unauthorized-change'};
 compiled.Resources.AdminCrmTable.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled=false;
 compiled.Resources.Role.Properties.Policies=['source-policy'];
 const projectionOptions={siteOrigin:'https://www.solve-lang.com',studioAcceptanceOriginAction:'enable',studioAcceptanceOrigin:previewOrigin};
 const result=projectMaintenanceTemplate(deployed,compiled,projectionOptions);
 assert.deepEqual(result.Resources.ApiKeyAuthorizerFunction,deployed.Resources.ApiKeyAuthorizerFunction);
 assert.deepEqual(result.Resources.AdminCrmTable,deployed.Resources.AdminCrmTable);
 assert.deepEqual(result.Resources.Role,deployed.Resources.Role);
 assert.deepEqual(result.Resources.ApiAccessFunction.Properties.Code,{S3Key:'new'});
 assert.deepEqual(result.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN,{Ref:'StudioAcceptanceOrigin'});
 assert.deepEqual(result.Parameters.StudioAcceptanceOrigin,acceptanceParameter);
 const projectedBody=result.Resources.ApiAccessHttpApi.Properties.Body;
 assert.deepEqual(projectedBody['x-amazon-apigateway-cors'].allowOrigins,['https://www.solve-lang.com',previewOrigin]);
 assert.deepEqual(projectedBody['x-amazon-apigateway-cors'].allowMethods,['GET']);
 assert.deepEqual(projectedBody['x-amazon-apigateway-cors'].allowHeaders,['authorization']);
 assert.equal(projectedBody['x-amazon-apigateway-cors'].allowCredentials,true);
 assertTemplateBoundary(deployed,result,projectionOptions);
 const wrongOrigin=structuredClone(compiled);wrongOrigin.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][1]=['https://www.solve-lang.com','https://evil.example'];
 assert.throws(()=>projectMaintenanceTemplate(deployed,wrongOrigin,projectionOptions),/do not match the requested exact origin/);
 compiled.Outputs.Base.Value='changed';assert.throws(()=>projectMaintenanceTemplate(deployed,compiled,projectionOptions),/stack-level/);
});

test('maintenance projection validates disable and preserve-without-origin compiled CORS shapes',()=>{
 const deployed={Parameters:{},Outputs:{Base:{Value:'stable'}},Resources:{
  ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{BILLING:'true'}}}},
  ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{allowOrigins:['https://www.solve-lang.com',previewOrigin],allowMethods:['GET'],allowHeaders:['authorization'],allowCredentials:true}},Name:'stable'}},
 }};
 const corsSettings={allowMethods:['GET'],allowHeaders:['authorization'],allowCredentials:true};
 const buildCompiled=(cors)=>{ const compiled=structuredClone(deployed);
  compiled.Parameters={StudioAcceptanceOrigin:structuredClone(acceptanceParameter)};
  compiled.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};
  compiled.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};
  compiled.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};
  compiled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']=cors;
  return compiled; };
 // Regression for run 36336061193: a disable request sets StudioAcceptanceOrigin to '', so the
 // compiled guarded true branch carries the empty string as its second element instead of
 // collapsing to [siteOrigin]; the validator rejected that shape and disable could never plan.
 const disableOptions={siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'disable'};
 const originArrayDisable={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com',''],['https://www.solve-lang.com']]};
 const disabled=projectMaintenanceTemplate(deployed,buildCompiled(originArrayDisable),disableOptions);
 assert.deepEqual(disabled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins,['https://www.solve-lang.com']);
 assertTemplateBoundary(deployed,disabled,disableOptions);
 const wrappedDisable={'Fn::If':['StudioAcceptanceOriginConfigured',{...corsSettings,allowOrigins:['https://www.solve-lang.com','']},{...corsSettings,allowOrigins:['https://www.solve-lang.com']}]};
 const disabledWrapped=projectMaintenanceTemplate(deployed,buildCompiled(wrappedDisable),disableOptions);
 assert.deepEqual(disabledWrapped.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins,['https://www.solve-lang.com']);
 // Preserve with no origin configured compiles to the same empty-element true branch.
 const inactiveDeployed=structuredClone(deployed);
 inactiveDeployed.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins=['https://www.solve-lang.com'];
 const preservedInactive=projectMaintenanceTemplate(inactiveDeployed,buildCompiled(originArrayDisable),{siteOrigin:'https://www.solve-lang.com',studioAcceptanceOriginAction:'preserve'});
 assert.deepEqual(preservedInactive.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins,['https://www.solve-lang.com']);
 // Still fail closed: a foreign origin in either compiled branch is rejected on disable.
 const evilTrue={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com','https://evil.example'],['https://www.solve-lang.com']]};
 assert.throws(()=>projectMaintenanceTemplate(deployed,buildCompiled(evilTrue),disableOptions),/do not match the requested exact origin/);
 const evilFalse={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com',''],['https://www.solve-lang.com',previewOrigin]]};
 assert.throws(()=>projectMaintenanceTemplate(deployed,buildCompiled(evilFalse),disableOptions),/do not match the requested exact origin/);
});

test('pepper parameters, env references and log groups from #976/#978 are bounded additions; tampering fails closed', () => {
  const siteOrigin = 'https://solve-lang.com';
  const previewOrigin = 'https://studio-acceptance.d123.amplifyapp.com';
  const corsSettings = { allowMethods: ['GET'], allowHeaders: ['authorization'], allowCredentials: true };
  const secretDef = { NoEcho: true, MinLength: 32, Type: 'String' };
  const acceptanceDef = { Type: 'String', Default: '', Description: 'Exact dedicated Amplify acceptance-branch origin; blank disables it.', AllowedPattern: '^$|^https://studio-acceptance\\.d[a-z0-9]+\\.amplifyapp\\.com$' };
  const acceptanceCond = { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'StudioAcceptanceOrigin' }, ''] }] };
  const pepperDefinitions = {
    ApiKeyPepperPrevious: { Type: 'String', NoEcho: true, Default: '', Description: 'Previous API key pepper for dual-read rotation; blank means no rotation window.' },
    CustomerAuthPepperPrevious: { Type: 'String', NoEcho: true, Default: '', Description: 'Previous customer-auth pepper for dual-read rotation; blank means no rotation window.' },
  };
  const logGroup = fn => ({ Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: { 'Fn::Sub': '/aws/lambda/${' + fn + '}' }, RetentionInDays: 90 } });
  const stackValue = key => key === 'ApiAccessMode' ? 'live' : key.endsWith('Enabled') ? 'true' : key === 'SiteOrigin' ? siteOrigin : 'x'.repeat(32);
  const stackWith = keys => ({
    StackStatus: 'UPDATE_COMPLETE',
    Parameters: keys.map(ParameterKey => ({ ParameterKey, ParameterValue: stackValue(ParameterKey) })),
  });
  const baseKeys = ['ApiAccessMode', 'ApiAccessEnabled', 'CustomerAccountsEnabled', 'SiteOrigin', 'Secret', 'StudioAcceptanceOrigin'];
  const candidateTemplate = {
    Parameters: { ApiAccessMode: {}, ApiAccessEnabled: {}, CustomerAccountsEnabled: {}, SiteOrigin: {}, Secret: secretDef, StudioAcceptanceOrigin: acceptanceDef, ...structuredClone(pepperDefinitions) },
    Conditions: { StudioAcceptanceOriginConfigured: acceptanceCond },
  };
  const parameters = previousParameters(stackWith(baseKeys), candidateTemplate, { studioAcceptanceOriginAction: 'disable' });
  assert.deepEqual(parameters.find(({ ParameterKey }) => ParameterKey === 'ApiKeyPepperPrevious'), { ParameterKey: 'ApiKeyPepperPrevious', ParameterValue: '' });
  assert.deepEqual(parameters.find(({ ParameterKey }) => ParameterKey === 'CustomerAuthPepperPrevious'), { ParameterKey: 'CustomerAuthPepperPrevious', ParameterValue: '' });
  const tamperedDefinition = structuredClone(candidateTemplate);
  tamperedDefinition.Parameters.ApiKeyPepperPrevious.Default = 'rotated';
  assert.throws(() => previousParameters(stackWith(baseKeys), tamperedDefinition), /unexpected pepper parameter definition/);
  const unknownParameter = structuredClone(candidateTemplate);
  unknownParameter.Parameters.BrandNewParameter = { Type: 'String' };
  assert.throws(() => previousParameters(stackWith(baseKeys), unknownParameter), /cannot add or remove unrelated parameters/);
  assert.throws(() => previousParameters(stackWith([...baseKeys, 'ApiKeyPepperPrevious']), { Parameters: { ApiAccessMode: {}, ApiAccessEnabled: {}, CustomerAccountsEnabled: {}, SiteOrigin: {}, Secret: secretDef, StudioAcceptanceOrigin: acceptanceDef, CustomerAuthPepperPrevious: pepperDefinitions.CustomerAuthPepperPrevious } }), /cannot add or remove unrelated parameters/);

  const mkTemplate = additions => {
    const body = { openapi: '3.0.1', paths: {}, 'x-amazon-apigateway-cors': { 'Fn::If': ['StudioAcceptanceOriginConfigured', [siteOrigin, ''], [siteOrigin]] } };
    const value = {
      Parameters: { SiteOrigin: {}, Secret: secretDef, StudioAcceptanceOrigin: acceptanceDef },
      Conditions: { StudioAcceptanceOriginConfigured: acceptanceCond },
      Outputs: { Base: { Value: 'stable' } },
      Resources: {
        ApiAccessFunction: { Type: 'AWS::Lambda::Function', Properties: { Code: { S3Bucket: 'bucket', S3Key: 'old' }, Environment: { Variables: { BILLING: 'true', STUDIO_ACCEPTANCE_ORIGIN: { Ref: 'StudioAcceptanceOrigin' } } } } },
        ApiKeyAuthorizerFunction: { Type: 'AWS::Lambda::Function', Properties: { Code: { S3Bucket: 'bucket', S3Key: 'old' }, Environment: { Variables: { API_KEY_PEPPER: { Ref: 'ApiKeyPepper' } } } } },
        PublicStatusCollectorFunction: { Type: 'AWS::Serverless::Function', Properties: { Code: { S3Bucket: 'bucket', S3Key: 'old' } } },
        ApiAccessHttpApi: { Type: 'AWS::ApiGatewayV2::Api', Properties: { Body: body } },
        AdminCrmTable: { Type: 'AWS::DynamoDB::Table', Properties: { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } } },
      },
    };
    if (additions) {
      Object.assign(value.Parameters, structuredClone(pepperDefinitions));
      value.Resources.ApiAccessFunction.Properties.Code.S3Key = 'new';
      value.Resources.ApiAccessFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS = { Ref: 'ApiKeyPepperPrevious' };
      value.Resources.ApiAccessFunction.Properties.Environment.Variables.API_CUSTOMER_AUTH_PEPPER_PREVIOUS = { Ref: 'CustomerAuthPepperPrevious' };
      value.Resources.ApiKeyAuthorizerFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS = { Ref: 'ApiKeyPepperPrevious' };
      value.Resources.ApiAccessFunctionLogGroup = logGroup('ApiAccessFunction');
      value.Resources.PublicStatusCollectorFunctionLogGroup = logGroup('PublicStatusCollectorFunction');
      value.Resources.ApiKeyAuthorizerFunctionLogGroup = logGroup('ApiKeyAuthorizerFunction');
    }
    return value;
  };
  const deployedBefore = mkTemplate(false);
  deployedBefore.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'] = { allowOrigins: [siteOrigin, previewOrigin], ...corsSettings };
  const projected = projectMaintenanceTemplate(deployedBefore, mkTemplate(true), {
    siteOrigin, currentStudioAcceptanceOrigin: previewOrigin, studioAcceptanceOriginAction: 'disable',
  });
  assert.deepEqual(projected.Parameters.ApiKeyPepperPrevious, pepperDefinitions.ApiKeyPepperPrevious);
  assert.deepEqual(projected.Parameters.CustomerAuthPepperPrevious, pepperDefinitions.CustomerAuthPepperPrevious);
  assert.deepEqual(projected.Resources.ApiAccessFunctionLogGroup, logGroup('ApiAccessFunction'));
  assert.deepEqual(projected.Resources.PublicStatusCollectorFunctionLogGroup, logGroup('PublicStatusCollectorFunction'));
  assert.deepEqual(projected.Resources.ApiKeyAuthorizerFunctionLogGroup, logGroup('ApiKeyAuthorizerFunction'));
  assert.deepEqual(projected.Resources.ApiAccessFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS, { Ref: 'ApiKeyPepperPrevious' });
  assert.deepEqual(projected.Resources.ApiAccessFunction.Properties.Environment.Variables.API_CUSTOMER_AUTH_PEPPER_PREVIOUS, { Ref: 'CustomerAuthPepperPrevious' });
  assert.deepEqual(projected.Resources.ApiKeyAuthorizerFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS, { Ref: 'ApiKeyPepperPrevious' });
  assert.deepEqual(projected.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'].allowOrigins, [siteOrigin]);
  assert.deepEqual(projected.Resources.AdminCrmTable, deployedBefore.Resources.AdminCrmTable);

  const tamperedGroup = mkTemplate(true);
  tamperedGroup.Resources.ApiAccessFunctionLogGroup.Properties.RetentionInDays = 30;
  assert.throws(() => projectMaintenanceTemplate(deployedBefore, tamperedGroup, { siteOrigin, currentStudioAcceptanceOrigin: previewOrigin, studioAcceptanceOriginAction: 'disable' }), /Unexpected maintenance log group/);
  const literalEnv = mkTemplate(true);
  literalEnv.Resources.ApiKeyAuthorizerFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS = 'literal-secret-value';
  assert.throws(() => projectMaintenanceTemplate(deployedBefore, literalEnv, { siteOrigin, currentStudioAcceptanceOrigin: previewOrigin, studioAcceptanceOriginAction: 'disable' }), /Pepper environment must reference only its bounded parameter/);
  const wrongReference = mkTemplate(true);
  wrongReference.Resources.ApiAccessFunction.Properties.Environment.Variables.API_KEY_PEPPER_PREVIOUS = { Ref: 'CustomerAuthPepperPrevious' };
  assert.throws(() => projectMaintenanceTemplate(deployedBefore, wrongReference, { siteOrigin, currentStudioAcceptanceOrigin: previewOrigin, studioAcceptanceOriginAction: 'disable' }), /Pepper environment must reference only its bounded parameter/);

  const stackParams = entries => ({ Parameters: entries.map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })) });
  const beforeDeploy = stackParams([['ApiAccessMode', 'live'], ['SiteOrigin', siteOrigin], ['StudioAcceptanceOrigin', previewOrigin]]);
  const afterDeploy = stackParams([['ApiAccessMode', 'live'], ['SiteOrigin', siteOrigin], ['StudioAcceptanceOrigin', ''], ['ApiKeyPepperPrevious', '****'], ['CustomerAuthPepperPrevious', '****']]);
  assert.doesNotThrow(() => assertPreserved(beforeDeploy, afterDeploy, { studioAcceptanceOriginAction: 'disable' }));
  assert.throws(() => assertPreserved(afterDeploy, beforeDeploy, { studioAcceptanceOriginAction: 'preserve' }), /Production parameters changed/);
  const deployedWithOrigin = stackParams([['ApiAccessMode', 'live'], ['SiteOrigin', siteOrigin], ['StudioAcceptanceOrigin', previewOrigin], ['ApiKeyPepperPrevious', '****'], ['CustomerAuthPepperPrevious', '****']]);
  assert.doesNotThrow(() => assertPreserved(deployedWithOrigin, beforeDeploy, { rollback: true }));

  const logGroupChange = (id, action) => ({ Type: 'Resource', ResourceChange: { Action: action, LogicalResourceId: id, ResourceType: 'AWS::Logs::LogGroup', Replacement: 'False', Scope: ['Properties'], Details: [] } });
  assert.doesNotThrow(() => assertMaintenanceChanges([
    change('ApiAccessFunction', 'AWS::Lambda::Function', 'Environment.Variables.API_KEY_PEPPER_PREVIOUS'),
    change('ApiKeyAuthorizerFunction', 'AWS::Lambda::Function', 'Environment.Variables.API_KEY_PEPPER_PREVIOUS'),
    logGroupChange('ApiAccessFunctionLogGroup', 'Add'),
    logGroupChange('PublicStatusCollectorFunctionLogGroup', 'Add'),
    logGroupChange('ApiKeyAuthorizerFunctionLogGroup', 'Add'),
  ]));
  assert.doesNotThrow(() => assertMaintenanceChanges([logGroupChange('ApiAccessFunctionLogGroup', 'Remove')], { rollback: true }));
  assert.throws(() => assertMaintenanceChanges([change('ApiKeyAuthorizerFunction', 'AWS::Lambda::Function', 'Environment')]), /Maintenance refuses/);
  assert.throws(() => assertMaintenanceChanges([logGroupChange('UnrelatedLogGroup', 'Add')]), /Maintenance refuses/);
});

test('maintenance projection stamps resolved origins into condition-wrapped deployed CORS definitions',()=>{
 const corsSettings={allowMethods:['GET'],allowHeaders:['authorization'],allowCredentials:true};
 const deployed={Parameters:{},Outputs:{Base:{Value:'stable'}},Resources:{
  ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{BILLING:'true'}}}},
  ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{'Fn::If':['StudioAcceptanceOriginConfigured',{...corsSettings,allowOrigins:[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}]},{...corsSettings,allowOrigins:[{Ref:'SiteOrigin'}]}]}},Name:'stable'}},
 }};
 const buildCompiled=(cors)=>{ const compiled=structuredClone(deployed);
  compiled.Parameters={StudioAcceptanceOrigin:structuredClone(acceptanceParameter)};
  compiled.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};
  compiled.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};
  compiled.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};
  compiled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']=cors;
  return compiled; };
 const originArrayDisable={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com',''],['https://www.solve-lang.com']]};
 const disableOptions={siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'disable'};
 // Regression for run 40945881751: the deployed body carries its CORS as a condition-wrapped
 // extension, which replaceCorsOrigins did not handle, so the disable plan failed closed.
 const disabled=projectMaintenanceTemplate(deployed,buildCompiled(originArrayDisable),disableOptions);
 const wrapped=disabled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'];
 assert.deepEqual(wrapped[1].allowOrigins,['https://www.solve-lang.com']);
 assert.deepEqual(wrapped[2].allowOrigins,['https://www.solve-lang.com']);
 assert.deepEqual(wrapped[1].allowMethods,['GET']);
 assert.equal(wrapped[2].allowCredentials,true);
 assertTemplateBoundary(deployed,disabled,disableOptions);
 // Origins-only conditional deployed definition projects to the direct definition.
 const arrayDeployed=structuredClone(deployed);
 arrayDeployed.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['StudioAcceptanceOriginConfigured',[{Ref:'SiteOrigin'},{Ref:'StudioAcceptanceOrigin'}],[{Ref:'SiteOrigin'}]]};
 const disabledArray=projectMaintenanceTemplate(arrayDeployed,buildCompiled(originArrayDisable),disableOptions);
 assert.deepEqual(disabledArray.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors'],{allowOrigins:['https://www.solve-lang.com']});
 assertTemplateBoundary(arrayDeployed,disabledArray,disableOptions);
 // A deployed definition with settings but no origin list still fails closed, naming its keys.
 const noOrigins=structuredClone(deployed);
 noOrigins.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={allowMethods:['GET'],allowHeaders:['authorization']};
 assert.throws(()=>projectMaintenanceTemplate(noOrigins,buildCompiled(originArrayDisable),disableOptions),/no explicit origin list \(found keys: allowHeaders, allowMethods/);
});

test('maintenance origin baseline failure names the observed deployed origins',()=>{
 const body=(cors)=>({openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':cors});
 const before={Parameters:{},Resources:{ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:body({allowOrigins:['https://example.com'],allowMethods:['GET']})}}}};
 const after=structuredClone(before);
 after.Resources.ApiAccessHttpApi.Properties.Body=body({allowOrigins:['https://www.solve-lang.com'],allowMethods:['GET']});
 assert.throws(()=>assertTemplateBoundary(before,after,{siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'disable'}),/changes the existing API Gateway origin \(observed condition: none; observed variant origins: .*example\.com/);
});

test('maintenance baseline accepts the literal condition-wrapped deployed CORS definition',()=>{
 const corsSettings={allowMethods:['GET'],allowHeaders:['authorization'],allowCredentials:true};
 const deployed={Parameters:{},Outputs:{Base:{Value:'stable'}},Resources:{
  ApiAccessFunction:{Type:'AWS::Lambda::Function',Properties:{Code:{S3Key:'old'},Environment:{Variables:{BILLING:'true'}}}},
  ApiAccessHttpApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Body:{openapi:'3.0.1',paths:{},'x-amazon-apigateway-cors':{'Fn::If':['StudioAcceptanceOriginConfigured',{...corsSettings,allowOrigins:['https://www.solve-lang.com',previewOrigin]},{...corsSettings,allowOrigins:['https://www.solve-lang.com']}]}},Name:'stable'}},
 }};
 const compiled=structuredClone(deployed);
 compiled.Parameters={StudioAcceptanceOrigin:structuredClone(acceptanceParameter)};
 compiled.Conditions={StudioAcceptanceOriginConfigured:structuredClone(acceptanceCondition)};
 compiled.Resources.ApiAccessFunction.Properties.Code={S3Key:'new'};
 compiled.Resources.ApiAccessFunction.Properties.Environment.Variables.STUDIO_ACCEPTANCE_ORIGIN={Ref:'StudioAcceptanceOrigin'};
 compiled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']={'Fn::If':['StudioAcceptanceOriginConfigured',['https://www.solve-lang.com',''],['https://www.solve-lang.com']]};
 const disableOptions={siteOrigin:'https://www.solve-lang.com',currentStudioAcceptanceOrigin:previewOrigin,studioAcceptanceOriginAction:'disable'};
 // Regression for run 41054262317: the deployed body carries literal origins, which the
 // Ref-only baselineConditional did not recognise, so the disable plan failed closed.
 const disabled=projectMaintenanceTemplate(deployed,compiled,disableOptions);
 const wrapped=disabled.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'];
 assert.deepEqual(wrapped[1].allowOrigins,['https://www.solve-lang.com']);
 assert.deepEqual(wrapped[2].allowOrigins,['https://www.solve-lang.com']);
 assertTemplateBoundary(deployed,disabled,disableOptions);
 // A literal acceptance origin that differs from the deployed parameter still fails closed.
 const drifted=structuredClone(deployed);
 drifted.Resources.ApiAccessHttpApi.Properties.Body['x-amazon-apigateway-cors']['Fn::If'][1].allowOrigins=['https://www.solve-lang.com','https://studio-acceptance.d999.amplifyapp.com'];
 assert.throws(()=>assertTemplateBoundary(drifted,disabled,disableOptions),/changes the existing API Gateway origin/);
});
