import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { recordPhotoDeletion } from './photoDeletions';

// Define the upload directory structure
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const STUDENT_PHOTOS_DIR = path.join(UPLOAD_DIR, 'students');
const USER_PHOTOS_DIR = path.join(UPLOAD_DIR, 'users');
const DEFAULT_PHOTOS_DIR = path.join(UPLOAD_DIR, 'defaults');
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts');

// Ensure all upload directories exist
const ensureDirectoryExists = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Initialize directories
ensureDirectoryExists(UPLOAD_DIR);
ensureDirectoryExists(STUDENT_PHOTOS_DIR);
ensureDirectoryExists(USER_PHOTOS_DIR);
ensureDirectoryExists(DEFAULT_PHOTOS_DIR);
ensureDirectoryExists(RECEIPTS_DIR);

// Create default student photo if it doesn't exist
const createDefaultStudentPhoto = () => {
    const defaultPhotoPath = path.join(DEFAULT_PHOTOS_DIR, 'default-student.jpg');
    if (!fs.existsSync(defaultPhotoPath)) {
        // Copy from public folder if exists, or create a placeholder
        const publicDefaultPath = path.join(process.cwd(), 'public', 'student.jpg');
        if (fs.existsSync(publicDefaultPath)) {
            fs.copyFileSync(publicDefaultPath, defaultPhotoPath);
        }
    }
};

createDefaultStudentPhoto();

// Photo type enum
export enum PhotoType {
    STUDENT = 'student',
    USER = 'user'
}

// Configure dynamic storage based on photo type
const storage = (multer as any).diskStorage({
    destination: (req: any, file: any, cb: any) => {
        const photoType = req.photoType || req.body.photoType || req.query.photoType || PhotoType.USER;

        let destinationDir = USER_PHOTOS_DIR;
        if (photoType === PhotoType.STUDENT) {
            destinationDir = STUDENT_PHOTOS_DIR;
        }

        ensureDirectoryExists(destinationDir);
        cb(null, destinationDir);
    },
    filename: (req: any, file: any, cb: any) => {
        const photoType = req.photoType || req.body.photoType || req.query.photoType || PhotoType.USER;
        const entityId = req.body.entityId || req.params.id || req.params.studentId || req.params.userId;

        // Create a unique filename based on entity type and ID
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        const filename = `${photoType}-${entityId}-${timestamp}${ext}`;

        cb(null, filename);
    }
});

// File filter to only allow image files
const fileFilter = (req: any, file: any, cb: any) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'));
    }
};

// Create the multer instance with configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max file size
    },
    fileFilter: fileFilter
});

// Function to get the public URL for a file
export const getFileUrl = (req: any, filename: string, photoType?: PhotoType): string => {
    const protocol = req.protocol;
    const host = req.get('host');

    // Student pictures that an older upload saved in the users folder keep their user- name.
    if (photoType === PhotoType.STUDENT && !filename.startsWith('user-')) {
        return `${protocol}://${host}/uploads/students/${filename}`;
    }
    if (photoType === PhotoType.USER) {
        return `${protocol}://${host}/uploads/users/${filename}`;
    }

    // Fallback - try to determine from filename
    if (filename.startsWith('student-')) {
        return `${protocol}://${host}/uploads/students/${filename}`;
    }
    if (filename.startsWith('user-')) {
        return `${protocol}://${host}/uploads/users/${filename}`;
    }

    return `${protocol}://${host}/uploads/${filename}`;
};

// Function to get local file path for Puppeteer
export const getLocalFilePath = (filename: string, photoType?: PhotoType): string => {
    if (!filename) {
        return path.join(DEFAULT_PHOTOS_DIR, 'default-student.jpg');
    }

    if (photoType === PhotoType.STUDENT || filename.startsWith('student-')) {
        const filePath = path.join(STUDENT_PHOTOS_DIR, filename);
        if (fs.existsSync(filePath)) return filePath;
        const userPath = path.join(USER_PHOTOS_DIR, filename); // older uploads saved a student picture as user-*
        return fs.existsSync(userPath) ? userPath : path.join(DEFAULT_PHOTOS_DIR, 'default-student.jpg');
    }

    if (photoType === PhotoType.USER || filename.startsWith('user-')) {
        const filePath = path.join(USER_PHOTOS_DIR, filename);
        return fs.existsSync(filePath) ? filePath : path.join(DEFAULT_PHOTOS_DIR, 'default-student.jpg');
    }

    // Check both directories for legacy files
    const studentPath = path.join(STUDENT_PHOTOS_DIR, filename);
    const userPath = path.join(USER_PHOTOS_DIR, filename);
    const legacyPath = path.join(UPLOAD_DIR, filename);

    if (fs.existsSync(studentPath)) return studentPath;
    if (fs.existsSync(userPath)) return userPath;
    if (fs.existsSync(legacyPath)) return legacyPath;

    return path.join(DEFAULT_PHOTOS_DIR, 'default-student.jpg');
};

