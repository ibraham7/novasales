export {
  listContacts,
  upsertContact,
  deleteContact,
  updateContactName,
  funnelStages,
} from "./contacts.functions";

export {
  OPP_STAGES,
  STAGE_LABEL_AR,
  getOpportunityByChat,
  listChatsEnriched,
} from "./opportunity.functions";
export type { OppStage } from "./opportunity.functions";
export * from "./opportunity.functions";

export {
  listStages,
  getPipelinePageMeta,
  listOpportunitiesBoard,
  moveOpportunityStage,
} from "./pipeline.functions";

// Pipelines (dynamic)
export {
  listPipelines,
  getDefaultPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  upsertStage,
  deleteStage,
  reorderStages,
  moveOpportunityToStage,
} from "./pipelines.functions";

// Leads
export {
  listLeads,
  listLeadPage,
  getLeadOptions,
  getLead,
  createLead,
  updateLead,
  convertLeadToOpportunity,
  deleteLead,
} from "./leads.functions";

// Activities + Timeline
export {
  listActivities,
  listTimeline,
  createActivity,
  deleteActivity,
} from "./activities.functions";

// Tasks
export { listTasks, createTask, updateTask, deleteTask } from "./tasks.functions";

// Tags
export {
  listTags,
  upsertTag,
  deleteTag,
  listEntityTags,
  attachTag,
  detachTag,
} from "./tags.functions";

// Files
export { listFiles, createUploadUrl, registerFile, deleteFile } from "./files.functions";

// Custom Fields
export {
  listFieldDefs,
  listAllFieldDefs,
  upsertFieldDef,
  deleteFieldDef,
  reorderFieldDefs,
} from "./custom-fields.functions";

export { updateEntityCustomFields, getEntityCustomFields } from "./custom-fields-values.functions";
