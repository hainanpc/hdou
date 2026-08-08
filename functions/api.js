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


let HOST = HOSTS[0];

const PLATFORM_KEY =
	"7961beb44246e3012ce228d6b5ced05a";

const VERSION = "2.0.0";

const DEVICE_TYPE = "web";


const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";



// ================= 工具 =================


function sid(x) {
	return String(x || "")
		.replace(/^rp_/, "");
}



function toHex(buf) {

	return [...new Uint8Array(buf)]
		.map(
			b => b.toString(16).padStart(2, "0")
		)
		.join("");

}



function hexBytes(hex) {

	let a = new Uint8Array(hex.length / 2);

	for (
		let i = 0; i < a.length; i++
	) {

		a[i] = parseInt(
			hex.substr(i * 2, 2),
			16
		);

	}

	return a;

}



// ================= HMAC =================


async function makeKey(rid) {

	const key =
		await crypto.subtle.importKey(
			"raw",
			new TextEncoder()
			.encode(PLATFORM_KEY), {
				name: "HMAC",
				hash: "SHA-256"
			},
			false,
			["sign"]
		);


	return new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			hexBytes(
				rid.replace(/-/g, "")
			)
		)
	);

}



// ================= AES =================


async function aesEncrypt(
	data,
	key,
	iv
) {

	return new Uint8Array(
		await crypto.subtle.encrypt({
				name: "AES-CBC",
				iv: iv
			},
			await crypto.subtle.importKey(
				"raw",
				key, {
					name: "AES-CBC"
				},
				false,
				["encrypt"]
			),
			data
		)
	);

}



async function aesDecrypt(
	data,
	key,
	iv
) {

	return new Uint8Array(
		await crypto.subtle.decrypt({
				name: "AES-CBC",
				iv: iv
			},
			await crypto.subtle.importKey(
				"raw",
				key, {
					name: "AES-CBC"
				},
				false,
				["decrypt"]
			),
			data
		)
	);

}



// ================= gzip =================


async function gzipCompress(data) {

	let cs =
		new CompressionStream("gzip");

	let w =
		cs.writable.getWriter();

	w.write(data);

	w.close();


	return new Uint8Array(
		await new Response(
			cs.readable
		)
		.arrayBuffer()
	);

}



async function gzipDecompress(data) {

	let ds =
		new DecompressionStream("gzip");


	let w =
		ds.writable.getWriter();


	w.write(data);

	w.close();


	return new Uint8Array(
		await new Response(
			ds.readable
		)
		.arrayBuffer()
	);

}



// ================= API请求 =================


async function callApi(
	path,
	data = {}
) {

	path = "/" + path.replace(/^\/+/, "");


	let rid =
		crypto.randomUUID();


	let key =
		await makeKey(rid);


	let iv =
		crypto.getRandomValues(
			new Uint8Array(16)
		);



	let raw =
		JSON.stringify({

			token: "",

			deviceId: rid.replace(/-/g, ""),

			data: data

		});



	let compressed =
		await gzipCompress(
			new TextEncoder()
			.encode(raw)
		);



	let encrypted =
		await aesEncrypt(
			compressed,
			key,
			iv
		);


	let body =
		new Uint8Array(
			16 + encrypted.length
		);


	body.set(iv, 0);

	body.set(encrypted, 16);



	let ts =
		Math.floor(
			Date.now() / 1000
		);


	let signText =
		`Dart|${rid.replace(/-/g,"")}|${rid}|${ts}|${path}`;



	let hash =
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder()
			.encode(signText)
		);


	let sign =
		toHex(hash) +
		"-" +
		ts;



	let res =
		await fetch(
			HOST + "/api" + path, {

				method: "POST",

				headers: {

					"User-Agent": UA,

					"Content-Type": "application/octet-stream",

					"Origin": HOST,

					"Referer": HOST + "/home",

					version: VERSION,

					deviceType: DEVICE_TYPE,

					time: String(ts),

					sign: sign,

					requestId: rid,

					sessionId: rid

				},

				body: body

			});


	let buf =
		new Uint8Array(
			await res.arrayBuffer()
		);


	if (
		buf.length < 32
	) {

		try {

			return JSON.parse(
				new TextDecoder()
				.decode(buf)
			);

		} catch (e) {

			return {};

		}

	}



	let plain =
		await aesDecrypt(
			buf.slice(16),
			key,
			buf.slice(0, 16)
		);



	if (
		plain[0] == 0x1f &&
		plain[1] == 0x8b
	) {

		plain =
			await gzipDecompress(
				plain
			);

	}



	return JSON.parse(
		new TextDecoder()
		.decode(plain)
	);

}

