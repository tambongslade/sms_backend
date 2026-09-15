import { getAiPrisma, isAiDbConfigured } from '../../../config/aiDb';
import { retrieve } from './aiAssistant/retriever';
import { renderSchema, matchUnrecordedTopic } from './aiAssistant/schemaCatalog';
import { guardSql, GUARD_MAX_ROWS } from './aiAssistant/sqlGuard';
import { generate, isAvailable, laneStatus, OLLAMA_MODEL } from './aiAssistant/ollamaClient';
import { matchFastIntent } from './aiAssistant/fastIntents';
import { matchSmallTalk } from './aiAssistant/smallTalk';

/**
 * Answers a natural-language question about school data.
 *
 * Two paths. Common questions match a hand-written intent and answer in
 * milliseconds. Anything else goes through retrieval to pick the relevant
 * tables, then the model to write a SELECT, then the guard, then a read-only
 * connection.
 *
 * The model never states a number. It only decides which rows to fetch; the
 * figures in the answer come from the database. Asked directly, the model
 * cheerfully replies that it cannot determine how many students there are —
 * which is correct, and exactly why it is kept away from the arithmetic.
 */

export type AnswerSource = 'small-talk' | 'fast-intent' | 'generated-sql';

/** One previous exchange, oldest first, as the client saw it. */
export interface ConversationTurn {
    question: string;
    answer: string;
}

export interface AskResult {
    question: string;
    answer: string;
    source: AnswerSource;
    rows: any[];
    rowCount: number;
    sql?: string;
    tables?: string[];
    tookMs: number;
    truncated: boolean;
    /**
     * The standalone question actually answered, when the asked one referred
     * back to an earlier turn. Surfaced so the UI can show what was understood:
     * a silent rewrite that guesses wrong is worse than no rewrite at all,
     * because the answer looks like a reply to the question on screen.
     */
    resolvedQuestion?: string;
}

export class AiAssistantError extends Error {
    constructor(message: string, readonly detail?: string) {
        super(message);
        this.name = 'AiAssistantError';
    }
}

const MAX_QUESTION_LENGTH = 500;

function buildPrompt(question: string, schema: string): string {
    // Worked examples rather than instructions alone. Told only to "output
    // ONLY the SQL", the 4B model still opened with "We are to find which
    // class has the most repeaters." — it answers the question as prose
    // because that is what a question looks like. Two examples in the exact
    // Question/SQL shape make the next token overwhelmingly likely to be
    // SELECT, which no amount of instruction achieved.
    //
    // The examples also carry the conventions that matter most — the join
    // through Enrollment and the current-year filter — where they are copied
    // rather than merely read.
    return `Translate the question into one PostgreSQL SELECT query.

${schema}

Rules:
- Output ONLY SQL. No prose, no markdown fences.
- SELECT only. Never INSERT, UPDATE, DELETE or DDL.
- Table names are case-sensitive and must be double-quoted, e.g. "Student".
- Enrolment is per academic year. Unless a year is named, filter on the current one.
- Counting students means COUNT(DISTINCT e.student_id) through "Enrollment".
- A student owes fees when amount_expected > amount_paid.
- Class names are upper case, e.g. 'FORM 1'.

Question: How many students are in FORM 2?
SQL: SELECT COUNT(DISTINCT e.student_id) AS count FROM "Enrollment" e JOIN "Class" c ON c.id = e.class_id WHERE e.academic_year_id = (SELECT id FROM "AcademicYear" WHERE is_current = true LIMIT 1) AND UPPER(c.name) LIKE UPPER('%FORM 2%')

Question: Which subclass has the most students?
SQL: SELECT sc.name AS subclass, COUNT(DISTINCT e.student_id) AS count FROM "Enrollment" e JOIN "SubClass" sc ON sc.id = e.sub_class_id WHERE e.academic_year_id = (SELECT id FROM "AcademicYear" WHERE is_current = true LIMIT 1) GROUP BY sc.name ORDER BY count DESC LIMIT 10

Question: ${question}
SQL:`;
}

