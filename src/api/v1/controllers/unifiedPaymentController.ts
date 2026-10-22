// src/api/v1/controllers/unifiedPaymentController.ts
import { Request, Response } from 'express';
import * as unifiedPaymentService from '../services/unifiedPaymentService';
import * as paymentLedger from '../services/paymentLedgerService';

/**
 * Record payment for primary fees - creates fee if it doesn't exist
 * POST /api/v1/payments/primary
 */
export const recordPrimaryPaymentWithFee = async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        // Body arrives snake_cased by the case-conversion middleware.
        const { confirm_overpayment, ...body } = req.body || {};
        const result = await unifiedPaymentService.recordPrimaryPaymentWithFee({
            ...body,
            recorded_by_id: userId,
            overpayment_policy: 'require_confirmation',
            confirm_overpayment: confirm_overpayment === true || confirm_overpayment === 'true',
        });

        res.status(201).json({
            success: true,
            message: result.feeCreated
                ? 'Payment recorded and fee created successfully'
                : 'Payment recorded successfully',
            data: {
                payment: result.payment,
                fee: result.fee,
                feeCreated: result.feeCreated,
                // Receipt summary for the success dialog / "Print receipt" button
                receiptNumber: result.payment.receipt_number,
                amountExpected: result.ledger.amount_expected,
                amountPaid: result.ledger.amount_paid,
                balance: result.ledger.balance,
                overpayment: result.ledger.overpayment,
            }
        });
    } catch (error: any) {
        console.error('Error recording primary payment:', error);

        const mapped = paymentLedger.paymentErrorToHttp(error);
        if (mapped) return res.status(mapped.status).json(mapped.body);

        if (error instanceof unifiedPaymentService.DuplicatePaymentError) {
            return res.status(409).json({
                success: false,
                error: error.message,
                code: 'DUPLICATE_PAYMENT',
                existingPaymentId: error.existingPaymentId,
                secondsAgo: error.secondsAgo,
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Record payment for control fees - creates fee if it doesn't exist
 * POST /api/v1/payments/control
 */
export const recordControlPaymentWithFee = async (req: Request, res: Response): Promise<any> => {
    try {
        // Use the body directly plus recorded_by_id - middleware handles the conversion
        const paymentData = {
            ...req.body,
            recorded_by_id: (req as any).user?.id || 1 // Get from authenticated user or default to 1
        };

        const result = await unifiedPaymentService.recordControlPaymentWithFee(paymentData);

        res.status(201).json({
            success: true,
            message: result.feeCreated
                ? 'Control payment recorded and fee created successfully'
                : 'Control payment recorded successfully',
            data: {
                payment: result.payment,
                fee: result.fee,
                feeCreated: result.feeCreated
            }
        });
    } catch (error: any) {
        console.error('Error recording control payment:', error);

        if (error instanceof unifiedPaymentService.DuplicatePaymentError) {
            return res.status(409).json({
                success: false,
                error: error.message,
                code: 'DUPLICATE_PAYMENT',
                existingPaymentId: error.existingPaymentId,
                secondsAgo: error.secondsAgo,
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};