/**
 * @swagger
 * tags:
 *   name: Fees
 *   description: School fees management endpoints
 */

/**
 * @swagger
 * /fees:
 *   get:
 *     summary: Get all fees
 *     description: Retrieves a list of all school fees records, optionally filtered by academic year
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *     responses:
 *       200:
 *         description: List of fee records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SchoolFees'
 *       401:
 *         description: Unauthorized - User is not authenticated
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

/**
 * @swagger
 * /fees/student/{studentId}:
 *   get:
 *     summary: Get fees for a specific student
 *     description: Retrieves fee records for a specific student
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Student ID
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *     responses:
 *       200:
 *         description: Fee records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SchoolFees'
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Student not found
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

// POST /fees (create) and PUT /fees/{id} (update) were removed (M10): they let a
// caller set amount_paid to an arbitrary value with no PaymentTransaction, silently
// desyncing the stored total from the real payment ledger. Fees are created via the
// enrollment flow; amount_paid moves only through POST/PUT /fees/{feeId}/payments
// below; amount_expected corrections go through POST /fees/{id}/deduction.

/**
 * @swagger
 * /fees/{feeId}/payments:
 *   get:
 *     summary: Get all payments for a fee
 *     description: Retrieves a list of all payments for a specific fee
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Fee ID
 *     responses:
 *       200:
 *         description: List of payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentTransaction'
 *       401:
 *         description: Unauthorized - User is not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Fee not found
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

/**
 * @swagger
 * /fees/{feeId}/payments:
 *   post:
 *     summary: Record a payment for a fee
 *     description: Records a payment transaction for a specific fee. Only accessible by ADMIN, PRINCIPAL, BURSAR.
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Fee ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RecordPaymentRequest'
 *     responses:
 *       201:
 *         description: Payment recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PaymentTransaction'
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *       404:
 *         description: Fee not found
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

/**
 * @swagger
 * /fees/reports:
 *   get:
 *     summary: Export fees report
 *     description: Exports fee payment reports in the specified format
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         schema:
 *           type: integer
 *         description: Filter by academic year ID (optional)
 *       - in: query
 *         name: sub_classId
 *         schema:
 *           type: integer
 *         description: Filter by sub_class ID (optional)
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [excel, pdf]
 *           default: excel
 *         description: Export format (optional)
 *     responses:
 *       200:
 *         description: Report exported successfully
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
 *                   example: Fee report exported successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     fileUrl:
 *                       type: string
 *                       example: "/reports/fees/fees_report_2023_2024.xlsx"
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalFees:
 *                           type: number
 *                           example: 10000000
 *                         totalPaid:
 *                           type: number
 *                           example: 8500000
 *                         totalRemaining:
 *                           type: number
 *                           example: 1500000
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
 */

export { }; 