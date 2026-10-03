import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProductAttributes, saveProductAttribute } from "@/modules/commerce/stock.functions";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { usePermission } from "@/platform/rbac/use-permission";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const types: Record<AttributeDefinition["kind"], string> = {text:"نص حر",number:"رقم",select:"اختيار واحد",multiselect:"اختيار متعدد",date:"تاريخ",money:"مبلغ / سعر",boolean:"نعم / لا",url:"رابط",file:"رابط ملف"};
const empty = {id:undefined as string|undefined,name:"",kind:"select" as AttributeDefinition["kind"],scope:"product" as AttributeDefinition["scope"],isPriceFloor:false,options:[""]};
export function ProductPropertyManager({ onSaved }: { onSaved?: (definition: AttributeDefinition) => void }) {
 const canManage=usePermission("products.manage"), qc=useQueryClient();
 const fetch=useServerFn(listProductAttributes),save=useServerFn(saveProductAttribute);
 const q=useQuery({queryKey:["product-attributes"],queryFn:()=>fetch()});
 const [form,setForm]=useState(empty);
 const mut=useMutation({mutationFn:async()=>{
  if(!form.name.trim()) throw new Error("اسم الخاصية إلزامي");
  const options=form.options.map(v=>v.trim()).filter(Boolean);
  if(["select","multiselect"].includes(form.kind)&&!options.length) throw new Error("أضف قيمة واحدة على الأقل للخاصية");
  return save({data:{...form,options:["select","multiselect"].includes(form.kind)?options:[]}});
 },onSuccess:(result)=>{qc.invalidateQueries({queryKey:["product-attributes"]});setForm({...empty,options:[""]});toast.success("تم حفظ الخاصية وقيمها");onSaved?.(result);},onError:(e)=>toast.error(e.message)});
 if(!canManage) return null;
 return <section className="space-y-4" data-validation-scope>
  <p className="text-sm text-muted-foreground">أنشئ خصائص تناسب نشاطك. مواصفات المنتج تصف العنصر؛ خيارات المخزون تفصل الكميات مثل المقاس واللون.</p>
  {q.isError?<div><p className="text-destructive">تعذر تحميل الخصائص</p><Button type="button" variant="outline" onClick={()=>q.refetch()}>إعادة المحاولة</Button></div>:q.isPending?<p>جارٍ التحميل...</p>:<div className="space-y-1"><Label>إضافة أو تعديل خاصية</Label><select aria-label="اختيار خاصية للتعديل" className="w-full border rounded-md bg-background p-2" value={form.id??""} onChange={e=>{const a=(q.data as AttributeDefinition[]).find(a=>a.id===e.target.value);setForm(a?{id:a.id,name:a.name,kind:a.kind,scope:a.scope,isPriceFloor:a.is_price_floor,options:a.options.length?[...a.options]:[""]}:{...empty,options:[""]});}}><option value="">خاصية جديدة</option>{(q.data as AttributeDefinition[]).map(a=><option key={a.id} value={a.id}>{a.name} — {types[a.kind]}</option>)}</select></div>}
  <div className="space-y-1"><Label>اسم الخاصية — إلزامي</Label><Input required aria-label="اسم الخاصية" placeholder="مثال: المقاس، السعة، مدة الخدمة" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
  <div className="grid sm:grid-cols-2 gap-3"><div><Label>نوع القيمة</Label><select aria-label="نوع القيمة" className="w-full border rounded-md bg-background p-2" disabled={!!form.id} value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as AttributeDefinition["kind"],isPriceFloor:false,scope:e.target.value==="money"?"product":form.scope})}>{Object.entries(types).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div><div><Label>استخدام الخاصية</Label><select aria-label="استخدام الخاصية" className="w-full border rounded-md bg-background p-2" disabled={!!form.id||form.kind==="money"} value={form.scope} onChange={e=>setForm({...form,scope:e.target.value as AttributeDefinition["scope"]})}><option value="product">مواصفة عامة للمنتج / الخدمة</option><option value="variant">خيار مخزون بكمية مستقلة</option></select></div></div>
  {["select","multiselect"].includes(form.kind)&&<div className="space-y-2"><Label>قيم الخاصية — قيمة واحدة على الأقل</Label>{form.options.map((value,index)=><div key={index} className="flex gap-2"><Input aria-label={`قيمة الخاصية ${index+1}`} placeholder="مثال: S أو M أو L" value={value} onChange={e=>setForm({...form,options:form.options.map((v,i)=>i===index?e.target.value:v)})}/><Button type="button" variant="outline" disabled={!!form.id && !!(q.data as AttributeDefinition[]|undefined)?.find(a=>a.id===form.id)?.options.includes(value)} onClick={()=>setForm({...form,options:form.options.filter((_,i)=>i!==index)})}>حذف</Button></div>)}<Button type="button" variant="outline" onClick={()=>setForm({...form,options:[...form.options,""]})}>إضافة قيمة</Button></div>}
  {form.kind==="money"&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={form.isPriceFloor} onChange={e=>setForm({...form,isPriceFloor:e.target.checked})}/>استخدامه حدًا أدنى للبيع (سعر التكلفة)</label>}
  {form.id&&<p className="text-xs text-muted-foreground">يمكن تعديل الاسم وإضافة قيم. تغيير النوع أو حذف قيم مستخدمة يتطلب خاصية جديدة.</p>}
  <Button type="button" disabled={mut.isPending||q.isError} onClick={()=>mut.mutate()}>{mut.isPending?"جارٍ الحفظ...":"حفظ الخاصية"}</Button>
 </section>;
}
