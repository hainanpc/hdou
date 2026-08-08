// functions/proxy.js
// 黄豆短剧 - CF Pages 播放代理（CloudFront 直连优化）

const FALLBACK_ORIGIN = "https://ahgehbki.cc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** CloudFront 可公网直连，不必再走 CF 代理 */
function shouldDirect(u) {
  try {
    const h = new URL(u).hostname;
    return h.endsWith("cloudfront.net") || h.includes("cloudfront.net");
  } catch {
    return false;
  }
}

function isM3u8(target, contentType, buffer) {
  const path = target.split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8")) return true;
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("mpegurl") || ct.includes("application/vnd.apple.mpegurl")) {
    return true;
  }
  if (buffer && buffer.length > 7) {
    const head = String.fromCharCode(
      buffer[0],
      buffer[1],
      buffer[2],
      buffer[3],
      buffer[4],
      buffer[5],
      buffer[6]
    );
    if (head === "#EXTM3U") return true;
  }
  return false;
}

function rewriteM3u8(text, origin, base) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) {
      lines.push(line);
      continue;
    }

    // #EXT-X-KEY:URI="..." 等
    if (s.startsWith("#")) {
      lines.push(
        line.replace(/URI="([^"]+)"/gi, (all, uri) => {
          try {
            const abs = new URL(uri, base).href;
            if (shouldDirect(abs) || abs.startsWith(origin)) {
              return `URI="${abs}"`;
            }
            return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;
          } catch {
            return all;
          }
        })
      );
      continue;
    }

    // ts / 其它媒体行
    try {
      const abs = new URL(s, base).href;
      if (shouldDirect(abs)) {
        lines.push(abs); // CloudFront 直链
      } else {
        lines.push(`${origin}/proxy?url=${encodeURIComponent(abs)}`);
      }
    } catch {
      lines.push(line);
    }
  }
  return lines.join("\n") + "\n";
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get("url");

  if (!target) {
    return new Response("missing url", { status: 400 });
  }

  try {
    let originHeader = FALLBACK_ORIGIN;
    try {
      originHeader = new URL(target).origin;
    } catch (_) {}

    const headers = {
      "User-Agent": UA,
      Accept: "*/*",
      Origin: originHeader,
      Referer: originHeader + "/home",
    };

    const range = request.headers.get("Range");
    if (range) headers.Range = range;

    const res = await fetch(target, {
      headers,
      redirect: "follow",
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const buffer = new Uint8Array(await res.arrayBuffer());
    const origin = url.origin;

    // ---------- m3u8：重写后返回 ----------
    if (isM3u8(target, contentType, buffer)) {
      const text = new TextDecoder().decode(buffer);
      const output = rewriteM3u8(text, origin, target);
      return new Response(output, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ---------- ts / key / 图片等透传 ----------
    const respHeaders = {
      "Content-Type":
        res.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=3600",
    };

    const cr = res.headers.get("content-range");
    if (cr) respHeaders["Content-Range"] = cr;

    const cl = res.headers.get("content-length");
    if (cl) respHeaders["Content-Length"] = cl;

    return new Response(buffer, {
      status: res.status,
      headers: respHeaders,
    });
  } catch (e) {
    return new Response("proxy error: " + (e.message || String(e)), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
}