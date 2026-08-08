 // functions/config.json.js
export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const config = {
    sites: [
      {
        key: "huangdou",
        name: "黄豆短剧",
        type: 4,
        api: origin+'/api',
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
        changeable: 0
      }
    ]
  };
  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}