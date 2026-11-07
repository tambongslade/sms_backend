// Remembers which photo files were deleted on this server, so the photo sync can delete them on the other
// server too, and never copies them back. One file name per line, appended (safe with several workers).

import fs from 'fs';
import path from 'path';

const LOG = path.join(process.cwd(), 'uploads', '.photo-deletions.log');

export function recordPhotoDeletion(filename: string): void {
    if (!filename || /[\r\n/\\]/.test(filename)) return;
    try {
        fs.appendFileSync(LOG, `${filename}\n`);
    } catch (err) {
        console.error('[PHOTO-SYNC] could not record a deleted photo:', err);
    }
}

export function deletedPhotoNames(): Set<string> {
    try {
        return new Set(fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean));
    } catch {
        return new Set();
    }
}