/**
 * The coder model writes its own SELECT and sometimes wraps the statement in a
 * markdown fence despite being told not to. Both are stripped here rather than
 * rejected — a fenced but otherwise correct query is a formatting quirk, not a
 * wrong answer, and refusing it would fail questions the model got right.
 */
function cleanSql(raw: string): string {
    let sql = raw.trim()
        .replace(/^```(?:sql)?\s*/i, '')
        .replace(/```[\s\S]*$/, '')
        .trim();
    // Guard against a doubled keyword if the prompt is ever changed back to
    // prefilling one.
    sql = sql.replace(/^SELECT\s+SELECT\b/i, 'SELECT');
    return sql.trim();
}

/** Prisma returns BigInt for ::bigint and Decimal for numerics; neither is JSON-serialisable. */
function serialise(rows: any[]): any[] {
    return rows.map(row => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
            if (typeof v === 'bigint') out[k] = Number(v);
            else if (v && typeof v === 'object' && 'toNumber' in (v as any)) out[k] = (v as any).toNumber();
            else if (v instanceof Date) out[k] = v.toISOString();
            else out[k] = v;
        }
        return out;
    });
}

/** Turns an arbitrary result set into one readable line. */
function describeRows(rows: any[]): string {
    if (rows.length === 0) return 'No matching records were found.';

    if (rows.length === 1) {
        const entries = Object.entries(rows[0]);
        if (entries.length === 1) {
            const [key, value] = entries[0];
            const n = typeof value === 'number' ? value.toLocaleString() : String(value);
            return `${key.replace(/_/g, ' ')}: ${n}`;
        }
        return entries
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toLocaleString() : v}`)
            .join(', ');
    }

    return `${rows.length} row${rows.length === 1 ? '' : 's'} returned.`;
}

/**
 * Words that only mean something relative to what was said before.
 *
 * Used to decide whether a rewrite is worth a model call at all. "How many
 * students are in FORM 1" needs no history and must not pay for one — the
 * assistant is already slow enough that a second round trip on every question
 * would be felt. Only questions that cannot stand alone get rewritten.
 */
const REFERS_BACK = /\b(?:that|those|these|this|it|its|he|him|his|she|her|hers|they|them|their|theirs|the same|then|there|above|previous|last one|which student|which one|what about|and (?:the )?(?:student|parent|teacher|class))\b/i;

/** A question of three words or fewer is almost always a fragment continuing the last one. */
function looksLikeFollowUp(question: string): boolean {
    if (REFERS_BACK.test(question)) return true;
    return question.replace(/[?.!]/g, '').trim().split(/\s+/).length <= 3;
}

/**
 * Turns a follow-up into a question that stands on its own.
 *
 * Rewriting rather than feeding the history into SQL generation is deliberate.
 * The pipeline matches hand-written intents by regex before the model is
 * reached, and those patterns are anchored to whole questions — a fragment like
 * "which student was that" matches none of them and never could. Rewriting puts
 * a complete question back at the top of the pipeline, so the fast intents keep
 * working and the model gets a question it can answer without also having to
 * track a conversation.
 *
 * On any failure the original question is returned untouched. A bad rewrite
 * silently answers a question nobody asked, so the fallback is always to let
 * the original through and let it fail honestly.
 */
async function resolveAgainstHistory(question: string, history: ConversationTurn[]): Promise<string> {
    const recent = history.slice(-3);
    const transcript = recent
        .map(t => `Q: ${t.question}\nA: ${t.answer}`)
        .join('\n\n');

    const prompt = `Rewrite the follow-up question so it can be understood on its own, using the conversation for anything it refers to.

Rules:
- Reply with the rewritten question only. No explanation, no quotes.
- Replace every word that points back ("that", "him", "the same one") with what it refers to.
- Keep the person's wording and intent. Do not answer it, do not broaden it, and do not add conditions they did not ask for.
- If it already stands on its own, repeat it back unchanged.

Conversation:
${transcript}

Follow-up: ${question}

Rewritten:`;

    try {
        const out = (await generate(prompt, { numPredict: 60, temperature: 0, stop: ['\n\n'] }))
            .trim()
            .replace(/^["'`]|["'`]$/g, '')
            .split('\n')[0]
            .trim();

        // A rewrite that comes back empty, or long enough to have started
        // explaining itself, is not a question — take the original.
        if (!out || out.length > MAX_QUESTION_LENGTH) return question;
        return out;
    } catch {
        return question;
    }
}

