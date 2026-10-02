/** Super admin resolves the number's tenant; org admins stay in their workspace. */
export async function resolveMoveOrganization(db: any, workspace: { userId: string; organizationId: string }, accountId: string, requireOrgManage: () => Promise<unknown>) {
  const { data: isAdmin, error: roleError } = await db.rpc('has_role', { _user_id: workspace.userId, _role: 'admin' });
  if (roleError) throw new Error('تعذر التحقق من صلاحيات نقل الجلسة');
  if (isAdmin !== true) { await requireOrgManage(); return workspace.organizationId; }
  const { data: account, error } = await db.from('msg_channel_accounts').select('organization_id').eq('id', accountId).maybeSingle();
  if (error || !account) throw new Error('جلسة غير موجودة');
  return account.organization_id as string;
}
