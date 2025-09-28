// File: src/services/cloudwatch.ts
// Description: CloudWatch service for fetching EC2 metrics

import { CloudWatchClient, GetMetricStatisticsCommand, GetMetricStatisticsCommandInput } from '@aws-sdk/client-cloudwatch';
import logger from './logger';

const serviceLocation = 'CloudWatchService';

// Create CloudWatch client instance
let cloudWatchClientInstance: CloudWatchClient | null = null;

// Get singleton CloudWatch client
function getCloudWatchClient(): CloudWatchClient {
    if (!cloudWatchClientInstance) {
        cloudWatchClientInstance = new CloudWatchClient({
            region: process.env.AWS_REGION || 'us-east-1',
        });
        logger.info(`${serviceLocation}: CloudWatch client initialized for region ${process.env.AWS_REGION || 'us-east-1'}`);
    }
    return cloudWatchClientInstance;
}

// Get EC2 instance ID from environment variable or metadata service
async function getCurrentInstanceId(): Promise<string> {
    try {
        // First, check if instance ID is provided via environment variable
        if (process.env.EC2_INSTANCE_ID) {
            logger.info(`${serviceLocation}: Using instance ID from environment variable: ${process.env.EC2_INSTANCE_ID}`);
            return process.env.EC2_INSTANCE_ID;
        }
        
        // Fallback to EC2 metadata service
        logger.info(`${serviceLocation}: EC2_INSTANCE_ID not found in environment, fetching from metadata service`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
        
        const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
            signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch instance ID from metadata service: ${response.status}`);
        }
        
        const instanceId = await response.text();
        logger.info(`${serviceLocation}: Retrieved instance ID from metadata service: ${instanceId}`);
        return instanceId;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to get instance ID: ${errorMessage}`);
        throw new Error(`Unable to retrieve EC2 instance ID. Please set EC2_INSTANCE_ID environment variable or ensure EC2 metadata service is accessible: ${errorMessage}`);
    }
}

// Interface for CPU utilization data
export interface CpuUtilizationData {
    timestamps: string[];
    values: number[];
}

// Fetch CPU utilization metrics for the current EC2 instance
export async function getCpuUtilizationMetrics(): Promise<CpuUtilizationData> {
    try {
        // Get current instance ID
        const instanceId = await getCurrentInstanceId();
        
        // Calculate time range (last 1 hour)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago
        
        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/EC2',
            MetricName: 'CPUUtilization',
            Dimensions: [
                {
                    Name: 'InstanceId',
                    Value: instanceId,
                },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: 300, // 5 minutes in seconds
            Statistics: ['Average'],
        };
        
        logger.info(`${serviceLocation}: Fetching CPU metrics for instance ${instanceId} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);
        
        // Process response data
        const datapoints = response.Datapoints || [];
        
        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        
        // Extract timestamps and values
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => Number((point.Average || 0).toFixed(1)));
        
        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} CPU utilization datapoints for instance ${instanceId}`);
        
        return {
            timestamps,
            values,
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch CPU utilization metrics: ${errorMessage}`);
        throw new Error(`Failed to retrieve CPU utilization metrics: ${errorMessage}`);
    }
}