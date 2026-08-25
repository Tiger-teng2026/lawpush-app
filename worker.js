/**
 * 律推·LawPush - Cloudflare Worker 代理
 * 功能：接收前端请求，转发至 DeepSeek API，隐藏 API Key，支持流式响应。
 */

export default {
    async fetch(request, env) {
        // 处理 CORS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        // 只接受 POST 请求到 /api/generate
        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/api/generate') {
            return new Response('Not Found', { status: 404 });
        }

        // 检查环境变量中是否配置了 DEEPSEEK_API_KEY
        const apiKey = env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API Key 未配置，请在 Worker 环境变量中设置 DEEPSEEK_API_KEY' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // 解析前端请求体
        let body;
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: '请求体格式错误' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        const keyword = body.keyword || '';
        const prompt = body.prompt || `你是一位资深法律新媒体编辑，请根据关键词「${keyword}」，生成一篇60-90秒的短视频口播文案。要求：开头3秒吸引注意力，中间讲1-2个核心法律知识点，结尾引导咨询。风格通俗易懂，避免法言法语堆砌。同时检测文案中是否包含违规词。`;

        // 构造 DeepSeek API 请求
        const deepseekBody = {
            model: 'deepseek-chat',  // 或 'deepseek-reasoner' 根据情况
            messages: [
                { role: 'system', content: '你是一位资深法律新媒体编辑，擅长创作通俗易懂的法律科普短视频文案。' },
                { role: 'user', content: prompt }
            ],
            stream: true,
            temperature: 0.7,
        };

        try {
            // 转发请求到 DeepSeek
            const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(deepseekBody),
            });

            // 如果 DeepSeek 返回错误，将错误信息返回给前端
            if (!deepseekResponse.ok) {
                const errorText = await deepseekResponse.text();
                return new Response(JSON.stringify({ error: `DeepSeek API 错误: ${deepseekResponse.status} ${errorText}` }), {
                    status: deepseekResponse.status,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                });
            }

            // 返回流式响应，将 DeepSeek 的流原样转发
            return new Response(deepseekResponse.body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: '请求 DeepSeek 失败: ' + error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }
    },
};