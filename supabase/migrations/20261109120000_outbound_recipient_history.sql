-- Deleting a discovered business sets ob_prospect_id to null on the recipient rows that mention it
-- (their history stays). That update ran the tenant check, which then demanded a CRM contact and
-- refused, so the business could not be deleted. A recipient whose business was deleted is now allowed.
create or replace function public.cmp_tenant_refs() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if TG_TABLE_NAME='cmp_campaigns' then
  if not exists(select 1 from public.msg_channel_accounts where id=new.channel_account_id and organization_id=new.organization_id) then raise exception 'foreign channel account';end if;
 elsif new.contact_id is null then
  if new.ob_prospect_id is not null then
   if not exists(select 1 from public.ob_prospects where id=new.ob_prospect_id and organization_id=new.organization_id) then raise exception 'foreign prospect';end if;
  elsif not (TG_OP='UPDATE' and old.ob_prospect_id is not null) then
   raise exception 'foreign contact';
  end if;
 else
  if not exists(select 1 from public.crm_contacts where id=new.contact_id and organization_id=new.organization_id) then raise exception 'foreign contact';end if;
 end if;
 return new;
end $$;
