// Camera menu (Super Manager only). See cameraController for how streams are authorised.
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as camera from '../controllers/cameraController';

const router = Router();

// Called by nginx (auth_request), not by the browser: it carries a stream ticket, not a login token.
router.get('/authorize', camera.authorizeStream);

router.get('/', authenticate, camera.listCameras);
router.get('/stream-ticket', authenticate, camera.getStreamTicket);

export default router;
