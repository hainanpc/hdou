// functions/api.js
// 黄豆短剧 CF Pages版
// OK影视5.1.6适配
const HOSTS = [
    "https://ahgehbki.cc",
    "https://jpgrmkkn.cc",
    "https://ufufukpq.cc",
    "https://nhuhkizw.cc",
    "https://hddj01.com",
    "https://hddj02.com",
    "https://hddj03.com",
    "https://hddj08.com",
    "https://hddj09.com",
    "https://hddj22.com"
];
let HOST_INDEX = 0;
let HOST = HOSTS[HOST_INDEX];
const PLATFORM_KEY = "7961beb44246e3012ce228d6b5ced05a";
const VERSION = "2.0.0";
const DEVICE_TYPE = "web";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const PAGE_SIZE = 18;

// ================= 工具函数 =================
/** 去除rp_前缀 */
function sid(x) {
    const str = String(x ?? "");
    return str.replace(/^rp_/, "");
}

/** Uint8Array 转十六进制字符串 */
function toHex(buf) {
    if (!(buf instanceof Uint8Array)) return "";
    return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 十六进制字符串转 Uint8Array */
function hexBytes(hex) {
    const safeHex = String(hex ?? "").replace(/[^0-9a-fA-F]/g, "");
    const a = new Uint8Array(safeHex.length / 2);
    for (let i = 0; i < a.length; i++) {
        a[i] = parseInt(safeHex.substr(i * 2, 2), 16);
    }
    return a;
}

/** 切换下一个HOST节点 */
function nextHost() {
    HOST_INDEX = (HOST_INDEX + 1) % HOSTS.length;
    HOST = HOSTS[HOST_INDEX];
}

// ================= HMAC-SHA256 签名密钥生成 =================
async function makeKey(rid) {
    const rawKey = new TextEncoder().encode(PLATFORM_KEY);
    const key = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const ridBuf = hexBytes(rid.replace(/-/g, ""));
    const signBuf = await crypto.subtle.sign("HMAC", key, ridBuf);
    return new Uint8Array(signBuf);
}

// ================= AES-CBC 加解密 =================
async function aesEncrypt(data, key, iv) {
    try {
        const aesKey = await crypto.subtle.importKey(
            "raw",
            key,
            { name: "AES-CBC" },
            false,
            ["encrypt"]
        );
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv },
            aesKey,
            data
        );
        return new Uint8Array(encrypted);
    } catch (err) {
        console.error("AES加密失败:", err);
        throw err;
    }
}

async function aesDecrypt(data, key, iv) {
    try {
        const aesKey = await crypto.subtle.importKey(
            "raw",
            key,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
        );
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv },
            aesKey,
            data
        );
        return new Uint8Array(decrypted);
    } catch (err) {
        console.error("AES解密失败:", err);
        throw err;
    }
}

// ================= Gzip 压缩/解压 =================
async function gzipCompress(data) {
    try {
        const cs = new CompressionStream("gzip");
        const w = cs.writable.getWriter();
        w.write(data);
        await w.close();
        const ab = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(ab);
    } catch (err) {
        console.error("gzip压缩失败:", err);
        throw err;
    }
}

async function gzipDecompress(data) {
    try {
        const ds = new DecompressionStream("gzip");
        const w = ds.writable.getWriter();
        w.write(data);
        await w.close();
        const ab = await new Response(ds.readable).arrayBuffer();
        return new Uint8Array(ab);
    } catch (err) {
        console.error("gzip解压失败:", err);
        throw err;
    }
}

// ================= 核心API请求（带HOST轮询重试） =================
async function callApi(path, data = {}, retry = 3) {
    if (retry <= 0) throw new Error("所有节点请求全部失败");
    path = "/" + path.replace(/^\/+/, "");
    // 生成请求ID
    let rid;
    try {
        rid = crypto.randomUUID();
    } catch {
        // 低版本兼容兜底UUID
        rid = Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
    const key = await makeKey(rid);
    const iv = crypto.getRandomValues(new Uint8Array(16));

    // 组装请求原始数据
    const rawPayload = JSON.stringify({
        token: "",
        deviceId: rid.replace(/-/g, ""),
        data: data
    });
    const rawBuf = new TextEncoder().encode(rawPayload);
    const compressed = await gzipCompress(rawBuf);
    const encrypted = await aesEncrypt(compressed, key, iv);

    // 拼接iv+密文
    const body = new Uint8Array(16 + encrypted.length);
    body.set(iv, 0);
    body.set(encrypted, 16);

    // 签名计算
    const ts = Math.floor(Date.now() / 1000);
    const ridNoDash = rid.replace(/-/g, "");
    const signText = `Dart|${ridNoDash}|${rid}|${ts}|${path}`;
    const signHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signText));
    const sign = `${toHex(signHashBuf)}-${ts}`;

    try {
        const res = await fetch(`${HOST}/api${path}`, {
            method: "POST",
            headers: {
                "User-Agent": UA,
                "Content-Type": "application/octet-stream",
                "Origin": new URL(HOST).origin,
                "Referer": `${HOST}/home`,
                version: VERSION,
                deviceType: DEVICE_TYPE,
                time: String(ts),
                sign: sign,
                requestId: rid,
                sessionId: rid
            },
            body: body
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());

        // 短数据直接JSON解析（未加密）
        if (buf.length < 32) {
            try {
                return JSON.parse(new TextDecoder().decode(buf));
            } catch {
                return {};
            }
        }

        // 拆分iv与密文并解密
        const respIv = buf.slice(0, 16);
        const respEnc = buf.slice(16);
        let plain = await aesDecrypt(respEnc, key, respIv);

        // 判断是否gzip压缩
        if (plain[0] === 0x1f && plain[1] === 0x8b) {
            plain = await gzipDecompress(plain);
        }
        return JSON.parse(new TextDecoder().decode(plain));
    } catch (err) {
        console.warn(`节点 ${HOST} 请求失败，切换节点重试，剩余重试次数:${retry - 1}`, err.message);
        nextHost();
        return callApi(path, data, retry - 1);
    }
}

