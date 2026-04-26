import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { refineUserPrompt } from './src/pipeline/promptRefiner';

const app = express();
const port = 3001;

// Allow requests from the Next.js frontend
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());

// Expose the downloaded scraped/generated assets folder so the UI can render absolute paths!
app.use('/assets', express.static(path.join(__dirname, 'scrape_assets')));

// Set up Multer for handling multipart/form-data (media uploads)
const upload = multer({ dest: path.join(__dirname, 'temp_uploads') });

// Endpoint to check if a prompt is complete or needs refinement (e.g. asking for missing modality)
app.post('/api/refine', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const refinementResult = await refineUserPrompt(prompt);
        res.status(200).json(refinementResult);

    } catch (error) {
        console.error('Error in /api/refine:', error);
        res.status(500).json({ error: 'Failed to refine prompt' });
    }
});

app.post('/api/run-pipeline', upload.single('mediaFile'), (req, res) => {
    try {
        const { prompt, count, modality, mediaUrl, mediaType } = req.body;

        const fileAsset = req.file;
        let finalMediaUrl = mediaUrl;

        if (fileAsset) {
            finalMediaUrl = path.resolve(fileAsset.path);
        }

        console.log('\n=== Received Pipeline Request ===');
        console.log('Prompt:', prompt);
        console.log('Modality Option:', modality);

        const env = {
            ...process.env,
            AutoGenie_PROMPT: prompt || '',
            AutoGenie_COUNT: count || '1',
            AutoGenie_MODALITY: modality || 'image',
            AutoGenie_MEDIA_URL: finalMediaUrl || '',
            AutoGenie_MEDIA_TYPE: mediaType || ''
        };

        // Configure Server-Sent Events headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'src/index.ts'], {
            cwd: path.resolve(__dirname),
            env: env,
            shell: true
        });

        child.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`[Pipeline]: ${line}`);
                res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
            });
        });

        child.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                console.error(`[Pipeline Error]: ${line}`);
                res.write(`data: ${JSON.stringify({ type: 'error', message: line })}\n\n`);
            });
        });

        child.on('close', (code) => {
            console.log(`Pipeline exited with code ${code}`);

            // Attempt to read the resulting semantic_map.json
            const semanticMapPath = path.join(__dirname, 'data', 'semantic_map.json');
            let semanticMap = null;

            if (fs.existsSync(semanticMapPath)) {
                try {
                    const rawData = fs.readFileSync(semanticMapPath, 'utf8');
                    semanticMap = JSON.parse(rawData);
                } catch (err) {
                    console.error('Error reading semantic_map.json:', err);
                }
            }

            // Cleanup temp uploaded file if it exists
            if (fileAsset && fs.existsSync(fileAsset.path)) {
                fs.unlinkSync(fileAsset.path);
            }

            res.write(`data: ${JSON.stringify({ type: 'done', success: code === 0, data: semanticMap })}\n\n`);
            res.end();
        });

    } catch (error) {
        console.error('Error in /api/run-pipeline:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Server Error' })}\n\n`);
        res.end();
    }
});

app.listen(port, () => {
    console.log(`AutoGenie API Server listening at http://localhost:${port}`);
});
