// File: src/routes/cpu_metrics.ts
// Description: Route for fetching EC2 CPU utilization metrics from CloudWatch

import express, { Request, Response } from 'express';
import { getCpuUtilizationMetrics } from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const serviceLocation = 'API(CpuMetrics)';

// GET /cpu-utilization - Fetch CPU utilization metrics for the current EC2 instance
router.get('/cpu-utilization', async (req: Request, res: Response): Promise<void> => {
    try {
        logger.info(`${serviceLocation}: Received request for CPU utilization metrics`);
        
        // Fetch CPU utilization data from CloudWatch
        const cpuData = await getCpuUtilizationMetrics();
        
        // Return the metrics in the requested format
        res.status(200).json({
            timestamps: cpuData.timestamps,
            values: cpuData.values,
        });
        
        logger.info(`${serviceLocation}: Successfully returned ${cpuData.values.length} CPU utilization datapoints`);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch CPU utilization metrics: ${errorMessage}`);
        
        res.status(500).json({
            error: 'Failed to fetch CPU utilization metrics',
            message: errorMessage,
        });
    }
});

export default router;