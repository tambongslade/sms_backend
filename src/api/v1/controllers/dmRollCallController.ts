// src/api/v1/controllers/dmRollCallController.ts
import { Request, Response } from 'express';
import * as dmRollCallService from '../services/dmRollCallService';
import { DMRollCallStatus, RollCallSlot } from '@prisma/client';

const VALID_SLOTS = new Set(Object.values(RollCallSlot));
const VALID_STATUSES = new Set(Object.values(DMRollCallStatus));

function parseSubClassId(req: Request): number | null {
    const raw =
        (req.body && (req.body.sub_class_id ?? req.body.subClassId)) ??
        (req.finalQuery && (req.finalQuery.sub_class_id ?? req.finalQuery.subClassId));
    if (raw === undefined || raw === null || raw === '') return null;
    const n = parseInt(raw as string, 10);
    return Number.isNaN(n) ? null : n;
}

function parseDate(input: any): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
}

// GET /discipline/dm-roll-call/my-subclasses
// Returns the sub-classes the caller may record DM roll calls for. DMs see
// only their assigned sub-classes; admin/senior roles (VP, Principal, DoD,
// SDM, MANAGER, SUPER_MANAGER) see every sub-class.
export const listMySubClasses = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const roles: string[] = (req.user.role as any) || [];
        const academicYearId = (req.finalQuery as any)?.academic_year_id
            ? parseInt((req.finalQuery as any).academic_year_id)
            : undefined;
        const subClasses = await dmRollCallService.listAccessibleSubClasses(
            req.user.id,
            roles,
            academicYearId
        );
        return res.json({ success: true, data: subClasses });
    } catch (error: any) {
        console.error('Error fetching DM accessible sub-classes:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

// GET /discipline/dm-roll-call/status?subClassId&date
export const getStatus = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = parseSubClassId(req);
        if (!subClassId) return res.status(400).json({ success: false, error: 'sub_class_id is required' });
        const date = parseDate((req.finalQuery as any).date);
        if (!date) return res.status(400).json({ success: false, error: 'Valid date is required' });
        const academicYearId = (req.finalQuery as any).academic_year_id
            ? parseInt((req.finalQuery as any).academic_year_id)
            : undefined;
        const data = await dmRollCallService.getDMRollCallStatus(subClassId, date, academicYearId);
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching DM roll call status:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

// GET /discipline/dm-roll-call?subClassId&date[&slot]
// When slot is omitted the current wall-clock slot is used, so a DM opening the
// page mid-afternoon immediately sees the SLOT_5 or SLOT_8 roster he needs to
// record — no dropdown to hunt through.
export const getRollCall = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = parseSubClassId(req);
        if (!subClassId) return res.status(400).json({ success: false, error: 'sub_class_id is required' });
        const date = parseDate((req.finalQuery as any).date);
        if (!date) return res.status(400).json({ success: false, error: 'Valid date is required' });
        const rawSlot = String((req.finalQuery as any).slot || '').toUpperCase();
        let slot: RollCallSlot;
        if (!rawSlot) {
            slot = dmRollCallService.pickCurrentSlot();
        } else if (!VALID_SLOTS.has(rawSlot as RollCallSlot)) {
            return res.status(400).json({ success: false, error: `Invalid slot. Must be one of: ${Array.from(VALID_SLOTS).join(', ')}` });
        } else {
            slot = rawSlot as RollCallSlot;
        }
        const academicYearId = (req.finalQuery as any).academic_year_id
            ? parseInt((req.finalQuery as any).academic_year_id)
            : undefined;
        const data = await dmRollCallService.getDMRollCall(subClassId, date, slot, academicYearId);
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching DM roll call:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

// POST /discipline/dm-roll-call
// slot is optional in the body — if omitted, the backend picks it from the
// current wall-clock time in the school's timezone. Clients that still want
// to record for a specific slot (principal edits, corrections, tests) can
// keep sending it explicitly.
export const recordRollCall = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const subClassId = parseSubClassId(req);
        if (!subClassId) return res.status(400).json({ success: false, error: 'sub_class_id is required' });
        const date = parseDate(req.body.date);
        if (!date) return res.status(400).json({ success: false, error: 'Valid date is required' });
        const rawSlot = String(req.body.slot || '').toUpperCase();
        let slot: RollCallSlot;
        if (!rawSlot) {
            slot = dmRollCallService.pickCurrentSlot();
        } else if (!VALID_SLOTS.has(rawSlot as RollCallSlot)) {
            return res.status(400).json({ success: false, error: `Invalid slot. Must be one of: ${Array.from(VALID_SLOTS).join(', ')}` });
        } else {
            slot = rawSlot as RollCallSlot;
        }
        const rawEntries: any[] = Array.isArray(req.body.entries) ? req.body.entries : [];
        if (rawEntries.length === 0) {
            return res.status(400).json({ success: false, error: 'entries must be a non-empty array' });
        }

        const entries: Array<{ enrollment_id: number; status: DMRollCallStatus }> = [];
        for (const raw of rawEntries) {
            const enrollmentId = parseInt(raw.enrollment_id ?? raw.enrollmentId);
            if (Number.isNaN(enrollmentId)) {
                return res.status(400).json({ success: false, error: 'Each entry requires a valid enrollment_id' });
            }
            const st = String(raw.status || '').toUpperCase();
            if (!VALID_STATUSES.has(st as DMRollCallStatus)) {
                return res.status(400).json({ success: false, error: `Invalid status "${raw.status}". Must be PRESENT / LATE / ABSENT` });
            }
            entries.push({ enrollment_id: enrollmentId, status: st as DMRollCallStatus });
        }

        const academicYearId = req.body.academic_year_id ? parseInt(req.body.academic_year_id) : undefined;

        const data = await dmRollCallService.recordDMRollCall({
            sub_class_id: subClassId,
            date,
            slot,
            entries,
            assigned_by_id: req.user.id,
            academic_year_id: academicYearId,
        });
        // Echo back the resolved slot so clients that omitted it can display
        // which one just got recorded.
        return res.status(200).json({ success: true, data: { ...data, slot } });
    } catch (error: any) {
        console.error('Error recording DM roll call:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};
