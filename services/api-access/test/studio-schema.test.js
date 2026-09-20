import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWorkspace } from '../src/studio-workspace.js';

test('deployed Studio validators match the canonical browser schema sources', () => {
  for (const name of ['types', 'schema', 'workspace-schema']) {
    const source = readFileSync(new URL(`../../../site/app/studio/core/${name}.ts`, import.meta.url), 'utf8');
    const output = readFileSync(new URL(`../src/studio-schema/${name}.js`, import.meta.url), 'utf8');
    const digest = createHash('sha256').update(source).digest('hex');
    assert.ok(output.includes(`// Source SHA-256: ${digest}\n`), `Regenerate ${name}: node services/api-access/scripts/generate-studio-schema.mjs`);
  }
});
const document = { schemaVersion: 1, id:'project', name:'Example', description:'', version:'1', createdAt:'', updatedAt:'', nodes:[], edges:[], scenarios:[], policies:[], analytics:{tags:[],lastAnalyzedAt:null,analysisRuns:0},suppressedRuleIds:[] };
const workspace = () => ({schemaVersion:1,projects:[{document:structuredClone(document),versions:[],traces:[]}]});
test('API accepts valid projects and rejects malformed nested history and graph references', () => {
  assert.deepEqual(JSON.parse(validateWorkspace(workspace())), workspace());
  for (const mutate of [
    w => w.projects[0].versions.push({}),
    w => w.projects[0].traces.push({}),
    w => w.projects[0].document.edges.push({id:'edge',source:'missing',target:'missing',condition:'',priority:0,label:'',fallback:false,metadata:{}}),
    w => w.projects[0].document.nodes.push({id:'node'}),
    w => w.projects.push(structuredClone(w.projects[0])),
  ]) {
    const value = workspace(); mutate(value);
    assert.throws(() => validateWorkspace(value), {statusCode:400});
  }
});
