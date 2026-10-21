import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger/swagger';
import path from 'path';
import { convertCamelToSnakeCase, convertSnakeToCamelCase } from './api/v1/middleware/caseConversion.middleware';
import syncRoutes from './sync/sync-routes';
import apiV1Routes from './api/v1/routes/index';
import fileManagementRoutes from './api/v1/routes/fileManagementRoutes';

// Load environment variables from .env file
dotenv.config();

const app = express();

// Security middleware - but allow Swagger UI to work correctly
app.use(
    helmet({
        contentSecurityPolicy: false, // This helps with Swagger UI rendering
    })
);

// Enable CORS for all routes - flexible configuration for development and production
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://sms.sniperbuisnesscenter.com',
        // Add more origins as needed for production
    ],
    credentials: true, // Allow credentials (cookies, authorization headers)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
}));


// File Management (the LAN file app, proxied for signed-in staff). Mounted BEFORE the body parsers and the case
// conversion on purpose: it streams uploads and downloads through untouched.
app.use('/api/v1/file-management', fileManagementRoutes);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
app.use(morgan('dev'));

// --- FIX for Static File CORS ---
// The 'cors' middleware package doesn't always apply to express.static.
// This custom middleware ensures CORS headers are set for all static file requests.

const setStaticCorsHeaders = (req: Request, res: Response, next: NextFunction) => {
    // This allows any origin. For better security in production, you might restrict this
    // to your specific frontend domains, e.g., 'https://sms.sniperbuisnesscenter.com'
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    // This header is also important for allowing cross-origin image embedding
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
};

// Serve static files from the 'uploads' directory, applying the CORS headers.
// These two routes handle all subdirectories (students, users, defaults) and both URL structures.
app.use('/uploads', setStaticCorsHeaders, express.static(path.join(process.cwd(), 'uploads')));
app.use('/api/v1/uploads', setStaticCorsHeaders, express.static(path.join(process.cwd(), 'uploads')));


// Log the number of routes and schemas in Swagger
if (swaggerSpec && swaggerSpec.paths) {
    console.log(`Swagger loaded with ${Object.keys(swaggerSpec.paths).length} endpoints`);
    if (swaggerSpec.components && swaggerSpec.components.schemas) {
        console.log(`Swagger loaded with ${Object.keys(swaggerSpec.components.schemas).length} schemas`);
    }
}

// Setup Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true, // Enable the search functionality
    swaggerOptions: {
        persistAuthorization: true, // Persist authorization data
    },
}));

// Get Swagger JSON
app.get('/api-docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

// Sync is server-to-server and carries raw Prisma rows, so it must NOT go
// through case conversion — it is mounted ahead of that middleware deliberately.
// Previously it sat below, so GET /api/sync/changes/:table returned camelCase
// ("serverId", "updatedAt") and every model.create() on the receiving side
// rejected the payload. Pull had never worked; push did, because incoming
// snake_case passes through convertCamelToSnakeCase untouched.
app.use('/api', syncRoutes);

// Apply case conversion middlewares GLOBALLY before API routes
app.use(convertCamelToSnakeCase); // Converts incoming camelCase query/body to snake_case
app.use(convertSnakeToCamelCase); // Converts outgoing snake_case responses to camelCase

// Routes
app.use('/api/v1', apiV1Routes);

// Health-check or root endpoint
app.get('/', (req: Request, res: Response) => {
    res.send('School Management System API is up and running!');
});

// Health check endpoint for monitoring - multiple paths to ensure compatibility
app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Service is running', version: process.env.npm_package_version || '1.0.0' });
});

// Additional health check at the path shown in the screenshot
app.get('/api/v1/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Service is running', version: process.env.npm_package_version || '1.0.0' });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server_id: process.env.SERVER_ID,
    server_type: process.env.SERVER_TYPE
  });
});

// Error handling middleware
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

// Endpoint to download the 1-1-1 report PDF from the root directory
app.get('/download/report/1-1-1', (req: Request, res: Response) => {
    const filePath = path.join(process.cwd(), '1-1-1report.pdf');
    // Use res.download to send the file as an attachment
    (res as any).download(filePath, '1-1-1report.pdf', (err: any) => {
        if (err) {
            // Handle errors, e.g., file not found
            console.error("Error sending file:", err);
            if (!res.headersSent) {
                // Check if headers were already sent (e.g., by internal Express error handling)
                // Type assertion needed as Express types might not fully cover this scenario
                const nodeError = err as NodeJS.ErrnoException;
                if (nodeError.code === 'ENOENT') {
                    res.status(404).send({ success: false, error: 'Report file not found.' });
                } else {
                    res.status(500).send({ success: false, error: 'Could not download the file.' });
                }
            }
        }
    });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});


export default app;