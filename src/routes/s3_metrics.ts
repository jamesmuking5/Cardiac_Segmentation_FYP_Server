// File: src/routes/s3_metrics.ts
// Description: Routes for fetching S3 metrics from CloudWatch

import express, { Request, Response } from 'express';
import { 
    getAllS3Metrics,
    getS3BucketSizeMetrics,
    getS3NumberOfObjectsMetrics,
    getS3AllRequestsMetrics,
    getS3GetRequestsMetrics,
    getS3PutRequestsMetrics,
    S3Metrics
} from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const routeLocation = 'S3-Metrics-Routes';

// Helper function to handle S3 metric requests with bucket name validation
const handleS3MetricRequest = async (
    req: Request, 
    res: Response, 
    metricName: string, 
    metricFunction: (bucketName: string) => Promise<any>
): Promise<void> => {
    const { bucketName } = req.params;
    
    try {
        // Validate bucket name parameter
        if (!bucketName || typeof bucketName !== 'string' || bucketName.trim() === '') {
            logger.warn(`${routeLocation}: Invalid bucket name parameter: ${bucketName}`);
            res.status(400).json({ 
                error: 'Bad Request',
                message: 'Valid bucket name is required',
                bucketName: bucketName || 'undefined'
            });
            return;
        }
        
        // Validate bucket name format (basic S3 bucket naming rules)
        const bucketNameRegex = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
        if (bucketName.length < 3 || bucketName.length > 63 || !bucketNameRegex.test(bucketName)) {
            logger.warn(`${routeLocation}: Invalid bucket name format: ${bucketName}`);
            res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid bucket name format. Bucket names must be 3-63 characters long and follow S3 naming conventions',
                bucketName
            });
            return;
        }
        
        logger.info(`${routeLocation}: Fetching ${metricName} metrics for bucket: ${bucketName}`);
        
        // Fetch the metric data
        const metricData = await metricFunction(bucketName);
        
        logger.info(`${routeLocation}: Successfully retrieved ${metricName} metrics for bucket: ${bucketName}`);
        
        // Return the metric data
        res.status(200).json(metricData);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error(`${routeLocation}: Error fetching ${metricName} metrics for bucket ${bucketName}: ${errorMessage}`);
        
        // Handle specific AWS errors
        if (errorMessage.includes('NoSuchBucket')) {
            res.status(404).json({
                error: 'Bucket Not Found',
                message: `S3 bucket '${bucketName}' does not exist or you don't have access to it`,
                bucketName
            });
        } else if (errorMessage.includes('AccessDenied')) {
            res.status(403).json({
                error: 'Access Denied',
                message: `You don't have permission to access CloudWatch metrics for bucket '${bucketName}'`,
                bucketName
            });
        } else {
            res.status(500).json({
                error: 'Internal Server Error',
                message: `Failed to retrieve ${metricName} metrics: ${errorMessage}`,
                bucketName
            });
        }
    }
};

// GET /metrics/s3/:bucketName - Fetch all S3 metrics for a bucket
router.get('/:bucketName', async (req: Request, res: Response): Promise<void> => {
    const { bucketName } = req.params;
    
    try {
        // Validate bucket name parameter
        if (!bucketName || typeof bucketName !== 'string' || bucketName.trim() === '') {
            logger.warn(`${routeLocation}: Invalid bucket name parameter: ${bucketName}`);
            res.status(400).json({ 
                error: 'Bad Request',
                message: 'Valid bucket name is required',
                bucketName: bucketName || 'undefined'
            });
            return;
        }
        
        // Validate bucket name format
        const bucketNameRegex = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
        if (bucketName.length < 3 || bucketName.length > 63 || !bucketNameRegex.test(bucketName)) {
            logger.warn(`${routeLocation}: Invalid bucket name format: ${bucketName}`);
            res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid bucket name format. Bucket names must be 3-63 characters long and follow S3 naming conventions',
                bucketName
            });
            return;
        }
        
        logger.info(`${routeLocation}: Fetching all S3 metrics for bucket: ${bucketName}`);
        
        // Fetch all S3 metrics
        const s3Metrics: S3Metrics = await getAllS3Metrics(bucketName);
        
        logger.info(`${routeLocation}: Successfully retrieved all S3 metrics for bucket: ${bucketName}`);
        
        // Return the comprehensive metrics data
        res.status(200).json(s3Metrics);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error(`${routeLocation}: Error fetching all S3 metrics for bucket ${bucketName}: ${errorMessage}`);
        
        // Handle specific AWS errors
        if (errorMessage.includes('NoSuchBucket')) {
            res.status(404).json({
                error: 'Bucket Not Found',
                message: `S3 bucket '${bucketName}' does not exist or you don't have access to it`,
                bucketName
            });
        } else if (errorMessage.includes('AccessDenied')) {
            res.status(403).json({
                error: 'Access Denied',
                message: `You don't have permission to access CloudWatch metrics for bucket '${bucketName}'`,
                bucketName
            });
        } else {
            res.status(500).json({
                error: 'Internal Server Error',
                message: `Failed to retrieve S3 metrics: ${errorMessage}`,
                bucketName
            });
        }
    }
});

// Individual metric routes for granular access

// GET /metrics/s3/:bucketName/bucket-size - Fetch S3 Bucket Size metrics
router.get('/:bucketName/bucket-size', async (req: Request, res: Response): Promise<void> => {
    await handleS3MetricRequest(req, res, 'S3 Bucket Size', getS3BucketSizeMetrics);
});

// GET /metrics/s3/:bucketName/object-count - Fetch S3 Number of Objects metrics
router.get('/:bucketName/object-count', async (req: Request, res: Response): Promise<void> => {
    await handleS3MetricRequest(req, res, 'S3 Object Count', getS3NumberOfObjectsMetrics);
});

// GET /metrics/s3/:bucketName/all-requests - Fetch S3 All Requests metrics
router.get('/:bucketName/all-requests', async (req: Request, res: Response): Promise<void> => {
    await handleS3MetricRequest(req, res, 'S3 All Requests', getS3AllRequestsMetrics);
});

// GET /metrics/s3/:bucketName/get-requests - Fetch S3 Get Requests metrics
router.get('/:bucketName/get-requests', async (req: Request, res: Response): Promise<void> => {
    await handleS3MetricRequest(req, res, 'S3 Get Requests', getS3GetRequestsMetrics);
});

// GET /metrics/s3/:bucketName/put-requests - Fetch S3 Put Requests metrics
router.get('/:bucketName/put-requests', async (req: Request, res: Response): Promise<void> => {
    await handleS3MetricRequest(req, res, 'S3 Put Requests', getS3PutRequestsMetrics);
});

export default router;