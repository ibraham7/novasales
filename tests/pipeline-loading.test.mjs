import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

// Run the actual server handlers with a deterministic database and session.
const source = readFileSync(new URL('../src/modules/crm/pipeline.functions.ts', import.meta.url), 'utf8')
  .replace(/import\("([^\"]+)"\)/g, (_, path) => `Promise.resolve(__deps[${JSON.stringify(path)}])`);
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(scope = 'all', failTable) {
  const access = { organizationId: 'org-a', userId: 'ali', departmentIds: ['dept-a'] };
  const tables = {
    opp_opportunities: [
      { id: 'one', organization_id: 'org-a', owner_agent_id: 'ali', department_id: 'dept-a', contact_id: 'contact', deleted_at: null, title: 'Test', stage_id: 'new' },
      { id: 'two', organization_id: 'org-a', owner_agent_id: 'other', department_id: 'dept-b', deleted_at: null, title: 'Other' },
      { id: 'foreign', organization_id: 'org-b', owner_agent_id: 'ali', deleted_at: null },
      { id: 'deleted', organization_id: 'org-a', owner_agent_id: 'ali', deleted_at: 'date' },
    ],
    crm_contacts: [{ id: 'contact', organization_id: 'org-a', full_name: 'Customer' }],
    profiles: [{ id: 'ali', full_name: 'Ali' }],
    org_memberships: [{ organization_id: 'org-a', user_id: 'ali', is_active: true }, { organization_id: 'org-b', user_id: 'foreign', is_active: true }],
    org_departments: [{ id: 'dept-a', organization_id: 'org-a', is_active: true, name: 'Department' }],
    crm_opportunity_sessions: [{ opportunity_id: 'one', organization_id: 'org-a', session_ref: 'session', channel: 'whatsapp' }, { opportunity_id: 'one', organization_id: 'org-b', session_ref: 'foreign-session' }],
    msg_sessions: [{ id: 'session', organization_id: 'org-a', channel_account_id: 'account', unread_count: 2, last_message_preview: 'Hello', last_message_at: '2026-10-09' }],
    msg_channel_accounts: [{ id: 'account', organization_id: 'org-a', display_name: 'WhatsApp' }],
  };
  const db = { from(table) {
    let rows = [...(tables[table] ?? [])];
    const q = { select() { return q; }, order() { return q; },
      eq(k, v) { rows = rows.filter(r => r[k] === v); return q; },
      is(k, v) { rows = rows.filter(r => r[k] === v); return q; },
      in(k, v) { rows = rows.filter(r => v.includes(r[k])); return q; },
      range(a, b) { rows = rows.slice(a, b + 1); return q; },
      then(resolve, reject) { return Promise.resolve(table === failTable ? { error: { message: 'database unavailable' } } : { data: rows }).then(resolve, reject); },
    }; return q;
  } };
  const createServerFn = () => { let validate = d => d; const builder = { inputValidator(v) { validate = v; return builder; }, handler(fn) { return args => fn({ data: validate(args?.data ?? {}) }); } }; return builder; };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === '@tanstack/react-start' ? { createServerFn } : { z }, __deps: {
    '@/platform/workspace/workspace.server': { supabaseAdmin: db, getWorkspace: async () => access },
    '@/platform/rbac/rbac.server': { requireAnyPermission: async () => access, getWorkspaceAccess: async () => access },
    '@/platform/rbac/data-scope.server': { getOpportunityVisibility: () => scope },
    './pipelines.functions': { listPipelines: async () => [{ id: 'pipe', stages: [{ id: 'new' }] }] },
  } });
  return exports;
}
test('board includes unlinked leads, excludes foreign and deleted opportunities, enriches linked sessions', async () => {
  const rows = await setup().listOpportunitiesBoard();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].contact_name, 'Customer');
  assert.equal(rows[0].unread_count, 2);
  assert.equal(rows[0].last_message, 'Hello');
  assert.equal(rows[1].contact_name, 'Other');
});
test('own scope cannot be widened by requested owner', async () => {
  // Use actual UUID inputs for validation; own scope replaces the requested owner.
  const rows = await setup('own').listOpportunitiesBoard({ data: { ownerAgentId: '00000000-0000-0000-0000-000000000001' } });
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'one');
});
test('department scope excludes other departments and rejects foreign department filter', async () => {
  assert.equal((await setup('department').listOpportunitiesBoard()).length, 1);
  assert.equal((await setup('department').listOpportunitiesBoard({ data: { departmentId: '00000000-0000-0000-0000-000000000001' } })).length, 0);
});
test('metadata returns existing pipeline and names only active organization members', async () => {
  const meta = await setup().getPipelinePageMeta();
  assert.equal(meta.pipelines[0].stages.length, 1);
  assert.equal(meta.members.length, 1); assert.equal(meta.members[0].profile_name, 'Ali');
});
test('database failures propagate instead of appearing as an empty board', async () => {
  await assert.rejects(setup('all', 'opp_opportunities').listOpportunitiesBoard(), /database unavailable/);
  await assert.rejects(setup('all', 'org_memberships').getPipelinePageMeta(), /database unavailable/);
});
