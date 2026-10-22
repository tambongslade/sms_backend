import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
    listRollCallsForOversight,
    getRollCallDetail,
} from '../controllers/teacherRollCallController';

const router = Router();

router.use(authenticate);

// Read-only oversight of teacher-period roll calls, opened to the discipline
// chain plus school-wide leadership.
const OVERSIGHT_ROLES = [
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
    'SENIOR_DISCIPLINE_MASTER',
];

// GET /roll-calls/teacher-periods?date=&from=&to=&sub_class_id=&teacher_id=&subject_id=&only_with_absences=true
router.get('/teacher-periods', authorize(OVERSIGHT_ROLES), listRollCallsForOversight);

// GET /roll-calls/teacher-periods/:id
router.get('/teacher-periods/:id', authorize(OVERSIGHT_ROLES), getRollCallDetail);

export default router;
