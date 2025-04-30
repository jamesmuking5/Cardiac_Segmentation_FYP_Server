#!/bin/bash
# To run this script in EC2 instance

export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="004078809023"
export ECR_REGISTRY_URI="004078809023.dkr.ecr.us-east-1.amazonaws.com"
export ECR_REPOSITORY_NAME="cardiac_segmentation_fyp_server_ecr_repository"
export IMAGE_TAG="latest"
export CONTAINER_NAME="my-node-app-container"
export APP_PORT="3000"
export HOST_PORT="80"

export REDIS_AWS="true"
export REDIS_HOST="redis-node-f5u69g.serverless.use1.cache.amazonaws.com"
export REDIS_PORT="6379"
export MONGODB_URI="mongodb+srv://Svelte:ENsJuvvYIBQWsKsu@visheart-cluster.qgbvopg.mongodb.net/visheart?retryWrites=true&w=majority&appName=Visheart-Cluster"
export PORT="$APP_PORT"

export AWS_BUCKET_NAME="visheart-bucket-004078809023-us-east-1"
export S3_REGION="us-east-1"

until docker info >/dev/null 2>&1; do
    echo "Waiting for Docker daemon..."
    sleep 1
done
echo "Docker daemon is running."

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY_URI

docker pull $ECR_REGISTRY_URI/$ECR_REPOSITORY_NAME:$IMAGE_TAG

docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

docker run -d \
    -p $HOST_PORT:$APP_PORT \
    -e REDIS_AWS=$REDIS_AWS \
    -e REDIS_HOST=$REDIS_HOST \
    -e REDIS_PORT=$REDIS_PORT \
    -e MONGODB_URI=$MONGODB_URI \
    -e PORT=$PORT \
    -e AWS_BUCKET_NAME=$AWS_BUCKET_NAME \
    -e S3_REGION=$S3_REGION \
    --name $CONTAINER_NAME \
    --restart always \
    $ECR_REGISTRY_URI/$ECR_REPOSITORY_NAME:$IMAGE_TAG

echo "User data script finished."
