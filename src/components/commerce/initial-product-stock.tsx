import { useState } from 'react';
import type { AttributeDefinition } from '@/modules/commerce/product-attributes';
import type { InitialVariantDraft } from '@/modules/commerce/initial-stock';
import { ProductAttributeFields } from './product-attribute-fields';
import { ProductPropertyManager } from './product-property-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export function InitialProductStock({rows,onChange,definitions,currency,canStock,disabled}:{rows:InitialVariantDraft[];onChange:(rows:InitialVariantDraft[])=>void;definitions:AttributeDefinition[];currency:string;canStock:boolean;disabled:boolean}) {
 const [manage,setManage]=useState(false);
 const update=(key:string,patch:Partial<InitialVariantDraft>)=>onChange(rows.map(r=>r.key===key?{...r,...patch}:r));
 return <section className="border rounded-lg p-3 space-y-3">
  <h3 className="font-semibold">خيارات المنتج والكميات والدفعات</h3>
  <p className="text-sm text-muted-foreground">كل تركيبة لها مخزون مستقل، مثل خمري / M. أضف دفعة منفصلة لكل تاريخ انتهاء. لن تُدمج الدفعات عند الحفظ.</p>
  <Button type="button" variant="outline" disabled={disabled} onClick={()=>setManage(!manage)}>{manage?'إغلاق تعريف الخصائص':'تعريف خاصية مخزون أو إضافة قيم'}</Button>
  {manage&&<ProductPropertyManager/>}
  <fieldset disabled={disabled} className="space-y-3">
  {rows.map((row,index)=><div key={row.key} className="border rounded-lg p-3 space-y-3" data-validation-scope>
   <div className="flex justify-between items-center"><strong>التركيبة {index+1}</strong><Button type="button" variant="ghost" onClick={()=>onChange(rows.filter(r=>r.key!==row.key))}>حذف التركيبة</Button></div>
   <div><Label>اسم التركيبة — إلزامي</Label><Input required aria-label={`اسم التركيبة ${index+1}`} value={row.label} placeholder="مثال: خمري / M، أو أساسي" onChange={e=>update(row.key,{label:e.target.value})}/></div>
   <ProductAttributeFields definitions={definitions.filter(d=>d.scope==='variant')} values={row.attributes} currency={currency} onChange={attributes=>update(row.key,{attributes})}/>
   <p className="text-xs text-muted-foreground">اختر المقاس واللون لهذه التركيبة وحدها؛ أضف تركيبة أخرى للقيم المختلفة. يمكن ترك الخصائص فارغة للمنتج الأساسي.</p>
   {row.batches.map((batch,i)=><div key={batch.key} className="rounded-md bg-muted/30 p-2 space-y-2"><strong className="text-sm">الدفعة {i+1}</strong><div className="grid sm:grid-cols-3 gap-2"><div><Label>رقم الدفعة — إلزامي</Label><Input required aria-label="رقم الدفعة" value={batch.batchCode} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,batchCode:e.target.value}:b)})}/></div><div><Label>الكمية — إلزامي</Label><Input required aria-label="كمية الدفعة" type="number" min="0.001" step="0.001" value={batch.quantity} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,quantity:e.target.value}:b)})}/></div><div><Label>تاريخ الانتهاء — اختياري</Label><Input aria-label="تاريخ انتهاء الدفعة" type="date" value={batch.expiresOn} onChange={e=>update(row.key,{batches:row.batches.map(b=>b.key===batch.key?{...b,expiresOn:e.target.value}:b)})}/></div></div><Button type="button" variant="ghost" onClick={()=>update(row.key,{batches:row.batches.filter(b=>b.key!==batch.key)})}>حذف الدفعة</Button></div>)}
   {canStock?<Button type="button" variant="outline" onClick={()=>update(row.key,{batches:[...row.batches,{key:crypto.randomUUID(),batchCode:'',expiresOn:'',quantity:''}]})}>إضافة دفعة وكمية</Button>:<p className="text-xs text-muted-foreground">إدخال الكميات يحتاج صلاحية إدارة المخزون.</p>}
  </div>)}
  <Button type="button" variant="outline" onClick={()=>onChange([...rows,{key:crypto.randomUUID(),label:'',attributes:{},batches:[]}])}>إضافة تركيبة / مخزون أساسي</Button>
  {!rows.length&&<p className="text-xs text-muted-foreground">يمكن حفظ المنتج أو الخدمة دون مخزون أولي، وإضافته لاحقًا.</p>}
  </fieldset>
 </section>;
}
