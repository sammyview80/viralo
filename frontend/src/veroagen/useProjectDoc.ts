import { useCallback, useEffect, useRef, useState } from "react";
import { veroagenApi } from "./api";
import type { ProjectDoc, Scene, Shot } from "./types";

export function useProjectDoc(projectId: string) {
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    veroagenApi.getProject(projectId).then((r) => alive && setDoc(r.doc));

    const connect = () => {
      const ws = new WebSocket(veroagenApi.wsUrl(projectId));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "doc") setDoc(msg.doc);
      };
      ws.onclose = () => {
        if (alive) setTimeout(connect, 2000); // re-sync via initial doc on reconnect
      };
      wsRef.current = ws;
    };
    connect();

    return () => {
      alive = false;
      wsRef.current?.close();
    };
  }, [projectId]);

  const sendMessage = useCallback(async (text: string) => {
    setSending(true);
    try {
      const r = await veroagenApi.chat(projectId, text);
      setDoc(r.doc);
    } finally {
      setSending(false);
    }
  }, [projectId]);

  const saveScript = useCallback(async (scenes: Scene[]) => {
    const r = await veroagenApi.putScript(projectId, scenes);
    setDoc(r.doc);
  }, [projectId]);

  const saveShots = useCallback(async (shots: Shot[]) => {
    const r = await veroagenApi.putStoryboard(projectId, shots);
    setDoc(r.doc);
  }, [projectId]);

  return { doc, setDoc, sendMessage, saveScript, saveShots, sending };
}
