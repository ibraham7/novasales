// Public API of the channels module. Provider-agnostic exports below.
export {
  listInstances,
  listProvidersFn,
  getAccountCapabilitiesFn,
  moveSessionProviderFn,
  listMyOwnedAccountIds,
  getInstance,
  createInstanceFn,
  connectInstanceFn,
  refreshInstanceStatusFn,
  syncWebhookFn,
  updateInstanceNameFn,
  logoutInstanceFn,
  deleteInstanceFn,
} from "./whatsapp/instances.functions";

// Provider registry (server-only import; used inside server functions).
export type { IWhatsAppProvider, ProviderId, ProviderLinkMode } from "./whatsapp/provider";

// واتساب الرسمي (Coexistence)
export { getCoexistenceSetupFn, linkCoexistenceFn } from "./whatsapp/coexistence.functions";
export { CoexistenceLinkDialog, CoexistenceInstructions } from "./components/CoexistenceLink";
