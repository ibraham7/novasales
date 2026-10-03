import { useState } from 'react';
import type { AttributeDefinition } from '@/modules/commerce/product-attributes';
import type { InitialVariantDraft } from '@/modules/commerce/initial-stock';
import { ProductAttributeFields } from './product-attribute-fields';
import { ProductPropertyManager } from './product-property-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown } from 'lucide-react';
export function InitialProductStock({rows,onChange,definitions,currency,canStock,disabled}:{rows:InitialVariantDraft[];onChange:(rows:InitialVariantDraft[])=>void;definitions:AttributeDefinition[];currency:string;canStock:boolean;disabled:boolean}) {
 const [manage,setManage]=useState(false);
 const [stockOpen,setStockOpen]=useState(rows.length > 0);
 const update=(key:string,patch:Partial<InitialVariantDraft>)=>onChange(rows.map(r=>r.key===key?{...r,...patch}:r));
 return <details className="group rounded-lg border" open={stockOpen} onToggle={e=>setStockOpen(e.currentTarget.open)}>
  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium">
   <span>المخزون <span className="font-normal text-muted-foreground">{rows.length ? `(${rows.length} خيارات)` : "— اختياري"}</span></span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180"/>
  </summary>
  <div className="space-y-3 border-t p-3">
  <p className="text-sm text-muted-foreground">أضف خيارًا لكل مقاس أو لون، ثم أدخل كميته.</p>
  <Button type="button" variant="outline" disabled={disabled} onClick={()=>setManage(!manage)}>إضافة خاصية للمخزون</Button>
  <Dialog open={manage} onOpenChange={setManage}><DialogContent dir="rtl" className="sm:max-w-md max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>خاصية مخزون</DialogTitle></DialogHeader><ProductPropertyManager defaultScope="variant" onSaved={()=>setManage(false)}/></DialogContent></Dialog>
  <fieldset disabled={disabled} className="space-y-3">
  {rows.map((row,index)=><div key={row.key} className="border rounded-lg p-3 space-y-3" data-validation-scope>
   <div className="flex justify-between items-center"><strong>الخيار {index+1}</strong><Button type="button" variant="ghost" onClick={()=>onChange(rows.filter(r=>r.key!==row.key))}>حذف الخيار</Button></div>
   <div><Label>اسم الخيار</Label><Input required aria-label={`اسم الخيار ${index+1}`} value={row.label} placeholder="مثال: خمري / M، أو أساسي" onChange={e=>update(row.key,{label:e.target.value})}/></div>
   <ProductAttributeFields definitions={definitions.filter(d=>d.scope==='variant')} values={row.attributes} currency={currency} onChange={attributes=>update(row.key,{attributes})}/>
   {row.batches.map((batch,i)=><div key={batch.key} className="rounded-md bg-muted/30 p-2 space-y-2"><strong className="text-sm">الدفعة {i+1}</strong><div className="grid sm:grid-cols-2 gap-2"><div><Label>رقم الدفعة — إلزامي</Label><Input required aria-label="رقم الدفعة" value={batch.batchCode} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,batchCode:e.target.value}:b)})}/></div><div><Label>الكمية — إلزامي</Label><Input required aria-label="كمية الدفعة" type="number" min="0.001" step="0.001" value={batch.quantity} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,quantity:e.target.value}:b)})}/></div><details className="sm:col-span-2 text-sm" open={batch.expiresOn ? true : undefined}><summary className="cursor-pointer text-muted-foreground">تاريخ انتهاء — اختياري{batch.expiresOn ? ` (${batch.expiresOn})` : ""}</summary><Input className="mt-2" aria-label="تاريخ انتهاء الدفعة" type="date" value={batch.expiresOn} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,expiresOn:e.target.value}:b)})}/></details></div><Button type="button" variant="ghost" onClick={()=>update(row.key,{batches:row.batches.filter(b=>b.key!==batch.key)})}>حذف الدفعة</Button></div>)}
   {canStock?<Button type="button" variant="outline" onClick={()=>update(row.key,{batches:[...row.batches,{key:crypto.randomUUID(),batchCode:'',expiresOn:'',quantity:''}]})}>إضافة دفعة وكمية</Button>:<p className="text-xs text-muted-foreground">إدخال الكميات يحتاج صلاحية إدارة المخزون.</p>}
  </div>)}
  <Button type="button" variant="outline" onClick={()=>onChange([...rows,{key:crypto.randomUUID(),label:'',attributes:{},batches:[]}])}>إضافة خيار للمخزون</Button>
  {!rows.length&&<p className="text-xs text-muted-foreground">اتركه فارغًا إذا كنت تضيف خدمة أو منتجًا دون مخزون.</p>}
  </fieldset>
 </div>
 </details>;
}
