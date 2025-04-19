// File: __tests__/project.test.ts
// Description: This file contains unit tests for the project and project segmentation mask database models and functions.

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose'; // Import Types for ObjectId
import {
    FileType,
    ComponentBoundingBoxesClass,
} from '../src/types/database_types'; // Adjust path as necessary
import {
    connectToDatabase, // Assuming this initializes connection and checks admin
    projectModel,
    projectSegmentationMaskModel,
    userModel, // Needed to create a dummy user for project association
    createUser, // Helper to create the dummy user
    IProject,
    IProjectSegmentationMask,
    UserRole,
} from '../src/services/database'; // Adjust path as necessary
import { IUserDocument } from '../src/services/database'; // Import IUserDocument for user creation

// Mocking logger
jest.mock('../src/services/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let dbUri: string;
let testUser: IUserDocument; // To hold the created user for project association
let testProject: IProject; // To hold the created project for mask association

// Setup in-memory MongoDB server and create a test user
beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    dbUri = mongoServer.getUri();
    await mongoose.connect(dbUri);
    // Create a dummy user required for project creation
    const userResult = await createUser('projectTestUser', 'password', 'project@test.com', '9876543210', UserRole.User);
    if (userResult.success && userResult.user) {
        // Need the full user document to get the actual ObjectId
        const userDoc = await userModel.findById(userResult.user._id);
        if (!userDoc) {
            throw new Error('Failed to retrieve created test user document.');
        }
        testUser = userDoc;
    } else {
        throw new Error('Failed to create test user for project tests.');
    }
});

// Clean up database connection
afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

// Clear collections before each test
beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        // Keep the user collection intact as it's needed for project tests
        if (key !== 'users') {
            await collections[key].deleteMany({});
        }
    }
});

// --- Project Model Tests ---
describe('Project Model', () => {
    it.todo('Create a new project'); // TODO: Implement this test

});