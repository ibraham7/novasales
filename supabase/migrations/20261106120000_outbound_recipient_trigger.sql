-- Outbound recipients are discovered businesses (ob_prospect_id) with no CRM contact yet.
-- The tenant-check trigger used to demand a CRM contact on every recipient, which made creating
-- an outbound campaign fail. Contact recipients are checked exactly as before; prospect
-- recipients are checked against the prospect's organization instead.
create or replace function public.cmp_tenant_refs() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if TG_TABLE_NAME='cmp_campaigns' then
  if not exists(select 1 from public.msg_channel_accounts where id=new.channel_account_id and organization_id=new.organization_id) then raise exception 'foreign channel account';end if;
 elsif new.contact_id is null and new.ob_prospect_id is not null then
  if not exists(select 1 from public.ob_prospects where id=new.ob_prospect_id and organization_id=new.organization_id) then raise exception 'foreign prospect';end if;
 else
  if not exists(select 1 from public.crm_contacts where id=new.contact_id and organization_id=new.organization_id) then raise exception 'foreign contact';end if;
 end if;
 return new;
end $$;
