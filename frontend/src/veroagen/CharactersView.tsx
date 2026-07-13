import { useState } from "react";
import type { Character } from "./types";

export function CharactersView({
  characters, onCreate, onGenerateRef,
}: {
  characters: Character[];
  onCreate: (name: string, description: string) => void;
  onGenerateRef: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const create = () => {
    if (!name.trim() || !desc.trim()) return;
    onCreate(name.trim(), desc.trim());
    setName(""); setDesc("");
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
               className="w-40 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
               onKeyDown={(e) => e.key === "Enter" && create()}
               className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]" />
        <button onClick={create} className="rounded-md bg-[#ff3d6a] px-3 py-2 text-sm text-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#ff3d6a] focus-visible:ring-offset-2">
          Add
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {characters.map((c) => (
          <div key={c.id} className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{c.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.ref_status === "failed" ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
                {c.ref_status}
              </span>
            </div>
            <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded bg-muted">
              {c.ref_image_url
                ? <img src={c.ref_image_url} alt={c.name} className="h-full w-full object-cover" />
                : <span className="text-xs text-muted-foreground">
                    {c.ref_status === "generating" ? "Generating…" : "No reference yet"}
                  </span>}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{c.description}</p>
            {c.ref_status === "failed" && <p className="mb-2 text-xs text-red-400">⚠ {c.error}</p>}
            <button
              onClick={() => onGenerateRef(c.id)}
              disabled={c.ref_status === "generating"}
              className="w-full rounded-md border px-2 py-1 text-xs outline-none transition-colors hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
            >
              {c.ref_image_url ? "Regenerate reference" : "Generate reference"}
            </button>
          </div>
        ))}
        {!characters.length && (
          <p className="col-span-full text-sm text-muted-foreground">
            No characters yet — add one above or ask the Director.
          </p>
        )}
      </div>
    </div>
  );
}
