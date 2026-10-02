// Domain event type registry (Zod schemas).
// Convention: <module>.<aggregate>.<action>
import { z } from "@/lib/validation";

export const EventTypes = {
  // CRM
  CrmLeadCreated: "crm.lead.created",
  CrmLeadAssigned: "crm.lead.assigned",
  CrmLeadTransferred: "crm.lead.transferred",
  CrmLeadReassigned: "crm.lead.reassigned",
  CrmLeadUnassigned: "crm.lead.unassigned",
  CrmOpportunityCreated: "crm.opportunity.created",
  CrmOpportunityStageChanged: "crm.opportunity.stage_changed",
  CrmOpportunityAssigned: "crm.opportunity.assigned",
  // Messaging
  MessagingMessageReceived: "messaging.message.received",
  MessagingMessageSent: "messaging.message.sent",
  // Channels
  ChannelConnected: "channel.connected",
  ChannelDisconnected: "channel.disconnected",
  ChannelConnectionUpdated: "channel.connection.updated",
  // Workflow engine
  WfRunStarted: "wf.run.started",
  WfRunFinished: "wf.run.finished",
  WfRunFailed: "wf.run.failed",
  WfStepFailed: "wf.run.step_failed",
  // Campaigns
  CmpCampaignStarted: "cmp.campaign.started",
  CmpCampaignFinished: "cmp.campaign.finished",
  CmpCampaignPaused: "cmp.campaign.paused",
  CmpMessageSent: "cmp.message.sent",
  CmpMessageDelivered: "cmp.message.delivered",
  CmpMessageRead: "cmp.message.read",
  CmpMessageFailed: "cmp.message.failed",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const DomainEventSchema = z.object({
  type: z.string(),
  organizationId: z.string().uuid().optional(),
  aggregateType: z.string().optional(),
  aggregateId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;
