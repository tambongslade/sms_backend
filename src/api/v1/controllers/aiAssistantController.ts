import { Request, Response } from 'express';
import * as aiAssistantService from '../services/aiAssistantService';
import { AiAssistantError } from '../services/aiAssistantService';

/** Enough to resolve a reference; more only slows the rewrite down. */
const MAX_HISTORY_TURNS = 3;
const MAX_HISTORY_FIELD = 2000;

/**
 * The conversation as the client saw it, not as the server remembers it —
 * there is no server-side session, so history arrives with the request.
 *
 * It is therefore untrusted input: anything here was sent by the caller and
 * reaches the model, so it is length-capped and trimmed to the last few turns.
 * Nothing from it is ever executed; it only informs the rewrite, whose output
 * goes through the same guard as any other question.
 */
function readHistory(raw: unknown): aiAssistantService.ConversationTurn[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(t => t && typeof t.question === 'string' && typeof t.answer === 'string')
        .slice(-MAX_HISTORY_TURNS)
        .map(t => ({
            question: String(t.question).slice(0, MAX_HISTORY_FIELD),
            answer: String(t.answer).slice(0, MAX_HISTORY_FIELD),
        }));
}

/**
 * POST /api/v1/ai/ask   { question: string, history?: { question, answer }[] }
 *
 * `history` is optional and oldest-first. Without it every question is answered
 * in isolation, which is how "which student was that" used to fail: the
 * assistant had no idea what "that" was.
 *
 * Errors carry a `detail` alongside the message: the refusal reason from the
 * guard, or the database's complaint about a hallucinated column. Without it a
 * failed question is indistinguishable from a broken feature.
 */
export async function ask(req: Request, res: Response) {
    try {
        const { question, history } = req.body ?? {};
        if (typeof question !== 'string') {
            return res.status(400).json({ success: false, error: 'A "question" string is required.' });
        }

        const result = await aiAssistantService.ask(question, readHistory(history));
        return res.json({ success: true, data: result });

    } catch (error: any) {
        if (error instanceof AiAssistantError) {
            // 422: the request was well-formed, the question just could not be
            // turned into something safe to run.
            return res.status(422).json({
                success: false,
                error: error.message,
                detail: error.detail,
            });
        }
        console.error('AI assistant error:', error);
        return res.status(500).json({ success: false, error: 'The assistant failed to answer.' });
    }
}

/** GET /api/v1/ai/status — lets the UI disable itself rather than fail per question. */
export async function status(_req: Request, res: Response) {
    try {
        return res.json({ success: true, data: await aiAssistantService.status() });
    } catch (error: any) {
        console.error('AI status error:', error);
        return res.status(500).json({ success: false, error: 'Could not read assistant status.' });
    }
}
