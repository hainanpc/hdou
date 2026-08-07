 
// functions/proxy.js
const HOST = "https://xqjzvcvt.top";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get("url");

  if (!target) {
    return new Response("missing url", { status: 400 });
  }

  try {
    const headers = {
      "User-Agent": UA,
      "Accept": "*/*",
      "Origin": HOST,
      "Referer": HOST + "/home"
    };

    // 支持 Range
    const range = request.headers.get("Range");
    if (range) headers["Range"] = range;

    const res = await fetch(target, { headers });
    const ctype = res.headers.get("content-type") || "application/octet-stream";
    const data = await res.arrayBuffer();
    const u8 = new Uint8Array(data);

    // 判断是否为 m3u8
    const isM3u8 =
      target.split("?")[0].endsWith(".m3u8") ||
      ctype.toLowerCase().includes("mpegurl") ||
      (u8.length > 7 && String.fromCharCode(...u8.slice(0, 7)) === "#EXTM3U");

    if (isM3u8) {
      let text = new TextDecoder("utf-8").decode(u8);
      const baseUrl = target;
      const origin = url.origin;

      // 重写 m3u8
      const lines = text.split(/\r?\n/);
      const out = [];
      for (const line of lines) {
        const s = line.trim();
        if (!s) {
          out.push(line);
          continue;
        }
        if (s.startsWith("#")) {
          // 处理 URI="..."
          out.push(line.replace(/URI="([^"]+)"/g, (m, raw) => {
            if (raw.startsWith(origin)) return m;
            const abs = new URL(raw, baseUrl).href;
            return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;
          }));
          continue;
        }
        // 普通分片地址
        const abs = new URL(s, baseUrl).href;
        out.push(`${origin}/proxy?url=${encodeURIComponent(abs)}`);
      }

      const body = out.join("\n") + "\n";
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    }

    // 普通资源透传
    const respHeaders = {
      "Content-Type": ctype,
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache"
    };
    if (res.headers.get("content-range")) respHeaders["Content-Range"] = res.headers.get("content-range");
    if (res.headers.get("content-length")) respHeaders["Content-Length"] = res.headers.get("content-length");

    return new Response(data, {
      status: res.status,
      headers: respHeaders
    });
  } catch (e) {
    return new Response(`proxy error: ${e.message}`, { status: 500 });
  }
}