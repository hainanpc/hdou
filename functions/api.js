// functions/api.js
const HOST = "https://eyeonneb.cc";
const API = HOST + "/api";
const PLATFORM_KEY = "7961beb44246e3012ce228d6b5ced05a";
const VERSION = "2.0.0";
const DEVICE_TYPE = "web"; // 必须 web，android/ios 会 2001

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function uuidHex() {
  return crypto.randomUUID().replace(/-/g, "");
}

function uuidWithDash() {
  return crypto.randomUUID();
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}

async function hmacSha256(keyStr, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function aesCbcEncrypt(data, key, iv) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, data)
  );
}

async function aesCbcDecrypt(data, key, iv) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, data)
  );
}

async function gzipCompress(data) {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function gzipDecompress(data) {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function callApi(path, data = {}, sessionId) {
  path = "/" + String(path).replace(/^\//, "");
  const rid = uuidWithDash();
  const key = await hmacSha256(PLATFORM_KEY, hexToBytes(rid.replace(/-/g, "")));
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const payload = JSON.stringify({
    token: "",
    deviceId: sessionId,
    data: data || {},
  });
  const compressed = await gzipCompress(new TextEncoder().encode(payload));
  const encrypted = await aesCbcEncrypt(compressed, key, iv);

  const body = new Uint8Array(iv.length + encrypted.length);
  body.set(iv, 0);
  body.set(encrypted, iv.length);

  const ts = Math.floor(Date.now() / 1000);
  const signStr = `Dart|${sessionId}|${rid}|${ts}|${path}`;
  const signHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signStr)
  );
  const sign = toHex(signHash) + "-" + ts;

  const headers = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: HOST,
    Referer: HOST + "/home",
    "Content-Type": "application/octet-stream",
    version: VERSION,
    deviceType: DEVICE_TYPE,
    time: String(ts),
    sign: sign,
    requestId: rid,
    sessionId: sessionId,
    deviceBrand: "",
    deviceModel: "",
    systemName: "",
    systemVersion: "",
  };

  const res = await fetch(API + path, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} ${res.status} body=${text.slice(0, 200)}`);
  }

  const blob = new Uint8Array(await res.arrayBuffer());
  if (blob.length < 32 || (blob.length - 16) % 16 !== 0) {
    try {
      return JSON.parse(new TextDecoder().decode(blob));
    } catch {
      return {};
    }
  }

  let plain = await aesCbcDecrypt(blob.slice(16), key, blob.slice(0, 16));
  if (plain[0] === 0x1f && plain[1] === 0x8b) {
    plain = await gzipDecompress(plain);
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/** 从接口结果中取出列表：支持 {data:{list:[]}} / {list:[]} / 数组 */
function listData(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  // 业务失败
  if (data.status === "n") return [];
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (data.data && typeof data.data === "object") {
    if (Array.isArray(data.data.list)) return data.data.list;
    if (Array.isArray(data.data.items)) return data.data.items;
    return listData(data.data);
  }
  return [];
}

function sid(x) {
  return String(x || "").replace(/^rp_/, "");
}

function proxyUrl(base, target) {
  if (!target) return target;
  return `${base}/proxy?url=${encodeURIComponent(target)}`;
}

function toVod(item, base) {
  item = item || {};
  const vid = sid(item.id || item.drama_id || "");
  const remarks =
    item.update_label ||
    item.corner ||
    (item.episode_count ? `全${item.episode_count}集` : "");
  return {
    vod_id: vid,
    vod_name: item.name || item.title || item.t || vid,
    vod_pic: proxyUrl(
      base,
      item.img_x || item.img || item.img_y || item.cover || item.pic || ""
    ),
    vod_remarks: remarks,
  };
}

async function getClasses(sessionId) {
  const arr = [{ type_id: "all", type_name: "全部短剧" }];
  try {
    const data = await callApi("/drama/navList", {}, sessionId);
    for (const item of listData(data)) {
      const tid = String(item.code || item.id || item.cat_id || "");
      const name = item.name || item.title || tid;
      if (tid && name) arr.push({ type_id: tid, type_name: name });
    }
  } catch (_) {}
  return arr;
}

async function homeContent(base, sessionId) {
  const data = await callApi(
    "/drama/list",
    { page: "1", page_size: "18" },
    sessionId
  );
  const classes = await getClasses(sessionId);
  return {
    class: classes,
    list: listData(data).map((x) => toVod(x, base)),
    parse: 0,
    jx: 0,
  };
}

async function categoryContent(tid, pg, extend, base, sessionId) {
  let items = [];
  if (tid === "yuandou") {
    const data = await callApi(
      "/drama/navBlock",
      { code: "yuandou", tab: "recommend", page: String(pg) },
      sessionId
    );
    const blocks = listData(data);
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) items = items.concat(b.items);
      else if (b && (b.id || b.drama_id)) items.push(b);
    }
  } else {
    const req = { page: String(pg), page_size: "18" };
    if (tid && tid !== "all" && tid !== "recommend") req.cat_id = tid;
    if (extend?.order) req.order = extend.order;
    if (extend?.update_status) req.update_status = extend.update_status;
    const data = await callApi("/drama/list", req, sessionId);
    items = listData(data);
  }
  return {
    page: Number(pg),
    pagecount: items.length < 18 ? Number(pg) : Number(pg) + 1,
    limit: 18,
    total: 99999,
    list: items.map((x) => toVod(x, base)),
    parse: 0,
    jx: 0,
  };
}

async function detailContent(ids, base, sessionId) {
  const vid = sid(ids[0]);
  const obj = await callApi("/drama/detail", { id: vid }, sessionId);
  if (!obj || obj.status === "n") return { list: [] };

  let data = obj.data || obj;
  if (!data || typeof data !== "object") return { list: [] };

  if (Array.isArray(data.episodes)) {
    data.episodes.forEach((ep) => {
      if (ep && typeof ep === "object") {
        ep.is_buy = true;
        ep.type = "free";
        ep.price = 0;
        ep.methods = [];
      }
    });
  }
  Object.assign(data, {
    pay_type: "free",
    money: 0,
    episode_price: 0,
    points_price: 0,
    can_vip_watch: true,
    is_buy_whole: true,
    vip_episodes: [],
    coin_episodes: [],
    points_episodes: [],
  });

  const vod_id = sid(data.id || data.drama_id || vid);
  const name = data.name || data.title || data.t || vod_id;
  const eps = Array.isArray(data.episodes) ? data.episodes : [];
  const count = Number(
    data.episode_count || data.free_episodes || eps.length || 1
  );

  let play = [];
  if (eps.length) {
    eps.forEach((ep, i) => {
      const seq = ep.seq || ep.episode || ep.ep || i + 1;
      play.push(`${ep.name || ep.title || `第${seq}集`}$${vod_id}|${seq}`);
    });
  } else {
    for (let i = 1; i <= count; i++) play.push(`第${i}集$${vod_id}|${i}`);
  }

  return {
    list: [
      {
        vod_id,
        vod_name: name,
        vod_pic: proxyUrl(
          base,
          data.img_x || data.img || data.img_y || data.cover || data.pic || ""
        ),
        type_name: data.category || data.type || "",
        vod_year: "",
        vod_area: "",
        vod_remarks: data.update_label || `全${count}集`,
        vod_actor: "",
        vod_director: "",
        vod_content: data.description || data.summary || data.intro || name,
        vod_play_from: "黄豆短剧",
        vod_play_url: play.join("#"),
      },
    ],
    parse: 0,
    jx: 0,
  };
}

async function searchContent(key, pg, base, sessionId) {
  const data = await callApi(
    "/drama/list",
    { page: String(pg), page_size: "18", keywords: String(key) },
    sessionId
  );
  const items = listData(data);
  return {
    page: Number(pg),
    pagecount: items.length < 18 ? Number(pg) : Number(pg) + 1,
    limit: 18,
    total: 99999,
    list: items.map((x) => toVod(x, base)),
    parse: 0,
    jx: 0,
  };
}

async function playerContent(id, base, sessionId) {
  const [vid, seq] = String(id).split("|");
  const realVid = sid(vid);
  const realSeq = seq || "1";

  let url = "";
  try {
    const obj = await callApi(
      "/drama/play",
      { id: realVid, seq: realSeq },
      sessionId
    );
    const d = obj?.data || {};
    url = d.m3u8 || d.url || "";
  } catch (_) {}

  if (!url) {
    url = `${HOST}/api/drama/hls/${realVid}/${realSeq}/play.m3u8?line=free`;
  }

  const playUrl = proxyUrl(base, url);
  const header = {
    "User-Agent": UA,
    Referer: HOST + "/home",
    Origin: HOST,
    Accept: "*/*",
  };

  return {
    parse: 0,
    playUrl: "",
    url: playUrl,
    jx: 0,
    header,
    headers: header,
    format: "application/x-mpegURL",
  };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const base = url.origin;
  const ac = url.searchParams.get("ac") || "home";
  const sessionId = uuidHex();

  try {
    let result;
    switch (ac) {
      case "home":
        result = await homeContent(base, sessionId);
        break;
      case "category":
        result = await categoryContent(
          url.searchParams.get("tid") || "all",
          url.searchParams.get("pg") || "1",
          {
            order: url.searchParams.get("order"),
            update_status: url.searchParams.get("update_status"),
            sub: url.searchParams.get("sub"),
          },
          base,
          sessionId
        );
        break;
      case "detail":
        result = await detailContent(
          (url.searchParams.get("ids") || "").split(","),
          base,
          sessionId
        );
        break;
      case "search":
        result = await searchContent(
          url.searchParams.get("wd") || url.searchParams.get("key") || "",
          url.searchParams.get("pg") || "1",
          base,
          sessionId
        );
        break;
      case "play":
        result = await playerContent(
          url.searchParams.get("id") || "",
          base,
          sessionId
        );
        break;
      default:
        result = { error: "unknown action", ac };
    }

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}