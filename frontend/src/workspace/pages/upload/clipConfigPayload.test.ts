// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ClipConfig } from "@/lib/api";
import { DEFAULT_CONFIG, buildStudioModalClipConfig } from "./constants";

describe("clip config upload payload", () => {
  it("includes language and skip_caption in JSON payload", () => {
    const cfg: ClipConfig = {
      ...DEFAULT_CONFIG,
      language: "ja",
      skip_caption: true,
    };
    const payload = JSON.parse(JSON.stringify(cfg)) as ClipConfig;
    expect(payload.language).toBe("ja");
    expect(payload.skip_caption).toBe(true);
  });

  it("keeps skip_caption independent of add_captions burn toggle", () => {
    const cfg: ClipConfig = {
      ...DEFAULT_CONFIG,
      add_captions: true,
      skip_caption: true,
      language: "hi",
    };
    const payload = JSON.parse(JSON.stringify(cfg)) as ClipConfig;
    expect(payload.add_captions).toBe(true);
    expect(payload.skip_caption).toBe(true);
    expect(payload.language).toBe("hi");
  });

  it("no caption (skip_caption) works with subtitles off", () => {
    const cfg: ClipConfig = {
      ...DEFAULT_CONFIG,
      add_captions: false,
      skip_caption: true,
    };
    const payload = JSON.parse(JSON.stringify(cfg)) as ClipConfig;
    expect(payload.add_captions).toBe(false);
    expect(payload.skip_caption).toBe(true);
  });
  it("studio modal payload sets skip_caption independently of add_captions", () => {
    const cfg = buildStudioModalClipConfig({
      ratio: "9:16",
      captionStyle: "tiktok",
      addCaptions: true,
      skipCaption: true,
    });
    const payload = JSON.parse(JSON.stringify(cfg)) as ClipConfig;
    expect(payload.add_captions).toBe(true);
    expect(payload.skip_caption).toBe(true);
  });

});
