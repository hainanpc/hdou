// functions/proxy.js

// 黄豆短剧 CF Pages代理

// OK影视播放器兼容版

const SOURCE_HOST =

	"https://eyeonneb.cc";

const UA =

	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

// 判断m3u8

function isM3u8(

	target,

	contentType,

	buffer

) {

	let path =

		target

		.split("?")[0]

		.toLowerCase();

	if (path.endsWith(".m3u8"))

		return true;

	if (

		contentType.includes("mpegurl") ||

		contentType.includes(

			"application/vnd.apple.mpegurl"

		)

	)

		return true;

	if (

		buffer.length > 7

	) {

		let head =

			String.fromCharCode(

				buffer[0],

				buffer[1],

				buffer[2],

				buffer[3],

				buffer[4],

				buffer[5],

				buffer[6]

			);

		if (head == "#EXTM3U")

			return true;

	}

	return false;

}

// m3u8重写

function rewriteM3u8(

	text,

	origin,

	base

) {

	let lines = [];

	for (

		let line of text.split(/\r?\n/)

	) {

		let s = line.trim();

		if (!s) {

			lines.push(line);

			continue;

		}

		// EXT-X-KEY URI

		if (

			s.startsWith("#")

		) {

			let n =

				line.replace(

					/URI="([^"]+)"/gi,

					function(

						all,

						uri

					) {

						try {

							let abs =

								new URL(

									uri,

									base

								)

								.href;

							return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;

						} catch (e) {

							return all;

						}

					});

			lines.push(n);

			continue;

		}

		// ts分片

		try {

			let abs =

				new URL(

					s,

					base

				)

				.href;

			lines.push(

				`${origin}/proxy?url=${encodeURIComponent(abs)}`

			);

		} catch (e) {

			lines.push(line);

		}

	}

	return lines.join("\n") + "\n";

}

// ============================

// CF入口

// ============================

export async function onRequest(

	context

) {

	const request =

		context.request;

	const url =

		new URL(

			request.url

		);

	const target =

		url.searchParams.get(

			"url"

		);

	if (!target) {

		return new Response(

			"missing url",

			{

				status: 400

			}

		);

	}

	try {

		let headers = {

			"User-Agent": UA,

			"Accept": "*/*",

			"Origin":

				SOURCE_HOST,

			"Referer":

				SOURCE_HOST + "/home"

		};

		// Range支持

		let range =

			request.headers.get(

				"Range"

			);

		if (range) {

			headers.Range = range;

		}

		let res =

			await fetch(

				target,

				{

					headers,

					redirect: "follow"

				}

			);

		let contentType =

			(

				res.headers.get(

					"content-type"

				)

				||

				""

			)

			.toLowerCase();

		let buffer =

			new Uint8Array(

				await res.arrayBuffer()

			);

		let origin =

			url.origin;

		// =====================

		// m3u8

		// =====================

		if (

			isM3u8(

				target,

				contentType,

				buffer

			)

		) {

			let text =

				new TextDecoder()

				.decode(buffer);

			let output =

				rewriteM3u8(

					text,

					origin,

					target

				);

			return new Response(

				output,

				{

					status: 200,

					headers: {

						"Content-Type":

							"application/vnd.apple.mpegurl",

						"Access-Control-Allow-Origin":

							"*",

						"Cache-Control":

							"no-cache"

					}

				}

			);

		}

		// =====================

		// ts/key/图片

		// =====================

		let respHeaders = {

			"Content-Type":

				res.headers.get(

					"content-type"

				)

				||

				"application/octet-stream",

			"Access-Control-Allow-Origin":

				"*",

			"Accept-Ranges":

				"bytes",

			"Content-Disposition":

				"inline",

			"Cache-Control":

				"public,max-age=3600"

		};

		let cr =

			res.headers.get(

				"content-range"

			);

		if (cr) {

			respHeaders[

				"Content-Range"

			] = cr;

		}

		let cl =

			res.headers.get(

				"content-length"

			);

		if (cl) {

			respHeaders[

				"Content-Length"

			] = cl;

		}

		return new Response(

			buffer,

			{

				status:

					res.status,

				headers:

					respHeaders

			}

		);

	} catch (e) {

		return new Response(

			"proxy error: "

			+

			e.message,

			{

				status: 500

			}

		);

	}

}