import { useEffect, useState } from "react";
import { Shell } from "@/workspace/Shell";
import type { PageKey } from "@/workspace/types";
import { veroagenApi } from "./api";
import type { ProjectSummary } from "./types";

// "veroagen" is not part of the viralo Shell's `PageKey` union (frontend/src/workspace/types.ts).
// Per Task 10 instructions, we cast rather than widen that shared union — Shell falls back to
// showing "veroagen" as the page label since it isn't in PAGE_LABELS. See task-10-report.md.
const VEROAGEN_ACTIVE = "veroagen" as unknown as PageKey;

export function VeroagenListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState("");

  useEffect(() => {
    veroagenApi.listProjects().then(setProjects).catch(console.error);
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    const { id } = await veroagenApi.createProject(title.trim());
    window.location.assign(`/veroagen/${id}`);
  };

  return (
    <Shell active={VEROAGEN_ACTIVE}>
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-semibold">Veroagen — AI Video Agent</h1>
        <div className="mb-8 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Describe your video project…"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button onClick={create} className="rounded-md bg-[#ff3d6a] px-4 py-2 text-sm text-white">
            Create
          </button>
        </div>
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`/veroagen/${p.id}`} className="block rounded-md border p-3 hover:bg-muted">
                {p.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}
