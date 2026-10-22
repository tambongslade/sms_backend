import { Request, Response, NextFunction } from 'express';

/**
 * Convert camelCase string to snake_case
 * @param str String to convert
 * @returns snake_case string
 */
const camelToSnakeCase = (str: string): string => {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

/**
 * Convert snake_case string to camelCase
 * @param str String to convert
 * @returns camelCase string
 */
const snakeToCamelCase = (str: string): string => {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Recursively converts all keys in an object from camelCase to snake_case
 * @param obj Object to convert
 * @returns Object with snake_case keys
 */
const convertObjectKeys = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertObjectKeys(item));
    }

    return Object.keys(obj).reduce((acc: any, key: string) => {
        const snakeKey = camelToSnakeCase(key);
        acc[snakeKey] = convertObjectKeys(obj[key]);
        return acc;
    }, {});
};

/**
 * Recursively converts all keys in an object from snake_case to camelCase
 * and converts Date objects to ISO 8601 strings and BigInt to numbers.
 * @param obj Object to convert
 * @returns Object with camelCase keys and date strings
 */
const convertObjectKeysToClient = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
        // Handle BigInt values
        if (typeof obj === 'bigint') {
            return Number(obj); // Convert BigInt to number
        }
        return obj;
    }

    // Check if the object is a Date instance
    if (obj instanceof Date) {
        return obj.toISOString(); // Convert Date to ISO string
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertObjectKeysToClient(item));
    }

    return Object.keys(obj).reduce((acc: any, key: string) => {
        // Never ship password hashes to clients. Many services `include: { parent: true }`
        // (full User rows), so strip the field centrally (QA U12).
        if (key === 'password') return acc;
        let newKey = key;
        // Convert snake_case key to camelCase
        if (key.includes('_')) {
            newKey = snakeToCamelCase(key);
        }

        // Recursively convert the value
        acc[newKey] = convertObjectKeysToClient(obj[key]);
        return acc;
    }, {});
};

/**
 * Middleware that converts all camelCase keys in request body and query to snake_case
 * This ensures the API can accept camelCase parameters from clients while using snake_case internally
 */
export const convertCamelToSnakeCase = (req: Request, res: Response, next: NextFunction) => {
    // Convert request body if it exists
    if (req.body && Object.keys(req.body).length > 0) {
        const converted = convertObjectKeys(req.body);
        req.body = { ...req.body, ...converted };
    }

    // Initialize req.finalQuery as an empty object
    (req as any).finalQuery = {};

    // Convert query parameters if they exist
    if (req.query && Object.keys(req.query).length > 0) {
        // console.log("Inside camelcaseConverter (Original): ", req.query);

        // Create a custom property to store the snake_case version
        const convertedQuery: Record<string, any> = {};

        Object.keys(req.query).forEach(key => {
            const snakeKey = camelToSnakeCase(key);
            convertedQuery[snakeKey] = req.query[key];
            convertedQuery[key] = req.query[key]; // Keep original key too
        });

        // Assign the populated object to req.finalQuery
        (req as any).finalQuery = convertedQuery;

        // console.log("Snake case query: ", (req as any).finalQuery);
    }
    // else {
    //     // Log if req.query was empty or non-existent
    //     console.log("No query parameters found to convert.");
    // }

    next();
};


// export const convertCamelToSnakeCase = (req: Request, res: Response, next: NextFunction) => {
//     // Convert request body if it exists
//     if (req.body && Object.keys(req.body).length > 0) {
//         req.body = convertObjectKeys(req.body);
//     }

//     // Convert query parameters if they exist
//     if (req.query && Object.keys(req.query).length > 0) {
//         const query = req.query as any; // Cast to allow index access/modification
//         console.log("Inside camelcaseConverter (Original): ", query);

//         const keysToConvert: string[] = Object.keys(query); // Get all original keys

//         keysToConvert.forEach(key => {
//             const snakeKey = camelToSnakeCase(key);
//             if (snakeKey !== key) {
//                 // Assign the value to the new snake_case key
//                 query[snakeKey] = query[key];
//                 // Delete the original camelCase key
//                 delete query[key];
//             }
//         });

//         console.log("After camelcaseConverter (Mutated query): ", query); // Log the mutated object
//     }


//     next();
// };

/**
 * Middleware that converts all snake_case keys in response body to camelCase
 * and converts Date objects to ISO 8601 strings.
 * This ensures the API returns camelCase format expected by clients
 */
export const convertSnakeToCamelCase = (req: Request, res: Response, next: NextFunction) => {
    // Store the original res.json method
    const originalJson = res.json;

    // Override the res.json method
    res.json = function (body: any): Response {
        // Convert the response body
        const convertedBody = convertObjectKeysToClient(body);

        // Call the original json method with the converted body
        return originalJson.call(this, convertedBody) as unknown as Response;
    };

    next();
}; 