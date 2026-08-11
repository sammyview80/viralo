import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { mcpSettings, type ApiKeyInfo } from "@/lib/api";

const MCP_ENDPOINT = "https://app.viraloapp.tech/api/v1/mcp";
const SKILL_MD_URL = "/skills/viralo-mcp/SKILL.md";
const SKILL_AGENT_URL = "/skills/viralo-mcp/agents/openai.yaml";

const TOOLS: { name: string; desc: string }[] = [
  { name: "list_clips", desc: "List workspace clips (filter, sort, paginate)." },
  { name: "get_clip", desc: "Retrieve a single clip by id." },
  { name: "publish_clip", desc: "Publish a scheduled post now." },
  { name: "schedule_clip", desc: "Schedule a clip for publishing." },
  { name: "list_social_accounts", desc: "List connected publishing accounts." },
  { name: "get_workspace_context", desc: "Get the authenticated tenant's workspace context." },
  { name: "get_job_status", desc: "Get render job status for a clip." },
];

/* ─── Primitives (mirrors SettingsPage styling) ────────────────────────── */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-[10px] border border-c-border bg-surface-1", className)}>{children}</div>;
}

function SectionTitle({ step, children }: { step?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 sm:px-5">
      {step !== undefined && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff3d6a]/15 text-[11px] font-semibold text-[#ff3d6a]">{step}</span>
      )}
      <h3 className="text-[13px] font-semibold text-c-text">{children}</h3>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2 mx-4 mb-4 sm:mx-5">
      <pre className="overflow-x-auto rounded-[8px] bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-5 text-c-text">{children}</pre>
      <button
        onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute right-2 top-2 h-6 cursor-pointer rounded-[6px] border border-c-border bg-surface-1 px-2 text-[11px] font-medium text-c-text-muted transition hover:text-c-text"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function DownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-c-border px-3 text-[13px] font-medium text-c-text-muted transition-colors hover:border-c-border-hover hover:text-c-text"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[13px] h-[13px]">
        <path d="M8 2v8m0 0L5 7m3 3l3-3M2.5 12v1.5A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V12" />
      </svg>
      {children}
    </a>
  );
}

/* ─── Sections ──────────────────────────────────────────────────────────── */

function EndpointSection() {
  return (
    <Card>
      <SectionTitle step={1}>Connect to the endpoint</SectionTitle>
      <p className="px-4 pt-2 text-[13px] text-c-text-muted sm:px-5">
        Point any MCP client at this URL. It speaks JSON-RPC 2.0 over HTTP.
      </p>
      <CodeBlock>{MCP_ENDPOINT}</CodeBlock>
    </Card>
  );
}

