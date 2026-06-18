type ClassValue = string | false | null | undefined;

export function cn(...inputs: ClassValue[]) {
  return inputs.filter(Boolean).join(" ");
}

export function safeFilename(title: string | null | undefined, ext: string): string {
  return (title ?? "clip").replace(/[^a-z0-9]/gi, "_").slice(0, 60) + "." + ext;
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function triggerAnchorDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function addCloudinaryAttachment(href: string, filename: string): string {
  // fl_attachment:name sets Content-Disposition: attachment; filename="name"
  // Cloudinary requires the name without extension and with special chars encoded
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_");
  return href.replace(/(\/upload\/)((?:[^/]+\/)*)/, `$1fl_attachment:${stem}/$2`);
}

export async function downloadUrl(href: string, filename: string): Promise<void> {
  if (href.includes("cloudinary.com")) {
    triggerAnchorDownload(addCloudinaryAttachment(href, filename), filename);
    return;
  }

  // Same-origin or CORS-permissive: fetch as blob to force save dialog
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerAnchorDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    triggerAnchorDownload(href, filename);
  }
}

export function stripSrtTimecodes(srt: string): string {
  return srt.replace(/^\d+\n[\d:,]+ --> [\d:,]+\n/gm, "").replace(/\n{2,}/g, " ").trim();
}
