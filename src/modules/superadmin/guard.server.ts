// Every platform-admin server function must call this first: hiding the admin pages in the app does
// not stop anyone signed in from calling these functions directly.
export { requireBillingAdmin as requireSuperAdmin } from "@/modules/billing/admin.server";
