"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { customerApi, normalizeApiBase } from "../../account/core/customer-api";
import { captureWorkspace, importCloudProject, parseCloudWorkspace, type CloudWorkspace } from "../core/cloud-workspace";
import { downloadText } from "../core/exports";
import type { WorkflowDocument } from "../core/types";
import styles from "../studio.module.css";

type Remote = { accountId: string; csrfToken: string; revision: number; workspace: CloudWorkspace; updatedAt: string | null };
export default function AccountWorkspace({ localStatus, projects, onOpen }: { localStatus: string; projects: WorkflowDocument[]; onOpen: (document: WorkflowDocument) => void }) {
  const [remote,setRemote]=useState<Remote|null>(null);
  const [status,setStatus]=useState("Local saving is active. Connect to save a private account copy across devices.");
  const [busy,setBusy]=useState(false);
  const [autosave,setAutosave]=useState(false);
  const remoteRef=useRef<Remote|null>(null), inFlight=useRef(false), generation=useRef(0), lastSaved=useRef("");
  const base=normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
  const connect=async()=>{
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setAutosave(false);remoteRef.current=null;setRemote(null);lastSaved.current="";const epoch=++generation.current;
    try {
      const result=await customerApi<Remote>(base,"/customer/studio/workspace");
      result.workspace=parseCloudWorkspace(result.workspace);
      if(epoch!==generation.current)return;
      remoteRef.current=result;setRemote(result);
      setStatus(`Connected to account ${result.accountId}. ${result.workspace.projects.length} saved projects. Nothing has been uploaded.`);
    }catch(error){setStatus(error instanceof Error?error.message:"Could not connect.");}
    finally{inFlight.current=false;setBusy(false);}
  };
  const save=async(enableAuto=false)=>{
    const current=remoteRef.current;if(!current||inFlight.current)return;
    const epoch=generation.current;
    try {
      if(localStatus!=="Saved locally")throw new Error("Wait for local saving to finish before saving to your account.");
      const workspace=captureWorkspace(window.localStorage), serialized=JSON.stringify(workspace);
      if(serialized===lastSaved.current){if(enableAuto)setAutosave(true);return;}
      inFlight.current=true;setBusy(true);
      const result=await customerApi<{accountId:string;revision:number;updatedAt:string}>(base,"/customer/studio/workspace",{
        method:"POST",csrfToken:current.csrfToken,body:JSON.stringify({accountId:current.accountId,expectedRevision:current.revision,workspace}),
      });
      if(epoch!==generation.current)return;
      const next={...current,...result,workspace};remoteRef.current=next;setRemote(next);lastSaved.current=serialized;
      if(enableAuto)setAutosave(true);
      setStatus("Saved to your account. Local projects are preserved.");
    }catch(error){setAutosave(false);setStatus(error instanceof Error?error.message:"Account saving failed. Local projects are preserved.");}
    finally{inFlight.current=false;setBusy(false);}
  };
  useEffect(()=>{
    if(!autosave||localStatus!=="Saved locally")return;
    const timer=window.setTimeout(()=>{void save();},1200);
    return()=>window.clearTimeout(timer);
  // Autosave observes completed local writes. A request never runs concurrently.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[autosave,localStatus,busy,projects]);
  const start=()=>{
    if(!remote)return;
    if(!window.confirm("Save all projects, versions, and traces from this browser to your signed-in account and enable autosave? This replaces the account snapshot; download its backup first if needed."))return;
    void save(true);
  };
  const remove=async()=>{
    const current=remoteRef.current;if(!current||inFlight.current)return;
    if(!window.confirm("Download a backup and remove all projects from your account snapshot? Browser projects will remain."))return;
    downloadText("solvelang-account-backup.json",JSON.stringify(current.workspace,null,2),"application/json");
    setAutosave(false);inFlight.current=true;setBusy(true);
    try{
      const result=await customerApi<{revision:number;updatedAt:string}>(base,"/customer/studio/workspace",{method:"POST",csrfToken:current.csrfToken,body:JSON.stringify({accountId:current.accountId,expectedRevision:current.revision,workspace:{schemaVersion:1,projects:[]}})});
      const next={...current,...result,workspace:{schemaVersion:1 as const,projects:[]}};remoteRef.current=next;setRemote(next);lastSaved.current="";setStatus("Account snapshot removed. Browser projects are unchanged.");
    }catch(error){setStatus(error instanceof Error?error.message:"Removal failed.");}
    finally{inFlight.current=false;setBusy(false);}
  };
  return <section className={styles.statusBar} aria-label="Account workspace"><div>
    {process.env.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW === "true" ? <p role="note"><strong>Studio acceptance preview:</strong> use disposable test accounts and data only.</p> : null}
    <strong>Account saving {autosave?"· autosave on":""}</strong>
    <p role="status">{status}</p>
    <p>Up to 50 projects and 256 KiB including history. Stored with encryption at rest. Usage counters remain local. <Link href="/account/api-keys/">Sign in</Link></p>
    <button disabled={busy} onClick={()=>void connect()}>Connect / refresh account</button>{" "}
    {remote?<><button disabled={busy||localStatus!=="Saved locally"} onClick={start}>Save workspace and enable autosave</button>{" "}<button disabled={busy} onClick={()=>setAutosave(false)}>Pause autosave</button>{" "}<button onClick={()=>downloadText("solvelang-account-backup.json",JSON.stringify(remote.workspace,null,2),"application/json")}>Export account backup</button>{" "}<button disabled={busy} onClick={()=>void remove()}>Remove account snapshot</button>
    <ul>{remote.workspace.projects.map((project)=><li key={project.document.id}>{project.document.name}{" "}<button disabled={busy} onClick={()=>{
      setAutosave(false);
      try{const restored=importCloudProject(window.localStorage,project,`workflow-${crypto.randomUUID()}`);onOpen(restored);setStatus("Account project opened as a new browser copy. Autosave paused; existing work is preserved.");}
      catch(error){setStatus(error instanceof Error?error.message:"Restore failed.");}
    }}>Open as local copy</button></li>)}</ul></>:null}
  </div></section>;
}
