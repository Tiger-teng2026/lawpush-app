/**
 * 律推·LawPush - Cloudflare Worker 代理
 * 功能：接收前端请求，转发至 DeepSeek API，隐藏 API Key，支持流式响应。
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS,
        },
    });
}

function statusPage() {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>律推 API 代理</title>
    <style>
        body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background:#0A1628; color:#F0F4FA; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
        .card { background:rgba(255,255,255,0.04); border:1px solid rgba(201,169,78,0.35); border-radius:16px; padding:32px; max-width:520px; width:90%; }
        h1 { color:#E0C878; font-size:22px; margin:0 0 12px; }
        p { color:rgba(240,244,250,0.75); line-height:1.7; margin:8px 0; }
        code { background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:6px; }
        a { color:#C9A94E; }
    </style>
</head>
<body>
    <div class="card">
        <h1>律推 API 代理已运行</h1>
        <p>这是后端接口，不是前端页面。请打开前端使用：</p>
        <p><a href="https://lawpush-app.vercel.app">https://lawpush-app.vercel.app</a></p>
        <p>生成接口：<code>POST /api/generate</code></p>
    </div>
</body>
</html>`;
    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...CORS_HEADERS,
        },
    });
}

function isGeneratePath(pathname) {
    return pathname === '/api/generate' || pathname === '/api/generate/';
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            if (url.pathname === '/health') {
                return jsonResponse({
                    ok: true,
                    service: 'lawpush-api-proxy',
                    endpoint: 'POST /api/generate',
                    frontend: 'https://lawpush-app.vercel.app',
                });
            }
            return statusPage();
        }

        if (request.method !== 'POST' || !isGeneratePath(url.pathname)) {
            return jsonResponse({
                error: 'Not Found',
                hint: '请使用 POST /api/generate，或打开前端 https://lawpush-app.vercel.app',
            }, 404);
        }

        const apiKey = env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return jsonResponse({ error: 'API Key 未配置，请在 Worker 环境变量中设置 DEEPSEEK_API_KEY' }, 500);
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
            return jsonResponse({ error: '请求体格式错误' }, 400);
        }

        const keyword = body.keyword || '';
        const prompt = body.prompt || `你是一位资深法律新媒体编辑，请根据关键词「${keyword}」，生成一篇60-90秒的短视频口播文案。要求：开头3秒吸引注意力，中间讲1-2个核心法律知识点，结尾引导咨询。风格通俗易懂，避免法言法语堆砌。同时检测文案中是否包含违规词。`;

        const deepseekBody = {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: '你是一位资深法律新媒体编辑，擅长创作通俗易懂的法律科普短视频文案。' },
                { role: 'user', content: prompt },
            ],
            stream: true,
            temperature: 0.7,
        };

        try {
            const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(deepseekBody),
            });

            if (!deepseekResponse.ok) {
                const errorText = await deepseekResponse.text();
                return jsonResponse({ error: `DeepSeek API 错误: ${deepseekResponse.status} ${errorText}` }, deepseekResponse.status);
            }

            return new Response(deepseekResponse.body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...CORS_HEADERS,
                },
            });
        } catch (error) {
            return jsonResponse({ error: '请求 DeepSeek 失败: ' + error.message }, 500);
        }
    },
};