// Function to delete a photo file
export const deletePhotoFile = (filename: string): boolean => {
    if (!filename) return false;

    const possiblePaths = [
        path.join(STUDENT_PHOTOS_DIR, filename),
        path.join(USER_PHOTOS_DIR, filename),
        path.join(UPLOAD_DIR, filename) // Legacy location
    ];

    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                // So the photo sync removes it from the other server as well.
                recordPhotoDeletion(filename);
                return true;
            } catch (error) {
                console.error(`Error deleting file ${filePath}:`, error);
            }
        }
    }

    return false;
};

// Function to validate photo filename
export const isValidPhotoFilename = (filename: string): boolean => {
    if (!filename) return false;

    // Check if file exists in any of the photo directories
    const possiblePaths = [
        path.join(STUDENT_PHOTOS_DIR, filename),
        path.join(USER_PHOTOS_DIR, filename),
        path.join(UPLOAD_DIR, filename)
    ];

    return possiblePaths.some(filePath => fs.existsSync(filePath));
};

// Export paths for use in other modules
export const PHOTO_DIRECTORIES = {
    UPLOAD_DIR,
    STUDENT_PHOTOS_DIR,
    USER_PHOTOS_DIR,
    DEFAULT_PHOTOS_DIR,
    RECEIPTS_DIR
};

// --------- Receipt uploads (PDF + image) for expenditures & similar ---------
const receiptStorage = (multer as any).diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
        ensureDirectoryExists(RECEIPTS_DIR);
        cb(null, RECEIPTS_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        cb(null, `receipt-${timestamp}-${safe}${ext}`);
    },
});

const receiptFileFilter = (_req: any, file: any, cb: any) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed for receipts'));
};

export const receiptUpload = multer({
    storage: receiptStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: receiptFileFilter,
});

export const getReceiptUrl = (req: any, filename: string): string => {
    if (!filename) return '';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}/uploads/receipts/${filename}`;
};

export const deleteReceiptFile = (filename: string): boolean => {
    if (!filename) return false;
    const filePath = path.join(RECEIPTS_DIR, filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
};

// --------- Chat attachments (images + voice + docs) ---------
const CHAT_DIR = path.join(UPLOAD_DIR, 'chat');
ensureDirectoryExists(CHAT_DIR);

const CHAT_ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const CHAT_ALLOWED_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
]);

const chatStorage = (multer as any).diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
        ensureDirectoryExists(CHAT_DIR);
        cb(null, CHAT_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname) || '';
        const safe = path
            .basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 40);
        cb(null, `chat-${timestamp}-${safe}${ext}`);
    },
});

const chatFileFilter = (_req: any, file: any, cb: any) => {
    if (CHAT_ALLOWED_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p))) {
        return cb(null, true);
    }
    if (CHAT_ALLOWED_MIMES.has(file.mimetype)) {
        return cb(null, true);
    }
    return cb(new Error(`Unsupported mime-type for chat: ${file.mimetype}`));
};

export const chatUpload = multer({
    storage: chatStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — enough for voice notes and photos
    fileFilter: chatFileFilter,
});

export const getChatFileUrl = (req: any, filename: string): string => {
    if (!filename) return '';
    return `${req.protocol}://${req.get('host')}/uploads/chat/${filename}`;
};

/**
 * Classify a mime-type into a `ChatAttachmentKind` value so the client can
 * render inline previews without having to sniff mime types itself.
 */
export function classifyChatMimeType(mime: string | null | undefined): 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' {
    if (!mime) return 'FILE';
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('video/')) return 'VIDEO';
    return 'FILE';
}

export default upload; 