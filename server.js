import express from 'express';
import { init } from '@heyputer/puter.js/src/init.cjs';
import crypto from 'crypto';

// Initialize Puter using an Auth Token (Required for running on external servers like Render)
const puter = init(process.env.PUTER_AUTH_TOKEN);

const app = express();
app.use(express.json());

app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model, stream, temperature, top_p, max_tokens } = req.body;
        
        // Use the model provided by the client, fallback to a default
        const puterModel = model || 'claude-sonnet-4-6';

        // Roo Coder sometimes sends 'content' as an array (e.g. when there are images). 
        // Puter expects standard strings for content. Let's sanitize the messages 
        // so we can pass the ENTIRE conversation history to Claude!
        const sanitizedMessages = messages.map(msg => {
            let textContent = msg.content;
            if (Array.isArray(textContent)) {
                textContent = textContent.filter(c => c.type === 'text').map(c => c.text).join('\n');
            }
            return { role: msg.role, content: textContent };
        });

        // Prepare Puter options, forwarding advanced parameters if they exist
        const puterOptions = {
            model: puterModel,
            stream: stream || false
        };
        if (temperature !== undefined) puterOptions.temperature = temperature;
        if (top_p !== undefined) puterOptions.top_p = top_p;
        if (max_tokens !== undefined) puterOptions.max_tokens = max_tokens;

        const responseId = 'chatcmpl-' + crypto.randomUUID();
        const createdTimestamp = Math.floor(Date.now() / 1000);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const response = await puter.ai.chat(sanitizedMessages, puterOptions);
            
            // OpenAI clients expect the first chunk to declare the role
            const roleChunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: createdTimestamp,
                model: puterModel,
                choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
            };
            res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

            for await (const part of response) {
                if (part?.text) {
                    const chunk = {
                        id: responseId,
                        object: 'chat.completion.chunk',
                        created: createdTimestamp,
                        model: puterModel,
                        choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
            }
            
            // Final chunk indicating the stream is finished
            const finalChunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: createdTimestamp,
                model: puterModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            const response = await puter.ai.chat(sanitizedMessages, puterOptions);
            
            // Non-streaming response text is directly on response.message.content
            const reply = response.message.content;
            
            res.json({
                id: responseId,
                object: 'chat.completion',
                created: createdTimestamp,
                model: puterModel,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: reply },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            });
        }
    } catch (error) {
        console.error(error);
        // OpenAI IDEs expect errors wrapped in this specific JSON format
        res.status(500).json({
            error: {
                message: error.message || 'An error occurred during completion',
                type: 'server_error',
                param: null,
                code: null
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Puter Proxy running on port ${PORT}`));
