import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_CODES, currencyName } from "@/modules/commerce/currencies";

/** The ticket's value as two boxes: the currency (a list) and the amount (digits only). */
export function TicketValueField({ currency, onCurrency, amount, onAmount, invalid }: {
  currency: string;
  onCurrency: (code: string) => void;
  amount: string;
  onAmount: (text: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
        <Select value={currency} onValueChange={onCurrency}>
          <SelectTrigger aria-label="العملة" className="h-10">
            <SelectValue>{currency}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {CURRENCY_CODES.map((code) => (
              <SelectItem key={code} value={code}>{currencyName(code)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input aria-label="المبلغ" placeholder="المبلغ (رقم فقط)" dir="ltr" className="text-right" inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} />
      </div>
      {invalid && <p className="text-xs text-destructive">اكتب المبلغ بالأرقام فقط</p>}
    </div>
  );
}
