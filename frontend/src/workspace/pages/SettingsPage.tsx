/* ─── API keys ───────────────────────────────────────────────────────────── */

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // New state for MCP key
  const [revealedMcpKey, setRevealedMcpKey] = useState<string | null>(null);
  const [generatingMcpKey, setGeneratingMcpKey] = useState(false);

  const load = () => settingsApi.listApiKeys().then(setKeys).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const created = await settingsApi.createApiKey(newKeyName.trim());
      setRevealedKey(created.key);
      setNewKeyName("");
      load();
    } finally { setCreating(false); };
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await settingsApi.revokeApiKey(id);
      setKeys(prev => prev?.filter(k => k.id !== id) ?? null);
      setRevealedKey(null);
    } finally { setRevoking(null); };
  };

  // Function to generate MCP API key
  const generateMcpKey = async () => {
    setGeneratingMcpKey(true);
    try {
      // Assuming there's an endpoint for generating MCP key
      const res = await settingsApi.post('/api/settings/mcp-key', {}, { auth: true });
      setRevealedMcpKey(res.data.key);
    } catch (err) {
      alert('Failed to generate MCP key');
    } finally {
      setGeneratingMcpKey(false);
    }
  };

  return (
    <div className="space-y-3">
      {revealedKey && (
        <div className="rounded-[10px] border border-emerald-800/40 bg-emerald-950/20 p-4">
          <p className="mb-2.5 text-[12px] font-semibold text-emerald-400">Copy this key — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12px] text-emerald-600 dark:text-emerald-300">
              {revealedKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(revealedKey);
                setRevealedKey(null);
              }}
              className="shrink-0 h-8 cursor-pointer rounded-[8px] border border-emerald-800/40 bg-emerald-950/30 px-3 text-[12px] font-medium text-emerald-400 transition hover:bg-emerald-950/50"
            >
              Copy & close
            </button>
          </div>
        </div>
      )}

      {/* MCP Key Generation Section */}
      {revealedMcpKey && (
        <div className="rounded-[10px] border border-emerald-800/40 bg-emerald-950/20 p-4">
          <p className="mb-2.5 text-[12px] font-semibold text-emerald-400">MCP API Key (copy now — won't be shown again):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12px] text-emerald-600 dark:text-emerald-300">
              {revealedMcpKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(revealedMcpKey);
                setRevealedMcpKey(null);
              }}
              className="shrink-0 h-8 cursor-pointer rounded-[8px] border border-emerald-800/40 bg-emerald-950/30 px-3 text-[12px] font-medium text-emerald-400 transition hover:bg-emerald-950/50"
            >
              Copy & close
            </button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-2 px-4 py-4 border-b border-c-border sm:flex-row sm:items-end sm:gap-2 sm:px-5">
          <div className="flex-1">
            <p className="mb-1.5 text-[12px] text-c-text-muted">Key name</p>
            <TextInput placeholder="e.g. Production" value={newKeyName} onChange={setNewKeyName} className="w-full" />
          </div>
          <PrimaryBtn onClick={create} disabled={creating || !newKeyName.trim()} className="w-full sm:w-auto">
            {creating ? "Generating…" : "Generate key"}
          </PrimaryBtn>
        </div>

        {keys === null ? (
          <div className="px-5 py-4"><Skeleton className="h-12 rounded-[8px] bg-surface-glass" /></div>
        ) : keys.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-c-text-muted">No API keys yet.</p>
        ) : (
          keys.map(k => (
            <div key={k.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-c-border last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-c-text">{k.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-c-text-muted">{k.key_prefix}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="text-[12px] text-c-text-muted">{new Date(k.created_at).toLocaleDateString()}</p>
                <button
                  onClick={() => revoke(k.id)}
                  disabled={revoking === k.id}
                  className="cursor-pointer text-[12px] text-red-500/60 transition hover:text-red-400 disabled:opacity-40"
                >
                  {revoking === k.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* Button to generate MCP key */}
      <div className="mt-4">
        <button
          onClick={generateMcpKey}
          disabled={generatingMcpKey}
          className="w-full h-8 cursor-pointer rounded-[8px] bg-[#ff3d6a] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#e8304f] disabled:opacity-50"
        >
          {generatingMcpKey ? "Generating MCP Key…" : "Generate MCP API Key"}
        </button>
      </div>

      <p className="text-[12px] text-c-text-muted">
        Never share API keys in client-side code or public repos — they grant full workspace access.
      </p>
    </div>
  );
}