// src/api/v1/routes/taskRoutes.ts

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as taskController from '../controllers/taskController';

const router = express.Router();
router.use(authenticate);

// A senior can create/assign; the assignee (any authenticated user) can view/update their own.
const CREATOR_ROLES = [
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'DEAN_OF_STUDIES',
    'HOD',
    'BURSAR',
    'SENIOR_DISCIPLINE_MASTER',
    'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
];

router.get('/me/counters', taskController.getMyTaskCounters);
router.get('/', taskController.listTasks);
router.get('/:id', taskController.getTask);
router.post('/', authorize(CREATOR_ROLES), taskController.createTask);
router.patch('/:id', taskController.updateTask); // service enforces per-role permissions
router.delete('/:id', taskController.deleteTask);

export default router;
