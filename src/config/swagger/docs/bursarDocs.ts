/**
 * @swagger
 * tags:
 *   name: Bursar
 *   description: Bursar financial management and student registration with parent creation endpoints
 */

/**
 * @swagger
 * /bursar/create-parent-with-student:
 *   post:
 *     summary: Create student with automatic parent account creation
 *     description: |
 *       Creates a new student record with automatic parent account creation. This is the main
 *       Bursar function for registering new students. The parent account is created with a
 *       temporary password that should be provided to the parent for login access.
 *       Only BURSAR and SUPER_MANAGER can create students with parent accounts.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StudentWithParentRequest'
 *           example:
 *             studentName: "John Doe"
 *             dateOfBirth: "2008-05-15"
 *             placeOfBirth: "Douala, Cameroon"
 *             gender: "MALE"
 *             residence: "123 Main Street, Douala"
 *             formerSchool: "Primary School XYZ"
 *             classId: 1
 *             isNewStudent: true
 *             parentName: "Mr. James Doe"
 *             parentPhone: "677123456"
 *             parentWhatsapp: "677123456"
 *             parentEmail: "james.doe@email.com"
 *             parentAddress: "123 Main Street, Douala"
 *             relationship: "Father"
 *     responses:
 *       201:
 *         description: Student registered successfully with parent account created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Student registered successfully with parent account created"
 *                 data:
 *                   $ref: '#/components/schemas/RegistrationResult'
 *       400:
 *         description: Invalid request data or missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Missing required fields: studentName, dateOfBirth, placeOfBirth, gender, residence, classId, parentName, parentPhone, parentAddress"
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have BURSAR or SUPER_MANAGER role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Conflict - Parent with phone number already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "A parent account already exists with phone number 677123456. Please use the 'Link Existing Parent' option instead."
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/available-parents:
 *   get:
 *     summary: Get available parents for selection/linking
 *     description: |
 *       Retrieves a list of existing parent accounts that can be linked to students.
 *       Supports search functionality by name, phone, matricule, or email.
 *       Only BURSAR and SUPER_MANAGER can browse/search existing parents.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for parent name, phone, matricule, or email
 *         example: "John"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum number of results to return
 *         example: 20
 *     responses:
 *       200:
 *         description: Available parents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Available parents retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ParentSearchResult'
 *                 count:
 *                   type: integer
 *                   description: Number of parents returned
 *                   example: 15
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have BURSAR or SUPER_MANAGER role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/link-existing-parent:
 *   post:
 *     summary: Link existing parent to a student
 *     description: |
 *       Links an existing parent account to a student. This is used when the parent
 *       already has an account in the system and needs to be linked to a new child.
 *       Only BURSAR and SUPER_MANAGER can link existing parents to students.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LinkExistingParentRequest'
 *           example:
 *             studentId: 123
 *             parentId: 456
 *             relationship: "Father"
 *     responses:
 *       201:
 *         description: Parent linked to student successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Successfully linked Mr. James Doe to John Doe"
 *                 data:
 *                   type: object
 *                   properties:
 *                     link:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         parentId:
 *                           type: integer
 *                         studentId:
 *                           type: integer
 *                         relationship:
 *                           type: string
 *                     student:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         name:
 *                           type: string
 *                         matricule:
 *                           type: string
 *                     parent:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         name:
 *                           type: string
 *                         matricule:
 *                           type: string
 *                         email:
 *                           type: string
 *                         phone:
 *                           type: string
 *       400:
 *         description: Invalid request data or missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Missing required fields: studentId, parentId"
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have BURSAR or SUPER_MANAGER role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Student or parent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Student with ID 123 not found."
 *       409:
 *         description: Parent already linked to student
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Parent Mr. James Doe is already linked to student John Doe."
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/dashboard:
 *   get:
 *     summary: Get bursar dashboard with financial overview
 *     description: |
 *       Retrieves comprehensive dashboard data for the bursar including financial overview,
 *       recent activity, pending tasks, and recent student registrations.
 *       BURSAR and management roles can view dashboard.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional, defaults to current year)
 *         example: 1
 *     responses:
 *       200:
 *         description: Bursar dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Bursar dashboard data retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/BursarDashboard'
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have required permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/collection-analytics:
 *   get:
 *     summary: Get collection analytics (monthly trends, payment methods)
 *     description: |
 *       Retrieves collection analytics including monthly trends, payment method breakdown,
 *       and target vs actual performance. BURSAR and management roles can view analytics.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *         example: 1
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for analytics period
 *         example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for analytics period
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Collection analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Collection analytics retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/CollectionAnalytics'
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have required permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/payment-trends:
 *   get:
 *     summary: Get payment trends analysis
 *     description: |
 *       Retrieves payment trends analysis including daily collections, weekly summaries,
 *       payment method breakdowns, and peak collection periods.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *         example: 1
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *         description: Analysis period granularity
 *         example: "monthly"
 *     responses:
 *       200:
 *         description: Payment trends retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Payment trends retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     dailyCollections:
 *                       type: array
 *                       items:
 *                         type: object
 *                     weeklySummary:
 *                       type: array
 *                       items:
 *                         type: object
 *                     paymentMethodsBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                     peakCollectionDays:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have required permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/defaulters-report:
 *   get:
 *     summary: Get defaulters report (students with outstanding balances)
 *     description: |
 *       Retrieves a report of students with outstanding fee balances, including
 *       summary statistics and detailed student information.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *         example: 1
 *       - in: query
 *         name: minimumAmount
 *         schema:
 *           type: number
 *         description: Minimum outstanding amount to include (FCFA)
 *         example: 10000
 *       - in: query
 *         name: classId
 *         schema:
 *           type: integer
 *         description: Filter by specific class ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Defaulters report retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Defaulters report retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalDefaulters:
 *                       type: integer
 *                       description: Total number of students with outstanding balances
 *                       example: 45
 *                     totalOutstanding:
 *                       type: number
 *                       description: Total outstanding amount in FCFA
 *                       example: 1250000
 *                     byClass:
 *                       type: array
 *                       items:
 *                         type: object
 *                     byAmountRange:
 *                       type: array
 *                       items:
 *                         type: object
 *                     students:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - User does not have required permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /bursar/defaulters-report/pdf:
 *   get:
 *     summary: Export defaulters report as a printable PDF (one subclass per page)
 *     description: |
 *       Renders the defaulters report to a PDF. The output paginates by subclass —
 *       each subclass prints on its own page — and every row shows Name, Status
 *       (NEW/OLD), Total Paid, Expected 1st Installment, and Remaining. Accepts
 *       the same query parameters as `GET /bursar/defaulters-report`.
 *     tags: [Bursar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (defaults to current)
 *       - in: query
 *         name: minimumAmount
 *         schema:
 *           type: number
 *         description: Minimum outstanding amount to include (FCFA)
 *       - in: query
 *         name: classId
 *         schema:
 *           type: integer
 *         description: Filter to a specific class
 *       - in: query
 *         name: subClassId
 *         schema:
 *           type: integer
 *         description: Filter to a specific subclass. Omit to include all subclasses.
 *       - in: query
 *         name: installment
 *         schema:
 *           type: string
 *           enum: [first, second, third]
 *         description: Only include students still owing on this installment
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

export { };