// ================= 数据解析 =================


function listData(data){

 if(Array.isArray(data))
 return data;


 if(!data || typeof data!="object")
 return [];


 if(Array.isArray(data.list))
 return data.list;


 if(Array.isArray(data.items))
 return data.items;


 if(Array.isArray(data.data))
 return data.data;


 if(data.data && typeof data.data=="object")
 return listData(data.data);


 return [];

}



// ================= vod =================


function vod(item){

item=item||{};


let vid=
sid(
item.id ||
item.drama_id ||
""
);


if(!vid)
return null;


return {

vod_id:vid,

vod_name:
item.name||
item.title||
vid,


vod_pic:
item.img||
item.cover||
item.cover_url||
"",


vod_remarks:
item.update_label||
item.remark||
"",


vod_content:
item.name||"",


vod_play_from:"黄豆短剧",

vod_play_url:
`第1集$${vid}|1`


};

}



// ================= 分类 =================


async function getClasses() {


	let classes = [

		{
			type_id: "all",
			type_name: "全部"
		}

	];



	let data =
		await callApi(
			"/drama/navList", {}
		);



	for (
		let x of listData(data)
	) {


		let id =
			String(
				x.code ||
				x.id ||
				x.cat_id ||
				""
			);


		let name =
			x.name ||
			x.title ||
			x.cat_name ||
			"";



		if (id && name) {

			classes.push({

				type_id: id,

				type_name: name

			});


		}


	}



	return classes;

}



// ================= filters =================


async function getFilters(classes) {


	let filters = {};



	for (
		let c of classes
	) {


		filters[c.type_id] = [


			{

				key: "order",

				name: "排序",

				value: [

					{
						n: "默认",
						v: ""
					},

					{
						n: "最新",
						v: "new"
					},

					{
						n: "最热",
						v: "hot"
					}

				]

			},


			{

				key: "update_status",

				name: "状态",

				value: [

					{
						n: "全部",
						v: ""
					},

					{
						n: "连载",
						v: "0"
					},

					{
						n: "完结",
						v: "1"
					}

				]

			}


		];


	}



	return filters;

}



// ================= 子分类 =================


const navCache = {};



async function getNavFilter(code) {


	if (!code || code == "all")
		return [];



	if (navCache[code])
		return navCache[code];



	let data =
		await callApi(
			"/drama/navFilter", {
				code: String(code)
			}
		);



	let result =
		listData(data);



	navCache[code] = result;



	return result;

}



// ================= 首页 =================


async function homeContent() {


	let data =
		await callApi(
			"/drama/list", {

				page: "1",

				page_size: "18"

			}
		);



	let classes =
		await getClasses();



	return {


		class: classes,


		filters: await getFilters(classes),


		list: listData(data)
			.map(vod),


		parse: 0,

		jx: 0


	};


}



// ================= 分类 =================


async function categoryContent(
	tid,
	pg,
	extend = {}
) {


	let page =
		String(pg || "1");


	let items = [];



	let req = {

		page: page,

		page_size: "18"

	};



	let typeId =
		String(tid || "all");



	if (
		typeId != "all"
	) {



		let tabs =
			await getNavFilter(typeId);



		/*
		兼容OK影视传来的sub
		*/


		let sub =
			Number(
				extend.sub || 0
			);



		if (
			tabs[sub]
		) {


			let t =
				tabs[sub];



			let f =
				t.filter ||
				t;



			if (f.cat_id)

				req.cat_id =
				String(
					f.cat_id
				);


			if (f.tag_id)

				req.tag_id =
				String(
					f.tag_id
				);


		}



	}



	if (
		extend.order
	) {

		req.order =
			extend.order;

	}



	if (
		extend.update_status
	) {

		req.update_status =
			extend.update_status;

	}



let data =
await callApi(
"/drama/list",
req
);


// 调试
console.log(
"category raw:",
JSON.stringify(data)
);


items =
listData(data);


// 过滤空数据
items =
items.filter(
x =>
(x.id ||
 x.drama_id ||
 x.name ||
 x.title)
);



	return {

page:Number(page),

pagecount:...,

limit:18,

total:99999,

list:
items
.map(vod)
.filter(Boolean),

class_name:"黄豆短剧",

parse:0,

jx:0

};


}


// ================= 详情 =================


