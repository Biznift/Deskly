export function getDefaultSignalingHttpUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SIGNALING_HTTP_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:8080"
  );
}

export function httpToWs(url: string): string {
  const u = new URL(url);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/";
  u.search = "";
  u.hash = "";
  // WebSocket path is root on signaling server
  return u.toString().replace(/\/$/, "");
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatHostId(id: string): string {
  const d = digitsOnly(id);
  return d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}
