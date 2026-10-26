// Super Manager Overview Controller — thin wrappers around
// superManagerOverviewService. Every endpoint accepts an optional
// `academicYearId` query param (defaults to current year in the service).

import { Request, Response } from 'express';
import * as overviewService from '../services/superManagerOverviewService';

function parseYearId(req: Request): number | undefined {
    const raw = req.query.academicYearId;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = parseInt(raw as string, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function handle<T>(res: Response, promise: Promise<T>, label: string) {
    return promise
        .then(data => res.json({ success: true, data }))
        .catch(err => {
            console.error(`Error fetching ${label}:`, err);
            res.status(500).json({ success: false, error: `Failed to fetch ${label}` });
        });
}

export const getDisciplineOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getDisciplineOverview(parseYearId(req)), 'discipline overview');

export const getAttendanceOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getAttendanceOverview(parseYearId(req)), 'attendance overview');

export const getAcademicOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getAcademicOverview(parseYearId(req)), 'academic overview');

export const getFinancialOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getFinancialOverview(parseYearId(req)), 'financial overview');

export const getStaffOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getStaffOverview(parseYearId(req)), 'staff overview');

export const getCommunicationOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getCommunicationOverview(parseYearId(req)), 'communication overview');

export const getHealthOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getHealthOverview(parseYearId(req)), 'health overview');

export const getReamStockOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getReamStockOverview(parseYearId(req)), 'ream stock overview');

export const getSalaryOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getSalaryOverview(parseYearId(req)), 'salary overview');

export const getTasksOverview = (_req: Request, res: Response) =>
    handle(res, overviewService.getTasksOverview(), 'tasks overview');

export const getInventoryOverview = (_req: Request, res: Response) =>
    handle(res, overviewService.getInventoryOverview(), 'inventory overview');

export const getAuditOverview = (_req: Request, res: Response) =>
    handle(res, overviewService.getAuditOverview(), 'audit overview');

export const getEnrollmentOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getEnrollmentOverview(parseYearId(req)), 'enrollment overview');

export const getGceRegistrationOverview = (req: Request, res: Response) =>
    handle(res, overviewService.getGceRegistrationOverview(parseYearId(req)), 'GCE registration overview');

export const getSnapshot = (req: Request, res: Response) =>
    handle(res, overviewService.getSuperManagerSnapshot(parseYearId(req)), 'super manager snapshot');
