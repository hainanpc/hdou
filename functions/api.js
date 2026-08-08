// functions/api.js
const HOST = "https://eyeonneb.cc";
const API = HOST + "/api";
const PLATFORM_KEY = "7961beb44246e3012ce228d6b5ced05a";
const VERSION = "2.0.0";
const DEVICE_TYPE = "web";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 保存最近一次 API 原始返回，方便调试
let LAST_API_RAW = null;

// ==================== 工具函数 ====================
function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(keyStr, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

async function aesCbcEncrypt(data, key, iv) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, data);
  return new Uint8Array(encrypted);
}

async function aesCbcDecrypt(data, key, iv) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, data);
  return new Uint8Array(decrypted);
}

function pkcs7Pad(data) {
  const n = 16 - (data.length % 16);
  const pad = new Uint8Array(data.length + n);
  pad.set(data);
  pad.fill(n, data.length);
  return pad;
}

function pkcs7Unpad(data) {
  const n = data[data.length - 1];
  if (n < 1 || n > 16) return data;
  return data.slice(0, data.length - n);
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

// ==================== 核心请求 ====================
async function callApi(path, data = {}, sessionId) {
  path = "/" + path.replace(/^\//, "");
  const rid = crypto.randomUUID();
  const ridHex = rid.replace(/-/g, "");
  const key = await hmacSha256(PLATFORM_KEY, new Uint8Array(ridHex.match(/.{1,2}/g).map(b => parseInt(b, 16))));
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const payload = JSON.stringify({
    token: "",
    deviceId: sessionId,
    data: data || {}
  });
  const raw = new TextEncoder().encode(payload);
  const compressed = await gzipCompress(raw);
  const padded = pkcs7Pad(compressed);
  const encrypted = await aesCbcEncrypt(padded, key, iv);
  const body = new Uint8Array(iv.length + encrypted.length);
  body.set(iv, 0);
  body.set(encrypted, iv.length);

  const ts = Math.floor(Date.now() / 1000);
  const signStr = `Dart|${sessionId}|${rid}|${ts}|${path}`;
  const signHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signStr));
  const sign = toHex(signHash) + "-" + ts;

  const headers = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Origin": HOST,
    "Referer": HOST + "/home",
    "Content-Type": "application/octet-stream",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "version": VERSION,
    "deviceType": DEVICE_TYPE,
    "time": String(ts),
    "sign": sign,
    "requestId": rid,
    "sessionId": sessionId,
    "deviceBrand": "",
    "deviceModel": "",
    "systemName": "",
    "systemVersion": ""
  };

  const res = await fetch(API + path, {
    method: "POST",
    headers,
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} ${res.status} body=${text.slice(0, 300)}`);
  }

  const blob = new Uint8Array(await res.arrayBuffer());
  if (blob.length < 32 || (blob.length - 16) % 16 !== 0) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(blob));
      LAST_API_RAW = parsed;
      return parsed;
    } catch {
      LAST_API_RAW = { _raw_len: blob.length, _hint: "not json" };
      return {};
    }
  }

  const plain = pkcs7Unpad(await aesCbcDecrypt(blob.slice(16), key, blob.slice(0, 16)));
  let final = plain;
  if (plain[0] === 0x1f && plain[1] === 0x8b) {
    final = await gzipDecompress(plain);
  }
  const parsed = JSON.parse(new TextDecoder().decode(final));
  LAST_API_RAW = parsed;
  return parsed;
}

// ==================== 数据转换 ====================
function listData(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (data.data && typeof data.data === "object") return listData(data.data);
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
  const remarks = item.update_label || item.corner || (item.episode_count ? `全${item.episode_count}集` : "");
  return {
    vod_id: vid,
    vod_name: item.name || item.title || item.t || vid,
    vod_pic: proxyUrl(base, item.img_x || item.img || item.img_y || item.cover || item.pic || ""),
    vod_remarks: remarks
  };
}

async function getClasses(sessionId) {
  const arr = [{ type_id: "all", type_name: "全部短剧" }];
  try {
    const data = await callApi("/drama/navList", {}, sessionId);
    for (const item of listData(data.data || data)) {
      const tid = String(item.code || item.id || item.cat_id || "");
      const name = item.name || item.title || tid;
      if (tid && name) arr.push({ type_id: tid, type_name: name });
    }
  } catch (e) {
    // 忽略分类错误，至少返回全部
  }
  return arr;
}

// ==================== 业务接口 ====================
async function homeContent(base, sessionId) {
  const data = await callApi("/drama/list", { page: "1", page_size: "18" }, sessionId);
  const classes = await getClasses(sessionId);
  const items = listData(data);
  return {
    class: classes,
    list: items.map(x => toVod(x, base)),
    parse: 0,
    jx: 0,
    _debug: {
      raw_type: typeof data,
      raw_keys: data && typeof data === "object" ? Object.keys(data) : [],
      list_len: items.length,
      classes_len: classes.length,
      raw_sample: data,
      last_api: LAST_API_RAW
    }
  };
}

async function categoryContent(tid, pg, extend, base, sessionId) {
  let items = [];
  let raw = null;
  if (tid === "yuandou") {
    raw = await callApi("/drama/navBlock", { code: "yuandou", tab: "recommend", page: String(pg) }, sessionId);
    const blocks = listData(raw.data || raw);
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) items = items.concat(b.items);
      else if (b && (b.id || b.drama_id)) items.push(b);
    }
  } else {
    const req = { page: String(pg), page_size: "18" };
    if (tid && tid !== "all" && tid !== "recommend") {
      req.cat_id = tid;
    }
    if (extend?.order) req.order = extend.order;
    if (extend?.update_status) req.update_status = extend.update_status;
    raw = await callApi("/drama/list", req, sessionId);
    items = listData(raw);
  }
  return {
    page: Number(pg),
    pagecount: items.length < 18 ? Number(pg) : Number(pg) + 1,
    limit: 18,
    total: 99999,
    list: items.map(x => toVod(x, base)),
    parse: 0,
    jx: 0,
    _debug: {
      tid,
      items_len: items.length,
      raw_keys: raw && typeof raw === "object" ? Object.keys(raw) : [],
      raw_sample: raw,
      last_api: LAST_API_RAW
    }
  };
}

async function detailContent(ids, base, sessionId) {
  const vid = sid(ids[0]);
  const obj = await callApi("/drama/detail", { id: vid }, sessionId);
  let data = obj?.data || obj;
  if (!data || typeof data !== "object") {
    return { list: [], _debug: { obj, last_api: LAST_API_RAW } };
  }

  if (Array.isArray(data.episodes)) {
    data.episodes.forEach(ep => {
      if (ep && typeof ep === "object") {
        ep.is_buy = true;
        ep.type = "free";
        ep.price = 0;
        ep.methods = [];
      }
    });
  }
  Object.assign(data, {
    pay_type: "free", money: 0, episode_price: 0, points_price: 0,
    can_vip_watch: true, is_buy_whole: true,
    vip_episodes: [], coin_episodes: [], points_episodes: []
  });

  const vod_id = sid(data.id || data.drama_id || vid);
  const name = data.name || data.title || data.t || vod_id;
  const eps = Array.isArray(data.episodes) ? data.episodes : [];
  const count = Number(data.episode_count || data.free_episodes || eps.length || 1);

  let play = [];
  if (eps.length) {
    eps.forEach((ep, i) => {
      const seq = ep.seq || ep.episode || ep.ep || (i + 1);
      play.push(`${ep.name || ep.title || `第${seq}集`}$${vod_id}|${seq}`);
    });
  } else {
    for (let i = 1; i <= count; i++) play.push(`第${i}集$${vod_id}|${i}`);
  }

  return {
    list: [{
      vod_id,
      vod_name: name,
      vod_pic: proxyUrl(base, data.img_x || data.img || data.img_y || data.cover || data.pic || ""),
      type_name: data.category || data.type || "",
      vod_year: "",
      vod_area: "",
      vod_remarks: data.update_label || `全${count}集`,
      vod_actor: "",
      vod_director: "",
      vod_content: data.description || data.summary || data.intro || name,
      vod_play_from: "黄豆短剧",
      vod_play_url: play.join("#")
    }],
    parse: 0,
    jx: 0
  };
}

async function searchContent(key, pg, base, sessionId) {
  const data = await callApi("/drama/list", { page: String(pg), page_size: "18", keywords: String(key) }, sessionId);
  const items = listData(data);
  return {
    page: Number(pg),
    pagecount: items.length < 18 ? Number(pg) : Number(pg) + 1,
    limit: 18,
    total: 99999,
    list: items.map(x => toVod(x, base)),
    parse: 0,
    jx: 0,
    _debug: {
      key,
      items_len: items.length,
      raw_keys: data && typeof data === "object" ? Object.keys(data) : [],
      raw_sample: data,
      last_api: LAST_API_RAW
    }
  };
}

async function playerContent(id, base, sessionId) {
  const [vid, seq] = String(id).split("|");
  const realVid = sid(vid);
  const realSeq = seq || "1";

  let url = "";
  let raw = null;
  try {
    raw = await callApi("/drama/play", { id: realVid, seq: realSeq }, sessionId);
    const data = raw?.data || {};
    url = data.m3u8 || data.url || "";
  } catch (e) {}

  if (!url) {
    url = `${HOST}/api/drama/hls/${realVid}/${realSeq}/play.m3u8?line=free`;
  }

  const playUrl = proxyUrl(base, url);
  const header = {
    "User-Agent": UA,
    "Referer": HOST + "/home",
    "Origin": HOST,
    "Accept": "*/*"
  };

  return {
    parse: 0,
    playUrl: "",
    url: playUrl,
    jx: 0,
    header,
    headers: header,
    format: "application/x-mpegURL",
    _debug: { raw, last_api: LAST_API_RAW }
  };
}

// ==================== 入口 ====================
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const base = url.origin;
  const ac = url.searchParams.get("ac") || url.searchParams.get("action") || "home";
  const sessionId = uuid();

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
            sub: url.searchParams.get("sub")
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
      // 纯调试：只看原始 API 返回
      case "debug": {
        const path = url.searchParams.get("path") || "/drama/list";
        const raw = await callApi(path, { page: "1", page_size: "18" }, sessionId);
        result = { path, raw, keys: raw && typeof raw === "object" ? Object.keys(raw) : [] };
        break;
      }
      default:
        result = { error: "unknown action", ac };
    }

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message || String(e),
      last_api: LAST_API_RAW
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}