/**
 * Giving the abandoned tickets («مهمل») a fresh start: each goes back to the first stage with a new
 * owner, chosen so that a customer visits every sales agent before anyone gets them a second time.
 * Planning is pure and the writes take the database as a parameter, so both are tested without Supabase.
 * Nothing here sends a message to a customer.
 */

export type Ticket = { id: string; lead_id: string | null; owner_agent_id: string | null; department_id: string | null };
export type Move = { ticketId: string; leadId: string | null; from: string | null; to: string; departmentId: string | null };
export type Agents = { all: string[]; byDepartment: Map<string, string[]> };

const CHUNK = 100;
const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Who can receive tickets: every user with the sales role who is active in the organization (department
 * membership is not required, since sales agents are often not listed in a department). If nobody has the
 * sales role, the active department members count. A ticket with a department goes only to that
 * department's sales agents when it has at least two of them; otherwise to all sales agents.
 */
export function buildAgents(input: { members: { user_id: string; department_id: string | null }[]; activeUsers: Set<string>; salesUsers: Set<string> }): Agents {
  const live = input.members.filter((m) => input.activeUsers.has(m.user_id));
  const sales = [...input.salesUsers].filter((u) => input.activeUsers.has(u));
  const all = (sales.length ? sales : [...new Set(live.map((m) => m.user_id))]).sort();
  const pool = new Set(all);
  const byDepartment = new Map<string, string[]>();
  for (const m of live) {
    if (!m.department_id || !pool.has(m.user_id)) continue;
    const list = byDepartment.get(m.department_id) ?? [];
    if (!list.includes(m.user_id)) list.push(m.user_id);
    byDepartment.set(m.department_id, list);
  }
  for (const [department, list] of byDepartment) {
    if (list.length < 2) byDepartment.delete(department);
    else list.sort();
  }
  return { all, byDepartment };
}

/**
 * The agents this ticket has not been through in the current round. A round ends when every
 * candidate has had the ticket; then it starts again, but never with the agent who has it now.
 * `history` is the chronological list of agents the ticket has been with.
 */
export function eligibleAgents(candidates: string[], history: string[], owner: string | null): string[] {
  if (candidates.length === 0) return [];
  const sequence = owner && history[history.length - 1] !== owner ? [...history, owner] : history;
  const round = new Set<string>();
  for (const user of sequence) {
    if (!candidates.includes(user)) continue;
    round.add(user);
    if (round.size >= candidates.length) round.clear();
  }
  let pool = candidates.filter((c) => !round.has(c));
  if (pool.length === 0) pool = candidates;
  const others = pool.filter((c) => c !== owner);
  return others.length ? others : pool;
}

/** Spreads the tickets over the agents: each one only to an agent still eligible for it, and evenly among them. `history` is keyed by ticket id. */
export function planRedistribution(input: { tickets: Ticket[]; history: Map<string, string[]>; agents: Agents; random?: () => number }) {
  const random = input.random ?? Math.random;
  const order = [...input.tickets];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const load = new Map<string, number>();
  const moves: Move[] = [];
  const unassignable: Ticket[] = [];
  for (const t of order) {
    const department = t.department_id ? input.agents.byDepartment.get(t.department_id) : undefined;
    const candidates = department?.length ? department : input.agents.all;
    const pool = eligibleAgents(candidates, input.history.get(t.id) ?? [], t.owner_agent_id);
    if (pool.length === 0) {
      unassignable.push(t);
      continue;
    }
    const least = Math.min(...pool.map((u) => load.get(u) ?? 0));
    const tied = pool.filter((u) => (load.get(u) ?? 0) === least);
    const to = tied[Math.floor(random() * tied.length)]!;
    load.set(to, (load.get(to) ?? 0) + 1);
    moves.push({ ticketId: t.id, leadId: t.lead_id, from: t.owner_agent_id, to, departmentId: t.department_id });
  }
  return { moves, unassignable, perAgent: Object.fromEntries(load) as Record<string, number> };
}

export type FirstStage = { id: string; pipeline_id: string; probability: number | null };

/**
 * Applies the plan: every ticket goes to the first stage with its new owner, the lead's owner follows,
 * and the move is written to the ticket's owner history (so the next round knows) and to the timeline.
 * It writes no domain event and sends nothing, so no automation can message the customers.
 */
export async function applyRedistribution(db: any, input: { organizationId: string; actorId: string; lostStageId: string; first: FirstStage; moves: Move[]; now?: Date }) {
  const stamp = (input.now ?? new Date()).toISOString();
  const byAgent = new Map<string, Move[]>();
  for (const m of input.moves) byAgent.set(m.to, [...(byAgent.get(m.to) ?? []), m]);

  let moved = 0;
  for (const [agent, list] of byAgent) {
    for (const part of chunks(list)) {
      const ids = part.map((m) => m.ticketId);
      // Only tickets still in the abandoned stage are touched, so a second click or a race changes nothing twice.
      const { data, error } = await db
        .from("opp_opportunities")
        .update({ owner_agent_id: agent, stage_id: input.first.id, pipeline_id: input.first.pipeline_id, stage: "new", probability: input.first.probability, outcome: null, closed_at: null, updated_at: stamp })
        .eq("organization_id", input.organizationId)
        .eq("stage_id", input.lostStageId)
        .is("deleted_at", null)
        .in("id", ids)
        .select("id");
      if (error) throw new Error(error.message);
      const done = new Set<string>((data ?? []).map((r: any) => r.id));
      const applied = part.filter((m) => done.has(m.ticketId));
      moved += applied.length;
      const leadIds = applied.map((m) => m.leadId).filter((x): x is string => !!x);
      if (leadIds.length) {
        const { error: leadError } = await db.from("crm_leads").update({ owner_user_id: agent }).eq("organization_id", input.organizationId).in("id", leadIds);
        if (leadError) throw new Error(leadError.message);
      }
      if (applied.length) {
        // The history is per ticket (most tickets have no lead), so the next round knows who had it.
        const { error: historyError } = await db.from("opp_owner_history").insert(
          applied.map((m) => ({ organization_id: input.organizationId, opportunity_id: m.ticketId, from_user_id: m.from, to_user_id: agent, reason: "إعادة توزيع التذاكر المهملة", assigned_by: input.actorId })),
        );
        if (historyError) throw new Error(historyError.message);
      }
      if (applied.length) {
        await db.from("crm_timeline").insert(
          applied.map((m) => ({ organization_id: input.organizationId, entity_type: "opportunity", entity_id: m.ticketId, event_kind: "stage.changed", title: "أُعيد توزيع التذكرة من المهملة إلى أول مرحلة", actor_user_id: input.actorId, ref_type: "opportunity", ref_id: m.ticketId, metadata: { redistributed: true, to_user_id: agent } })),
        );
      }
    }
  }
  return { moved };
}
