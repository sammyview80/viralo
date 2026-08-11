#!/usr/bin/env node
// Viralo CLI — OAuth device login + MCP tool access from the terminal.
// Zero dependencies: Node 18+ built-ins only (global fetch, fs, os, child_process).

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = process.env.VIRALO_API_BASE || "https://app.viraloapp.tech/api/v1";
const CONFIG_DIR = join(homedir(), ".viralo");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");

function loadCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveCredentials(creds) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
  chmodSync(CREDENTIALS_PATH, 0o600);
}

function requireCredentials() {
  const creds = loadCredentials();
  if (!creds?.api_key) {
    console.error("Not logged in. Run `viralo login` first.");
    process.exit(1);
  }
  return creds;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, platform === "win32" ? ["", url] : [url], { detached: true, stdio: "ignore", shell: platform === "win32" }).unref();
  } catch {
    // best-effort — the URL is printed either way
  }
}

async function apiPost(path, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = json?.detail || json?.error?.message || res.statusText;
    throw new Error(`${res.status} ${detail}`);
  }
  return json;
}

async function mcpCall(apiKey, method, params) {
  const json = await apiPost("/mcp", { jsonrpc: "2.0", id: 1, method, params }, apiKey);
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── Commands ─────────────────────────────────────────────────────────── */

async function cmdLogin() {
  const { device_code, user_code, verification_uri_complete, expires_in, interval } =
    await apiPost("/device/code", {});

  console.log("");
  console.log(`  Your code: ${user_code}`);
  console.log(`  Opening ${verification_uri_complete} — authorize this code to continue.`);
  console.log("");
  openBrowser(verification_uri_complete);

  const deadline = Date.now() + expires_in * 1000;
  const pollMs = Math.max(interval, 2) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let result;
    try {
      result = await apiPost("/device/token", { device_code });
    } catch (err) {
      console.error(`Login failed: ${err.message}`);
      process.exit(1);
    }
    if (result.status === "approved") {
      saveCredentials({ api_key: result.api_key, api_base: API_BASE, created_at: new Date().toISOString() });
      console.log("Logged in. Credentials saved to ~/.viralo/credentials.json");
      console.log("Run `viralo mcp print` to get a ready-to-use MCP client config.");
      return;
    }
  }
  console.error("Login timed out — run `viralo login` again.");
  process.exit(1);
}

function cmdLogout() {
  if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
  console.log("Logged out.");
}

async function cmdWhoami() {
  const { api_key } = requireCredentials();
  const result = await mcpCall(api_key, "tools/call", { name: "get_workspace_context", arguments: {} });
  console.log(result.content[0].text);
}

function cmdMcpPrint() {
  const { api_key, api_base } = requireCredentials();
  const endpoint = (api_base || API_BASE).replace(/\/$/, "");
  const config = {
    mcpServers: {
      viralo: {
        url: `${endpoint}/mcp`,
        headers: { "x-api-key": api_key },
      },
    },
  };
  console.log(JSON.stringify(config, null, 2));
}

async function cmdTools() {
  const { api_key } = requireCredentials();
  const result = await mcpCall(api_key, "tools/list", {});
  for (const tool of result.tools) {
    console.log(`${tool.name} — ${tool.description}`);
  }
}

async function cmdCall(toolName, argsJson) {
  const { api_key } = requireCredentials();
  if (!toolName) {
    console.error("Usage: viralo call <tool_name> ['<json args>']");
    process.exit(1);
  }
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Args must be valid JSON, e.g. viralo call list_clips '{\"page\":1}'");
      process.exit(1);
    }
  }
  const result = await mcpCall(api_key, "tools/call", { name: toolName, arguments: args });
  console.log(result.content[0].text);
}

function printHelp() {
  console.log(`viralo — Viralo CLI

Usage:
  viralo login                     Authorize this machine via OAuth device flow
  viralo logout                    Remove stored credentials
  viralo whoami                    Show the authenticated workspace
  viralo tools                     List available MCP tools
  viralo call <tool> ['<json>']    Call an MCP tool directly
  viralo mcp print                 Print an mcp.json config for other MCP clients

Env:
  VIRALO_API_BASE   Override the API base (default: ${API_BASE})
`);
}

/* ─── Entry ────────────────────────────────────────────────────────────── */

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case "login": await cmdLogin(); break;
    case "logout": cmdLogout(); break;
    case "whoami": await cmdWhoami(); break;
    case "tools": await cmdTools(); break;
    case "call": await cmdCall(rest[0], rest[1]); break;
    case "mcp":
      if (rest[0] === "print") { cmdMcpPrint(); break; }
      printHelp();
      break;
    default:
      printHelp();
  }
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
