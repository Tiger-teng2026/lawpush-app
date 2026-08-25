/**
 * 刑律·CrimPulse - Cloudflare Worker 代理
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
    <title>刑律 API 代理</title>
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
        <h1>刑律 API 代理已运行</h1>
        <p>这是后端接口，不是前端页面。请打开前端使用：</p>
        <p><a href="https://crimpulse-app.vercel.app">https://crimpulse-app.vercel.app</a></p>
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
                    service: 'crimpulse-api-proxy',
                    endpoint: 'POST /api/generate',
                    frontend: 'https://crimpulse-app.vercel.app',
                });
            }
            return statusPage();
        }

        if (request.method !== 'POST' || !isGeneratePath(url.pathname)) {
            return jsonResponse({
                error: 'Not Found',
                hint: '请使用 POST /api/generate，或打开前端 https://crimpulse-app.vercel.app',
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
        const prompt = body.prompt || `你是一位正在拍短视频的执业律师，正对着镜头跟观众聊天。请根据关键词「${keyword}」，写一篇60到90秒、可以直接念出来的口播文案。开头用「最近办的一个案子」引入，禁止说「上个月有个客户」。像面对面聊天，短句口语。结尾另起一行写：本视频仅作法律知识分享，不构成个案法律建议。只输出正文，不要标题、分镜、markdown、emoji、【】或编号。`;

        const deepseekBody = {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: '你是一位拍短视频的执业律师，文案必须像面对面聊天。开头用「最近办的一个案子」，结尾必须有「本视频仅作法律知识分享，不构成个案法律建议」。只输出可直接口播的纯文本，不要多余符号。',
                },
                { role: 'user', content: prompt },
            ],
            stream: true,
            temperature: 0.8,
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
