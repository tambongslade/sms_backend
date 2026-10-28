import express, { Request, Response, NextFunction } from 'express';
import * as studentAverageController from '../controllers/studentAverageController';
import { authorize } from '../middleware/auth.middleware';
import { Role } from '@prisma/client';
import prisma from '../../../config/db';

const router = express.Router();

// Parents may only read averages of a sequence that has been closed.
const parentsOnlyAfterClose = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const roles: string[] = [].concat((req as any).user?.role ?? []);
        if (!roles.includes('PARENT') || roles.some(r => r !== 'PARENT')) return next();
        const seq = await prisma.examSequence.findUnique({ where: { id: parseInt(req.params.examSequenceId) }, select: { status: true } });
        if (!seq || seq.status === 'OPEN') {
            res.status(403).json({ success: false, error: 'Results for this sequence are not released yet. They are available once the sequence is closed.' });
            return;
        }
        next();
    } catch (err) { next(err); }
};

router.post(
    '/calculate/:examSequenceId',
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.TEACHER]),
    studentAverageController.calculateStudentAverages
);

router.get(
    '/sequence/:examSequenceId',
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.TEACHER, Role.PARENT]),
    parentsOnlyAfterClose,
    studentAverageController.getSequenceAverages
);

router.get(
    '/:enrollmentId/:examSequenceId',
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.TEACHER, Role.PARENT]),
    parentsOnlyAfterClose,
    studentAverageController.getStudentAverage
);

router.put(
    '/:id/decision',
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    studentAverageController.updateDecision,
);

export default router;