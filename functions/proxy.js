// functions/proxy.js
const HOST = "https://eyeonneb.cc"; // 与你 api.js 里 HOST 保持一致
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function shouldDirect(u) {
  try {
    const h = new URL(u).hostname;
    // CloudFront / 图床可直连，不走 CF 代理，播放更稳
    return (
      h.endsWith("cloudfront.net") ||
      h.includes("cloudfront.net")
    );
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400 });

  try {
    const headers = {
      "User-Agent": UA,
      Accept: "*/*",
      Origin: HOST,
      Referer: HOST + "/home",
    };
    const range = request.headers.get("Range");
    if (range) headers["Range"] = range;

    const res = await fetch(target, { headers, redirect: "follow" });
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const pathOnly = target.split("?")[0].toLowerCase();
    const isM3u8 =
      pathOnly.endsWith(".m3u8") ||
      ctype.includes("mpegurl") ||
      ctype.includes("application/vnd.apple.mpegurl") ||
      (u8.length > 7 &&
        String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5], u8[6]) ===
          "#EXTM3U");

    const origin = url.origin;

    if (isM3u8) {
      const text = new TextDecoder("utf-8").decode(u8);
      const out = [];
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) {
          out.push(line);
          continue;
        }
        if (s.startsWith("#")) {
          out.push(
            line.replace(/URI="([^"]+)"/gi, (_, raw) => {
              try {
                const abs = new URL(raw, target).href;
                if (shouldDirect(abs) || abs.startsWith(origin)) {
                  return `URI="${abs}"`;
                }
                return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;
              } catch {
                return `URI="${raw}"`;
              }
            })
          );
          continue;
        }
        try {
          const abs = new URL(s, target).href;
          if (shouldDirect(abs)) {
            out.push(abs); // 分片直连 CloudFront
          } else {
            out.push(`${origin}/proxy?url=${encodeURIComponent(abs)}`);
          }
        } catch {
          out.push(s);
        }
      }
      return new Response(out.join("\n") + "\n", {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    }

    const respHeaders = {
      "Content-Type": res.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };
    if (res.headers.get("content-range")) {
      respHeaders["Content-Range"] = res.headers.get("content-range");
    }
    if (res.headers.get("content-length")) {
      respHeaders["Content-Length"] = res.headers.get("content-length");
    }
    return new Response(buf, { status: res.status, headers: respHeaders });
  } catch (e) {
    return new Response(`proxy error: ${e.message}`, { status: 500 });
  }
}