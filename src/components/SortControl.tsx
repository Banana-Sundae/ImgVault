import { ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowUpDown, Check, Shuffle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SortField = 'date' | 'modified' | 'name' | 'size' | 'duration' | 'random';
export type SortOrder = 'asc' | 'desc';

const SORT_LABELS: Record<SortField, string> = {
  date: 'Date created',
  modified: 'Date modified',
  name: 'Name',
  size: 'File size',
  duration: 'Video length',
  random: 'Random',
};

interface SortControlProps {
  sort: SortField;
  order: SortOrder;
  /** Video length is only offered when the Videos filter is active */
  videosOnly: boolean;
  onSortChange: (sort: SortField) => void;
  onOrderChange: (order: SortOrder) => void;
  onReshuffle: () => void;
}

export default function SortControl({
  sort, order, videosOnly, onSortChange, onOrderChange, onReshuffle,
}: SortControlProps) {
  const fields: SortField[] = ['date', 'modified', 'name', 'size', ...(videosOnly ? ['duration' as const] : []), 'random'];
  const isRandom = sort === 'random';

  const buttonClass = 'inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg border border-border bg-surface text-sm text-muted-foreground hover:text-foreground transition-colors active:scale-95 shrink-0';

  return (
    <div className="flex items-center gap-2 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={buttonClass} aria-label="Sort by">
            <ArrowUpDown className="h-4 w-4" />
            <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {fields.map((f) => (
            <DropdownMenuItem key={f} onClick={() => onSortChange(f)} className="justify-between">
              {SORT_LABELS[f]}
              {sort === f && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {isRandom ? (
        <button onClick={onReshuffle} className={buttonClass} aria-label="Reshuffle">
          <Shuffle className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={() => onOrderChange(order === 'asc' ? 'desc' : 'asc')}
          className={cn(buttonClass)}
          aria-label={order === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
          title={order === 'asc' ? 'Ascending' : 'Descending'}
        >
          {order === 'asc'
            ? <ArrowUpNarrowWide className="h-4 w-4" />
            : <ArrowDownWideNarrow className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