function AuthSection({ keys, generating, onGenerate, revealedKey, onDismissReveal }: {
  keys: ApiKeyInfo[] | null;
  generating: boolean;
  onGenerate: () => void;
  revealedKey: string | null;
  onDismissReveal: () => void;
}) {
  return (
    <Card>
      <SectionTitle step={2}>Generate an API key</SectionTitle>
      <p className="px-4 pt-2 text-[13px] text-c-text-muted sm:px-5">
        Every MCP request authenticates with a Viralo API key — send it as <code className="font-mono text-[12px]">x-api-key</code> or a bearer token. Never paste keys into chats, prompts, or source control.
      </p>

      {revealedKey && (
        <div className="mx-4 mt-3 rounded-[8px] border border-emerald-800/40 bg-emerald-950/20 p-3 sm:mx-5">
          <p className="mb-2 text-[12px] font-semibold text-emerald-400">Copy this key now — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[6px] bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-emerald-600 dark:text-emerald-300">{revealedKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey); onDismissReveal(); }}
              className="shrink-0 h-7 cursor-pointer rounded-[6px] border border-emerald-800/40 bg-emerald-950/30 px-2.5 text-[11px] font-medium text-emerald-400 transition hover:bg-emerald-950/50"
            >
              Copy & close
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-4 sm:px-5">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="h-8 cursor-pointer rounded-[8px] bg-[#ff3d6a] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#e8304f] disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate MCP API key"}
        </button>
      </div>

      {keys === null ? (
        <div className="px-4 pb-4 sm:px-5"><Skeleton className="h-10 rounded-[8px] bg-surface-glass" /></div>
      ) : keys.length > 0 ? (
        <div className="border-t border-c-border">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-c-border last:border-0 sm:px-5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-c-text">{k.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-c-text-muted">{k.key_prefix}</p>
              </div>
              <p className="shrink-0 text-[12px] text-c-text-muted">{new Date(k.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function ClientSetupSection() {
  const headerJson = `{
  "mcpServers": {
    "viralo": {
      "url": "${MCP_ENDPOINT}",
      "headers": { "x-api-key": "vk_live_..." }
    }
  }
}`;
  const bearerCurl = `curl -X POST ${MCP_ENDPOINT} \\
  -H "Authorization: Bearer vk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <Card>
      <SectionTitle step={3}>Configure your client</SectionTitle>
      <p className="px-4 pt-2 text-[13px] text-c-text-muted sm:px-5">
        Works with Claude Code, Claude Desktop, Cursor, Codex, and any MCP-compatible client. Custom-header clients use <code className="font-mono text-[12px]">x-api-key</code>; bearer-only clients use <code className="font-mono text-[12px]">Authorization: Bearer</code>.
      </p>
      <p className="mt-3 px-4 text-[12px] font-medium text-c-text-muted sm:px-5">mcp.json (generic)</p>
      <CodeBlock>{headerJson}</CodeBlock>
      <p className="px-4 text-[12px] font-medium text-c-text-muted sm:px-5">Bearer-token clients</p>
      <CodeBlock>{bearerCurl}</CodeBlock>
    </Card>
  );
}

function UseToolsSection() {
  return (
    <Card>
      <SectionTitle step={4}>Call tools</SectionTitle>
      <p className="px-4 pt-2 text-[13px] text-c-text-muted sm:px-5">
        Call <code className="font-mono text-[12px]">initialize</code>, then <code className="font-mono text-[12px]">tools/list</code> to discover the live schema. Currently available tools:
      </p>
      <div className="mt-3 border-t border-c-border">
        {TOOLS.map((t) => (
          <div key={t.name} className="flex items-start gap-3 px-4 py-3 border-b border-c-border last:border-0 sm:px-5">
            <code className="shrink-0 rounded-[6px] bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-c-text">{t.name}</code>
            <p className="text-[13px] text-c-text-muted">{t.desc}</p>
          </div>
        ))}
      </div>
      <p className="px-4 py-3 text-[12px] text-c-text-muted sm:px-5">
        Publishing, scheduling, deleting, revoking, billing, and workspace-setting changes should be confirmed before execution — agents should never invent data or actions for missing tools.
      </p>
    </Card>
  );
}

function SkillDownloadSection() {
  return (
    <Card>
      <SectionTitle step={5}>Install the Viralo skill</SectionTitle>
      <p className="px-4 pt-2 text-[13px] text-c-text-muted sm:px-5">
        Drop this skill into an MCP-aware agent (e.g. Claude Code's <code className="font-mono text-[12px]">~/.claude/skills/</code>) for ready-made connection and usage guidance — no need to re-explain the API each session.
      </p>
      <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-5">
        <DownloadLink href={SKILL_MD_URL}>Download SKILL.md</DownloadLink>
        <DownloadLink href={SKILL_AGENT_URL}>Download agents/openai.yaml</DownloadLink>
      </div>
      <div className="border-t border-c-border px-4 py-3 sm:px-5">
        <p className="mb-1.5 text-[12px] font-medium text-c-text-muted">Install (Claude Code)</p>
      </div>
      <CodeBlock>{`mkdir -p ~/.claude/skills/viralo-mcp/agents
curl -L ${window.location.origin}${SKILL_MD_URL} -o ~/.claude/skills/viralo-mcp/SKILL.md
curl -L ${window.location.origin}${SKILL_AGENT_URL} -o ~/.claude/skills/viralo-mcp/agents/openai.yaml`}</CodeBlock>
    </Card>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export function McpPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const load = () => mcpSettings.listKeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await mcpSettings.generateKey("MCP Key");
      setRevealedKey(res.key);
      load();
    } catch {
      alert("Failed to generate MCP key");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto rounded-[12px] border border-c-border bg-surface-0">
      <div className="border-b border-c-border px-4 py-4 sm:px-5">
        <h1 className="text-[15px] font-semibold text-c-text">MCP</h1>
        <p className="text-[13px] text-c-text-muted">Connect Claude, Cursor, Codex, and other MCP clients to your Viralo workspace.</p>
      </div>
      <div className="space-y-3 px-4 py-5 sm:px-5">
        <EndpointSection />
        <AuthSection
          keys={keys}
          generating={generating}
          onGenerate={generate}
          revealedKey={revealedKey}
          onDismissReveal={() => setRevealedKey(null)}
        />
        <ClientSetupSection />
        <UseToolsSection />
        <SkillDownloadSection />
      </div>
    </div>
  );
}

export default McpPage;