export async function ask(rawQuestion: string, history: ConversationTurn[] = []): Promise<AskResult> {
    const started = Date.now();
    const asked = (rawQuestion ?? '').trim();

    if (!asked) throw new AiAssistantError('Please ask a question.');
    if (asked.length > MAX_QUESTION_LENGTH) {
        throw new AiAssistantError(`Questions are limited to ${MAX_QUESTION_LENGTH} characters.`);
    }

    // Small talk is checked against what was actually typed, before any
    // rewriting: "hello" is three words and would otherwise be treated as a
    // fragment and sent to the model to be expanded.
    let question = asked;
    let resolvedQuestion: string | undefined;

    if (history.length > 0 && !matchSmallTalk(asked) && looksLikeFollowUp(asked)) {
        const rewritten = await resolveAgainstHistory(asked, history);
        if (rewritten.toLowerCase() !== asked.toLowerCase()) {
            question = rewritten;
            resolvedQuestion = rewritten;
        }
    }
    // Greetings and "what can you do" first, before anything touches the
    // database or the model. These are the first thing anyone types, and
    // sending them down the SQL path produced a three-second wait ending in
    // "Only SELECT queries are allowed."
    const chat = matchSmallTalk(question);
    if (chat) {
        return {
            question,
            answer: chat.answer,
            source: 'small-talk',
            rows: [],
            rowCount: 0,
            tookMs: Date.now() - started,
            resolvedQuestion,
            truncated: false,
        };
    }

    if (!isAiDbConfigured()) {
        throw new AiAssistantError(
            'The assistant is not configured.',
            'AI_DATABASE_URL is unset, so there is no read-only connection to query with.'
        );
    }

    const prisma = getAiPrisma()!;

    // --- Fast path -----------------------------------------------------------
    const fast = matchFastIntent(question);
    if (fast) {
        const params = fast.intent.params ? fast.intent.params(fast.match) : [];
        const rows = serialise(
            await prisma.$queryRawUnsafe<any[]>(fast.intent.sql, ...params)
        );
        return {
            question,
            answer: rows.length > 0
                ? fast.intent.describe(rows[0], fast.match)
                : 'No matching records were found.',
            source: 'fast-intent',
            rows,
            rowCount: rows.length,
            tookMs: Date.now() - started,
            resolvedQuestion,
            truncated: false,
        };
    }

    // --- Areas the school does not record yet --------------------------------
    // After the fast intents, so a hand-written query always wins, and before
    // the model, so no time is spent generating SQL for a table that is empty.
    //
    // The distinction being drawn is between "nobody scored anything" and
    // "nothing has been entered". Both come back from the database as zero
    // rows, and only the second one is true — a query about marks would return
    // an empty set that reads as a fact about the students.
    const unrecorded = matchUnrecordedTopic(question);
    if (unrecorded) {
        return {
            question: asked,
            answer: `The school does not record ${unrecorded} in this system yet, so there is nothing for me to report. If that has changed, the data is not reaching this server.`,
            source: 'small-talk',
            rows: [],
            rowCount: 0,
            tookMs: Date.now() - started,
            resolvedQuestion,
            truncated: false,
        };
    }

    // --- Generated path ------------------------------------------------------
    if (!(await isAvailable())) {
        throw new AiAssistantError(
            'The language model is not reachable.',
            `Ollama did not respond, or the model ${OLLAMA_MODEL} is not installed.`
        );
    }

    const hits = retrieve(question);
    const schema = renderSchema(hits.map(h => h.entry));

    let sqlDraft: string;
    try {
        const raw = await generate(buildPrompt(question, schema), {
            numPredict: 200,
            temperature: 0,
            // Stop at the start of a further example, or at prose that follows a
            // finished statement.
            stop: ['\n\n', 'Question:', 'Explanation:', ';'],
        });
        sqlDraft = cleanSql(raw);
    } catch (err: any) {
        throw new AiAssistantError('The language model failed to respond.', err?.message);
    }

    const guard = guardSql(sqlDraft);
    if (!guard.ok) {
        // Distinguish "the model did not write a query" from "the query was
        // unsafe". The first means the question was not about data, and the
        // user needs to hear that, not a rule about SELECT statements. The
        // second is a genuine refusal worth reporting as one.
        const notAQuery =
            guard.reason === 'Only SELECT queries are allowed.' ||
            guard.reason === 'The model did not produce a query — no table was referenced.' ||
            guard.reason === 'The model returned no SQL.';

        if (notAQuery) {
            throw new AiAssistantError(
                "I can only answer questions about the school's data.",
                'Try asking about enrolment, classes, fees, payments, staff, attendance or marks — ' +
                'for example "how many students are in FORM 1?" or "how much have we collected?".'
            );
        }

        throw new AiAssistantError(
            'That question produced a query the assistant will not run.',
            guard.reason
        );
    }

    let sql = guard.sql!;
    let rows: any[];
    try {
        rows = serialise(await prisma.$queryRawUnsafe<any[]>(sql));
    } catch (firstError: any) {
        // Almost every failure here is an invented column or an enum value that
        // does not exist — "sa.student_id does not exist", "invalid input value
        // for enum PaymentMethod: MOBILE_MONEY". PostgreSQL says precisely what
        // is wrong, and a model that reads the complaint usually fixes it. One
        // retry only: a second failure means the question needs a human, and
        // each attempt costs ten to twenty seconds.
        const dbMessage = String(firstError?.message ?? firstError)
            .split('\n').map(l => l.trim()).filter(Boolean).pop() ?? '';

        try {
            // Built fresh rather than appended to the original. Appending left
            // the model looking at two "SQL:" markers and a half-finished
            // statement, and it responded with prose that the guard then
            // rejected — replacing a fixable column error with a worse one.
            const retryPrompt = `Fix this PostgreSQL query.

${schema}

The query below failed. Correct it using only the columns listed above.

Failed query:
${sql}

PostgreSQL error: ${dbMessage}

Output ONLY the corrected SQL, starting with SELECT. Quote table names, e.g. "Enrollment".

Corrected SQL:`;

            const retried = cleanSql(await generate(retryPrompt, {
                numPredict: 200,
                temperature: 0,
                stop: ['\n\n', 'Question:', 'Explanation:', ';'],
            }));

            const retryGuard = guardSql(retried);
            if (!retryGuard.ok) {
                throw new AiAssistantError(
                    'That question produced a query the assistant will not run.',
                    retryGuard.reason
                );
            }

            rows = serialise(await prisma.$queryRawUnsafe<any[]>(retryGuard.sql!));
            sql = retryGuard.sql!;
        } catch (secondError: any) {
            if (secondError instanceof AiAssistantError) throw secondError;
            throw new AiAssistantError(
                'The generated query could not be run against the database.',
                `${dbMessage}\n\nSQL: ${sql}`
            );
        }
    }

    return {
        question,
        answer: describeRows(rows),
        source: 'generated-sql',
        rows,
        rowCount: rows.length,
        sql,
        tables: hits.map(h => h.entry.table),
        tookMs: Date.now() - started,
        resolvedQuestion,
        truncated: rows.length >= GUARD_MAX_ROWS,
    };
}

export async function status() {
    // Per lane rather than one boolean. Two lanes means the assistant can be
    // half up — the GPU copy down and the CPU one still answering, slower — and
    // a single flag reports that as healthy, hiding the reason for the slowdown.
    const lanes = await laneStatus();
    return {
        configured: isAiDbConfigured(),
        modelAvailable: lanes.some(l => l.up),
        model: OLLAMA_MODEL,
        lanes,
        maxRows: GUARD_MAX_ROWS,
    };
}