async function detailContent(ids) {


	let vid =
		sid(
			ids[0]
		);



	let data =
		await callApi(
			"/drama/detail", {
				id: vid
			}
		);



	let d =
		data.data ||
		data;



	if (!d || typeof d != "object")
		return {
			list: []
		};



	let episodes =
		Array.isArray(d.episodes) ?
		d.episodes : [];



	let play = [];



	if (episodes.length) {


		for (
			let i = 0; i < episodes.length; i++
		) {


			let ep =
				episodes[i];


			let name =
				ep.name ||
				ep.title ||
				`第${i+1}集`;



			let seq =
				ep.seq ||
				ep.episode ||
				i + 1;



			play.push(

				`${name}$${vid}|${seq}`

			);


		}


	} else {


		let count =
			Number(
				d.episode_count ||
				d.total_episode ||
				1
			);



		for (
			let i = 1; i <= count; i++
		) {

			play.push(
				`第${i}集$${vid}|${i}`
			);

		}


	}



	return {


		list: [

			{


				vod_id: vid,


				vod_name: d.name ||
					d.title ||
					"",


				vod_pic: d.img_y ||
					d.img ||
					d.cover ||
					"",


				vod_remarks: d.update_label ||
					"",


				vod_content: d.description ||
					d.desc ||
					"",


				vod_play_from: "黄豆短剧",


				vod_play_url: play.join("#")


			}

		],


		parse: 0,

		jx: 0


	};

}



// ================= 搜索 =================


async function searchContent(
	key,
	pg
) {


	let page =
		String(pg || "1");



	let data =
		await callApi(
			"/drama/list", {

				page: page,

				page_size: "18",

				keyword: String(key || "")

			}
		);



	let arr =
		listData(data);



	return {


		page: Number(page),


		pagecount: arr.length >= 18 ?
			Number(page) + 1 : Number(page),


		limit: 18,


		total: 99999,


		list: arr.map(vod),


		parse: 0,

		jx: 0


	};


}



// ================= 播放 =================


// OK影视播放入口
// 自动转CF代理

async function playerContent(
	id
) {


	let arr =
		String(id)
		.split("|");



	let vid =
		sid(arr[0]);


	let seq =
		arr[1] ||
		"1";



	let playUrl = "";



	try {


		let data =
			await callApi(
				"/drama/play", {

					id: vid,

					seq: String(seq)

				}
			);



		let d =
			data.data || {};



		playUrl =
			d.m3u8 ||
			d.url ||
			"";



	} catch (e) {}




	if (!playUrl) {


		playUrl =
			`${HOST}/api/drama/hls/${vid}/${seq}/play.m3u8`;

	}





	// CF代理地址

	let proxyUrl =
		`/proxy?url=${encodeURIComponent(playUrl)}`;



	return {


		parse: 0,


		jx: 0,


		url: proxyUrl,


		playUrl: "",


		header: {


			"User-Agent": UA,


			Referer: HOST + "/home",


			Origin: HOST


		}


	};


}




// ================= CF入口 =================


export async function onRequest(
	context
) {


	const request =
		context.request;


	const url =
		new URL(
			request.url
		);



	let ac =
		url.searchParams.get("ac") ||
		"";



	let tid =
		url.searchParams.get("tid") ||
		url.searchParams.get("t") ||
		"";



	let pg =
url.searchParams.get("pg")
||
url.searchParams.get("page")
||
"1";



	let wd =
		url.searchParams.get("wd") ||
		"";



	let ids =
		url.searchParams.get("ids") ||
		"";



	let result = {};



	try {


		switch (ac) {


			case "home":


				result =
					await homeContent();


				break;



			case "category":

result =
await categoryContent(
tid,
url.searchParams.get("pg")
||
url.searchParams.get("page")
||
"1",
{

sub:url.searchParams.get("sub"),

order:url.searchParams.get("order"),

update_status:url.searchParams.get("update_status")

}
);

break;



			case "detail":


				result =
					await detailContent(
						ids.split(",")
					);


				break;



			case "search":


				result =
					await searchContent(
						wd,
						pg
					);


				break;



			case "play":


				result =
					await playerContent(
						url.searchParams.get("id") ||
						url.searchParams.get("play")
					);


				break;



			default:


				if (wd) {


					result =
						await searchContent(
							wd,
							pg
						);


				} else if (ids) {


					result =
						await detailContent(
							ids.split(",")
						);


				} else if (tid) {


					result =
						await categoryContent(
							tid,
							pg, {}
						);


				} else {


					result =
						await homeContent();


				}


		}



		return new Response(

			JSON.stringify(result),

			{


				headers: {


					"Content-Type": "application/json;charset=utf-8",


					"Access-Control-Allow-Origin": "*"


				}


			}

		);


	} catch (e) {


		return new Response(

			JSON.stringify({

				error: e.message,

				stack: e.stack

			}),

			{


				status: 500,


				headers: {


					"Content-Type": "application/json;charset=utf-8"


				}


			}

		);


	}


}