// ================= 通用列表提取工具 =================
function listData(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
    if (data.data && typeof data.data === "object") return listData(data.data);
    return [];
}

// ================= 短剧标准化 Vod 对象转换 =================
function categoryVod(item) {

    item = item || {};

    const vid = sid(
        item.id ||
        item.drama_id ||
        ""
    );

    if (!vid) return null;

    return {
        vod_id: vid,
        vod_name:
            item.name ||
            item.title ||
            vid,

        vod_pic:
            item.img ||
            item.cover ||
            item.cover_url ||
            "",

        vod_remarks:
            item.update_label ||
            item.remark ||
            ""
    };
}

// 详情页

function detailVod(item){

    const vid=sid(
        item.id ||
        item.drama_id ||
        ""
    );

    return {

        vod_id:vid,

        vod_name:
        item.name ||
        item.title ||
        vid,

        vod_pic:
        item.img ||
        item.cover ||
        "",

        vod_remarks:
        item.update_label ||
        "",

        vod_content:
        item.name || "",

        vod_play_from:
        "黄豆短剧",

        vod_play_url:
        `第1集$${vid}|1`
    };
}

// ================= 获取分类列表 =================
async function getClasses() {
    const classes = [{ type_id: "all", type_name: "全部" }];
    const data = await callApi("/drama/navList", {});
    const rawList = listData(data);
    for (const x of rawList) {
        const id = String(x.code || x.id || x.cat_id || "");
        const name = x.name || x.title || x.cat_name || "";
        if (id && name) {
            classes.push({ type_id: id, type_name: name });
        }
    }
    return classes;
}

// ================= 生成筛选条件结构 =================
async function getFilters(classes) {
    const filters = {};
    const filterTemplate = [
        {
            key: "order",
            name: "排序",
            value: [
                { n: "默认", v: "" },
                { n: "最新", v: "new" },
                { n: "最热", v: "hot" }
            ]
        },
        {
            key: "update_status",
            name: "状态",
            value: [
                { n: "全部", v: "" },
                { n: "连载", v: "0" },
                { n: "完结", v: "1" }
            ]
        }
    ];
    for (const c of classes) {
        filters[c.type_id] = JSON.parse(JSON.stringify(filterTemplate));
    }
    return filters;
}

// ================= 子分类缓存 =================
const navCache = {};
async function getNavFilter(code) {
    if (!code || code === "all") return [];
    if (navCache[code]) return navCache[code];
    const data = await callApi("/drama/navFilter", { code: String(code) });
    const result = listData(data);
    navCache[code] = result;
    return result;
}

// ================= 首页数据 =================
async function homeContent() {
    const data = await callApi("/drama/list", { page: "1", page_size: String(PAGE_SIZE) });
    const classes = await getClasses();
    return {
        class: classes,
        filters: await getFilters(classes),
        list: listData(data).map(categoryVod).filter(Boolean),
        parse: 0,
        jx: 0
    };
}

// ================= 分类列表（修复原pagecount语法错误） =================
async function categoryContent(tid, pg, extend = {}) {
    const page = String(pg || "1");
    const req = {
        page: page,
        page_size: String(PAGE_SIZE)
    };
    const typeId = String(tid || "all");

    if (typeId !== "all") {
        const tabs = await getNavFilter(typeId);
        const subIdx = Number(extend.sub || 0);
        if (tabs[subIdx]) {
            const f = tabs[subIdx].filter || tabs[subIdx];
            if (f.cat_id) req.cat_id = String(f.cat_id);
            if (f.tag_id) req.tag_id = String(f.tag_id);
        }
    }
    if (extend.order) req.order = extend.order;
    if (extend.update_status) req.update_status = extend.update_status;

    const data = await callApi("/drama/list", req);
    const rawItems = listData(data);
    // 过滤无效条目
    const items = rawItems.filter(x => (x.id || x.drama_id || x.name || x.title));
    const pageNum = Number(page);
    // 模拟分页，真实项目可后端返回total替换99999
    const total = 99999;
    const pagecount = Math.ceil(total / PAGE_SIZE);

    return {
        page: pageNum,
        pagecount: pagecount,
        limit: PAGE_SIZE,
        total: total,
        list: items.map(categoryVod).filter(Boolean),
        class_name: "黄豆短剧",
        parse: 0,
        jx: 0
    };
}

