/**
 * @swagger
 * components:
 *   schemas:
 *     LoginRequest:
 *       type: object
 *       required:
 *         - password
 *       description: >
 *         Supply exactly one of `identifier`, `email`, `phone`, or `matricule`.
 *         `identifier` is a single-input convenience — the backend auto-detects
 *         email (contains `@`), phone (digits, optional `+`), or matricule.
 *         Phone login is available to staff only; parents must use matricule.
 *       properties:
 *         identifier:
 *           type: string
 *           description: Email, phone number, or matricule — auto-detected.
 *           example: nyingwilfredo@gmail.com
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address (staff and students).
 *           example: john.doe@example.com
 *         phone:
 *           type: string
 *           description: Staff phone number. Accepts `+237XXXXXXXXX` or `XXXXXXXXX`.
 *           example: "+237674816735"
 *         matricule:
 *           type: string
 *           description: Matricule (parents only).
 *           example: SO2026001
 *         password:
 *           type: string
 *           format: password
 *           description: User's password
 *           example: securePassword123
 * 
 *     LoginResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             token:
 *               type: string
 *               description: JWT authentication token
 *               example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *             expiresIn:
 *               type: string
 *               description: Token expiration time
 *               example: "120d"
 *             user:
 *               $ref: '#/components/schemas/User'
 * 
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - password
 *         - gender
 *         - dateOfBirth
 *         - phone
 *         - address
 *       properties:
 *         name:
 *           type: string
 *           description: User's full name
 *           example: John Doe
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *           example: john.doe@example.com
 *         password:
 *           type: string
 *           format: password
 *           description: User's password
 *           example: securePassword123
 *         gender:
 *           $ref: '#/components/schemas/Gender'
 *           description: User's gender
 *           example: Male
 *         dateOfBirth:
 *           type: string
 *           format: date
 *           description: User's date of birth
 *           example: 1990-01-01
 *         phone:
 *           type: string
 *           description: User's phone number
 *           example: +237 680123456
 *         address:
 *           type: string
 *           description: User's residential address
 *           example: 123 Main Street, Yaoundé
 *         idCardNum:
 *           type: string
 *           description: User's ID card number
 *           example: ID12345678
 *         photo:
 *           type: string
 *           description: URL to user's profile photo
 *           example: https://example.com/profiles/john.jpg
 * 
 *     RegisterResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: User registered successfully
 *         data:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *               example: 1
 *             name:
 *               type: string
 *               example: John Doe
 *             email:
 *               type: string
 *               example: john.doe@example.com
 *             gender:
 *               $ref: '#/components/schemas/Gender'
 *               example: Male
 *             dateOfBirth:
 *               type: string
 *               format: date
 *               example: 1990-01-01
 *             phone:
 *               type: string
 *               example: +237 680123456
 *             address:
 *               type: string
 *               example: 123 Main Street, Yaoundé
 *             idCardNum:
 *               type: string
 *               example: ID12345678
 *             photo:
 *               type: string
 *               example: https://example.com/profiles/john.jpg
 *             createdAt:
 *               type: string
 *               format: date-time
 *               example: 2023-01-01T12:00:00.000Z
 *             updatedAt:
 *               type: string
 *               format: date-time
 *               example: 2023-01-01T12:00:00.000Z
 * 
 *     LogoutResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Logged out successfully
 * 
 *     ProfileResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           $ref: '#/components/schemas/User'
 *
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: John Doe
 *         email:
 *           type: string
 *           format: email
 *           example: john.doe@example.com
 *         gender:
 *           $ref: '#/components/schemas/Gender'
 *           example: Male
 *         dateOfBirth:
 *           type: string
 *           format: date
 *           example: 1990-01-01
 *         phone:
 *           type: string
 *           example: +237 680123456
 *         address:
 *           type: string
 *           example: 123 Main Street, Yaoundé
 *         idCardNum:
 *           type: string
 *           example: ID12345678
 *         photo:
 *           type: string
 *           example: https://example.com/profiles/john.jpg
 *         userRoles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserRole'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: 2023-01-01T12:00:00.000Z
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: 2023-01-01T12:00:00.000Z
 *
 *     UserRole:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         role:
 *           $ref: '#/components/schemas/Role'
 *           example: PRINCIPAL
 *         description:
 *           type: string
 *           example: Administrator with full access
 * 
 *     AuthenticatedRequest:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/User'
 * 
 *     JwtPayload:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: User ID
 *           example: 1
 *         email:
 *           type: string
 *           format: email
 *           description: User's email
 *           example: john.doe@example.com
 *         role:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Role'
 *           example: ["PRINCIPAL", "TEACHER"]
 * 
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           description: Error message
 *           example: "Invalid credentials"
 */

// This file is for Swagger documentation only and doesn't export anything
export { }; 