import { cn } from "@/lib/utils";

export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  itemLabel = "items",
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);

  return (
    <div className={cn("flex flex-col gap-3 border-t border-c-border px-4 py-3 text-xs text-c-text-muted sm:flex-row sm:items-center sm:justify-between", className)}>
      <span>
        {first}-{last} of {total} {itemLabel} · Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className="rounded-[8px] border border-c-border bg-surface-1 px-2.5 py-2.5 font-semibold text-c-text-secondary transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 sm:py-1.5"
        >
          First
        </button>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-[8px] border border-c-border bg-surface-1 px-3 py-2.5 font-semibold text-c-text-secondary transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 sm:py-1.5"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-[8px] border border-c-border bg-surface-1 px-3 py-2.5 font-semibold text-c-text-secondary transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 sm:py-1.5"
        >
          Next
        </button>
      </div>
    </div>
  );
}
