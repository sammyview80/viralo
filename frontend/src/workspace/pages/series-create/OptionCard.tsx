import { cn } from "@/lib/utils";

export function OptionCard({ label, desc, selected, onClick }: {
  label: string; desc?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full cursor-pointer rounded-[14px] border p-4 text-left transition",
        selected ? "border-[#ff3d6a] bg-[#ff3d6a]/[.07]" : "border-c-border bg-surface-1 hover:bg-surface-2"
      )}
    >
      {selected && (
        <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[#ff3d6a]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
        </span>
      )}
      <p className="pr-6 text-[14px] font-bold capitalize text-c-text">{label}</p>
      {desc && <p className="mt-1 text-[12.5px] text-c-text-muted">{desc}</p>}
    </button>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors", on ? "bg-[#ff3d6a]" : "bg-surface-3")}>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", on ? "left-[calc(100%-22px)]" : "left-0.5")} />
    </button>
  );
}