// ================= 详情接口 =================
async function detailContent(ids) {
    const vid = sid(ids?.[0] ?? "");
    if (!vid) return { list: [] };
    const data = await callApi("/drama/detail", { id: vid });
    const d = data.data || data;
    if (!d || typeof d !== "object") return { list: [] };

    const episodes = Array.isArray(d.episodes) ? d.episodes : [];
    const play = [];
    if (episodes.length > 0) {
        for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            const name = ep.name || ep.title || `第${i + 1}集`;
            const seq = ep.seq || ep.episode || (i + 1);
            play.push(`${name}$${vid}|${seq}`);
        }
    } else {
        const count = Number(d.episode_count || d.total_episode || 1);
        for (let i = 1; i <= count; i++) {
            play.push(`第${i}集$${vid}|${i}`);
        }
    }

    return {
        list: [
            {
                vod_id: vid,
                vod_name: d.name || d.title || "",
                vod_pic: d.img_y || d.img || d.cover || "",
                vod_remarks: d.update_label || "",
                vod_content: d.description || d.desc || "",
                vod_play_from: "黄豆短剧",
                vod_play_url: play.join("#")
            }
        ],
        parse: 0,
        jx: 0
    };
}

// ================= 搜索接口 =================
async function searchContent(key, pg) {
    const page = String(pg || "1");
    const data = await callApi("/drama/list", {
        page: page,
        page_size: String(PAGE_SIZE),
        keyword: String(key || "")
    });
    const arr = listData(data);
    const total = 99999;
    const pagecount = Math.ceil(total / PAGE_SIZE);

    return {
        page: Number(page),
        pagecount: pagecount,
        limit: PAGE_SIZE,
        total: total,
        list: arr.map(categoryVod).filter(Boolean),
        parse: 0,
        jx: 0
    };
}

// ================= 播放地址接口 =================
async function playerContent(id) {
    const arr = String(id ?? "").split("|");
    const vid = sid(arr[0]);
    const seq = arr[1] || "1";
    let playUrl = "";

    try {
        const data = await callApi("/drama/play", { id: vid, seq: String(seq) });
        const d = data.data || {};
        playUrl = d.m3u8 || d.url || "";
    } catch (err) {
        console.warn("获取直链失败，使用兜底路由:", err.message);
    }
    if (!playUrl) {
        playUrl = `${HOST}/api/drama/hls/${vid}/${seq}/play.m3u8`;
    }
    const proxyUrl = `/proxy?url=${encodeURIComponent(playUrl)}`;

    return {
        parse: 0,
        jx: 0,
        url: proxyUrl,
        playUrl: "",
        header: {
            "User-Agent": UA,
            Referer: `${HOST}/home`,
            Origin: new URL(HOST).origin
        }
    };
}

// ================= CF Pages Worker 入口 =================
export async function onRequest(context) {
    const request = context.request;
    const url = new URL(request.url);
    const getParam = (k) => url.searchParams.get(k) ?? "";

    const ac = getParam("ac");
    const tid = getParam("tid") || getParam("t");
    const pg = getParam("pg") || getParam("page");
    const wd = getParam("wd");
    const ids = getParam("ids");
    let result = {};

    try {
        switch (ac) {
            case "home":
                result = await homeContent();
                break;
            case "category":
                result = await categoryContent(tid, pg, {
                    sub: getParam("sub"),
                    order: getParam("order"),
                    update_status: getParam("update_status")
                });
                break;
            case "detail":
                result = await detailContent(ids.split(","));
                break;
            case "search":
                result = await searchContent(wd, pg);
                break;
            case "play":
                result = await playerContent(getParam("id") || getParam("play"));
                break;
            default:
                if (wd) {
                    result = await searchContent(wd, pg);
                } else if (ids) {
                    result = await detailContent(ids.split(","));
                } else if (tid) {
                    result = await categoryContent(tid, pg, {});
                } else {
                    result = await homeContent();
                }
        }
        return new Response(JSON.stringify(result), {
            headers: {
                "Content-Type": "application/json;charset=utf-8",
                "Access-Control-Allow-Origin": "*"
            }
        });
    } catch (e) {
        // 移除stack堆栈，避免泄露内部代码
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: {
                "Content-Type": "application/json;charset=utf-8"
            }
        });
    }
}