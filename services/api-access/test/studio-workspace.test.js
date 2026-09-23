import test from "node:test";
import assert from "node:assert/strict";
import { createStudioWorkspaceHandler, createStudioWorkspaceStore, validateWorkspace } from "../src/studio-workspace.js";
import { ApiAccessError } from "../src/service.js";
const empty = { schemaVersion: 1, projects: [] };
const previewOrigin = "https://studio-acceptance.dabcdef123456.amplifyapp.com";
function fixture({ studioAcceptanceOrigin } = {}) {
  const rows = new Map(), calls = [];
  const client = { async send(command) {
    const input = command.input; calls.push(input);
    if (command.constructor.name === "GetCommand") return { Item: rows.get(input.Key.authKey) };
    const prior = rows.get(input.Item.authKey);
    const expected = input.ExpressionAttributeValues?.[":expected"];
    if (expected === undefined ? prior : !prior || prior.revision !== expected || prior.accountId !== input.Item.accountId) {
      throw Object.assign(new Error("conditional write"), { name: "ConditionalCheckFailedException" });
    }
    rows.set(input.Item.authKey, structuredClone(input.Item)); return {};
  } };
  const store = createStudioWorkspaceStore(client, "auth-test");
  let accountId = "account-A";
  const customerAuth = {
    async authenticate(cookie) { if (cookie !== "session=valid") throw new ApiAccessError(401,"invalid_session","Sign in."); return { accountId, csrfToken:"csrf" }; },
    assertCsrf(session, token) { if (token !== session.csrfToken) throw new ApiAccessError(403,"csrf","CSRF required."); },
  };
  const handler = createStudioWorkspaceHandler({ enabled:true, customerAuth, store, siteOrigin:"https://solve.test", studioAcceptanceOrigin });
  const request = (method, body, headers={}) => handler({ requestContext:{http:{method}}, cookies:["session=valid"], headers:{origin:"https://solve.test","x-solvelang-csrf":"csrf",...headers},body:JSON.stringify(body) });
  return {store,rows,calls,request,handler,switchAccount:()=>{accountId="account-B";}};
}
test("save, restart/read, and delete preserve revision history and account isolation",async()=>{
 const f=fixture();assert.equal((await f.store.read("account-A")).revision,0);
 await f.store.write("account-A",0,empty);
 assert.equal((await createStudioWorkspaceStore({send:async()=>({Item:f.rows.get("studio-workspace#account-A")})},"auth-test").read("account-A")).revision,1);
 assert.equal((await f.store.read("account-B")).revision,0);
 await f.store.write("account-A",1,empty);assert.equal((await f.store.read("account-A")).revision,2);
 assert.equal(f.calls[0].ConsistentRead,true);
});
test("concurrent devices cannot silently overwrite each other",async()=>{
 const f=fixture();const outcomes=await Promise.allSettled([f.store.write("A",0,empty),f.store.write("A",0,empty)]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(outcomes.find(x=>x.status==="rejected").reason.statusCode,409);
 await assert.rejects(f.store.write("A",0,empty),{statusCode:409});
});
test("session, CSRF, origin and account switching all fail before writes",async()=>{
 const f=fixture(),body={accountId:"account-A",expectedRevision:0,workspace:empty};
 assert.equal((await f.request("POST",body,{cookie:"bad"})).statusCode,401);
 assert.equal((await f.request("POST",body,{"x-solvelang-csrf":"bad"})).statusCode,403);
 assert.equal((await f.request("POST",body,{origin:"https://evil.test"})).statusCode,403);
 f.switchAccount();assert.equal((await f.request("POST",body)).statusCode,409);assert.equal(f.rows.size,0);
});
test("only the configured Amplify preview origin is accepted for Studio workspace requests",async()=>{
 const f=fixture({studioAcceptanceOrigin:previewOrigin});
 const preflight=await f.request("OPTIONS",undefined,{origin:previewOrigin});
 assert.equal(preflight.statusCode,204);assert.equal(preflight.headers["access-control-allow-origin"],previewOrigin);
 const connected=await f.request("GET",undefined,{origin:previewOrigin});
 assert.equal(connected.statusCode,200);assert.equal(JSON.parse(connected.body).accountId,"account-A");
 const writes=f.calls.length;
 const denied=await f.request("POST",{accountId:"account-A",expectedRevision:0,workspace:empty},{origin:"https://studio-acceptance.dattacker.amplifyapp.com"});
 assert.equal(denied.statusCode,403);assert.equal(f.calls.length,writes);
});
test("authenticated roundtrip accepts HTTP API cookies and returns no other account data",async()=>{
 const f=fixture();assert.equal((await f.request("POST",{accountId:"account-A",expectedRevision:0,workspace:empty})).statusCode,200);
 const saved=JSON.parse((await f.request("GET")).body);assert.equal(saved.accountId,"account-A");assert.equal(saved.revision,1);
 f.switchAccount();assert.equal(JSON.parse((await f.request("GET")).body).revision,0);
});
test("bounded storage rejects duplicates, oversize snapshots and invalid revisions",async()=>{
 assert.throws(()=>validateWorkspace({schemaVersion:1,projects:[],padding:"x".repeat(262145)}),{statusCode:413});
 assert.throws(()=>validateWorkspace({schemaVersion:1,projects:Array(51).fill({})}),{statusCode:400});
 const f=fixture();await assert.rejects(f.store.write("A",-1,empty),{statusCode:400});
 assert.equal((await f.request("POST",{accountId:"account-A",workspace:empty})).statusCode,400);
});
test("disabled backend and storage failures preserve a sanitized error",async()=>{
 const disabled=createStudioWorkspaceHandler({enabled:false,siteOrigin:"https://solve.test"});
 assert.equal((await disabled({requestContext:{http:{method:"GET"}}})).statusCode,503);
 const handler=createStudioWorkspaceHandler({enabled:true,siteOrigin:"https://solve.test",customerAuth:{authenticate:async()=>({accountId:"A"})},store:{read:async()=>{throw new Error("private workflow content");}}});
 const r=await handler({requestContext:{http:{method:"GET"}}});assert.equal(r.statusCode,500);assert.doesNotMatch(r.body,/private workflow/);
});
