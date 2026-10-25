const fs = require('fs');
const path = require('path');

// Function to create directory if it doesn't exist
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

// Function to copy a directory recursively
function copyDir(src, dest) {
    // Create destination directory
    ensureDir(dest);

    // Read source directory
    const entries = fs.readdirSync(src, { withFileTypes: true });

    // Copy each entry
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            // Recursively copy subdirectories
            copyDir(srcPath, destPath);
        } else {
            // Copy files
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied file: ${srcPath} -> ${destPath}`);
        }
    }
}

// Main execution
try {
    // Define paths
    const srcViewDir = path.join(__dirname, '..', 'src', 'view');
    const destViewDir = path.join(__dirname, '..', 'dist', 'view');
    const srcReportsDir = path.join(__dirname, '..', 'src', 'reports');
    const destReportsDir = path.join(__dirname, '..', 'dist', 'reports');

    // File Management (the embedded file app): plain JS and static pages that tsc does not emit
    const srcFmDir = path.join(__dirname, '..', 'src', 'filemanagement');
    if (fs.existsSync(srcFmDir)) {
        console.log('Copying filemanagement directory...');
        copyDir(srcFmDir, path.join(__dirname, '..', 'dist', 'filemanagement'));
    }

    // Copy view directory
    if (fs.existsSync(srcViewDir)) {
        console.log('Copying view directory...');
        copyDir(srcViewDir, destViewDir);
    } else {
        console.log(`Source view directory not found: ${srcViewDir}`);
        ensureDir(destViewDir);
    }

    // Copy reports directory
    if (fs.existsSync(srcReportsDir)) {
        console.log('Copying reports directory...');
        copyDir(srcReportsDir, destReportsDir);
    } else {
        console.log(`Source reports directory not found: ${srcReportsDir}`);
        ensureDir(destReportsDir);
    }

    console.log('Asset copying completed successfully.');
} catch (error) {
    console.error('Error copying assets:', error);
    process.exit(1);
} 