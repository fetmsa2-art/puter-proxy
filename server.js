import express from 'express';
import { puter } from '@heyputer/puter.js';

const app = express();
app.use(express.json());

app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model, stream } = req.body;
        
        // Use the model provided by the client, fallback to a default
        const puterModel = model || 'claude-sonnet-4-6';

        // Extract the latest prompt text
        const prompt = messages[messages.length - 1].content;

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const response = await puter.ai.chat(prompt, { model: puterModel, stream: true });
            
            for await (const part of response) {
                if (part?.text) {
                    const chunk = {
                        choices: [{ delta: { content: part.text } }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            const response = await puter.ai.chat(prompt, { model: puterModel });
            const reply = response.message.content[0].text;
            
            res.json({
                choices: [{ message: { role: 'assistant', content: reply } }]
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send(error.message);
    }
});

app.listen(3000, () => console.log('Puter Proxy running on http://localhost:3000'));
