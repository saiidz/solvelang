import test from "node:test";
import assert from "node:assert/strict";
import { captureWorkspace, importCloudProject, parseCloudWorkspace } from "./cloud-workspace";
import { createVersionSnapshot } from "./versions";
import { createSupportTriageDocument } from "./templates";
function storage() {
 const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);},clear:()=>data.clear(),key:()=>null,get length(){return data.size;}} as Storage;
}
test("account restore preserves existing projects even when source IDs collide",()=>{
 const local=storage(),document=createSupportTriageDocument();local.setItem("solvelang.studio.projects.v1",JSON.stringify([document]));
 const restored=importCloudProject(local,{document,versions:createVersionSnapshot(document,"Initial","",[]),traces:[]},"new-copy");
 assert.equal(captureWorkspace(local).projects[0].versions[0].document.id,"new-copy");
 assert.equal(restored.id,"new-copy");assert.equal(captureWorkspace(local).projects.length,2);
 assert.deepEqual(captureWorkspace(local).projects[1].document,document);
});
test("invalid, duplicate and oversized cloud snapshots are rejected",()=>{
 const document=createSupportTriageDocument(),project={document,versions:[],traces:[]};
 assert.throws(()=>parseCloudWorkspace({schemaVersion:1,projects:[project,project]}),/duplicate/);
 assert.throws(()=>parseCloudWorkspace({schemaVersion:1,projects:[{...project,document:{...document,nodes:null}}]}),/invalid/);
 assert.throws(()=>parseCloudWorkspace({schemaVersion:1,projects:[],padding:"x".repeat(262145)}),/256 KiB/);
});
test("failed restore preserves the local collection and removes partial history",()=>{
 const local=storage(),document=createSupportTriageDocument();local.setItem("solvelang.studio.projects.v1",JSON.stringify([document]));
 const original=local.getItem("solvelang.studio.projects.v1"),set=local.setItem;
 local.setItem=(key,value)=>{if(key==="solvelang.studio.projects.v1")throw new Error("quota");set(key,value);};
 assert.throws(()=>importCloudProject(local,{document,versions:[],traces:[]},"new-copy"),/storage is full/);
 assert.equal(local.getItem("solvelang.studio.projects.v1"),original);
 assert.equal(local.getItem("solvelang.studio.versions.v1.new-copy"),null);
});
test("corrupt local work is never silently replaced",()=>{
 const local=storage();local.setItem("solvelang.studio.projects.v1","broken JSON");
 assert.throws(()=>importCloudProject(local,{document:createSupportTriageDocument(),versions:[],traces:[]},"new-copy"));
 assert.equal(local.getItem("solvelang.studio.projects.v1"),"broken JSON");
});
