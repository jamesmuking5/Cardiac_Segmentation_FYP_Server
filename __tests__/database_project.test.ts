// __tests__/database_project.test.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose'; // Import Types for ObjectId
import {
    FileType,
    FileDataType,
    CRUDOperation,
    ProjectCrudResult,
    IProjectDocument,
    IUserDocument,
    IProject,
    UserRole
} from '../src/types/database_types'; // Adjust path as necessary
import {
    connectToDatabase,
    projectModel,
    projectSegmentationMaskModel,
    userModel,
    createUser,
    createProject,
    readProject,
    // updateProject, // Keep commented if not implemented
    // deleteProject // Keep commented if not implemented
} from '../src/services/database'; // Adjust path as necessary

// Mocking logger
jest.mock('../src/services/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let dbUri: string;
let testUser: IUserDocument; // To hold the created user for project association
let otherTestUser: IUserDocument; // Second user for conflict tests
let projects: IProjectDocument[] = []; // To hold created projects for testing read

// Setup in-memory MongoDB server and create test users
beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    dbUri = mongoServer.getUri();
    // Use test-specific DB name if desired, otherwise default from database.ts
    await mongoose.connect(dbUri); // Ensure connection before creating users

    // Create the main test user
    const userResult = await createUser('projectTestUser', 'Password123!', 'project@test.com', '9876543210', UserRole.User);
    if (userResult.success && userResult.user) {
        const userDoc = await userModel.findById(userResult.user._id);
        if (!userDoc) throw new Error('Failed to retrieve created test user document.');
        testUser = userDoc;
    } else {
        throw new Error(`Failed to create main test user: ${userResult.message || 'Unknown error'}`);
    }

     // Create a second user for multi-user/conflict tests
     const userResultOther = await createUser('otherProjectUser', 'Password456!', 'other@test.com', '1122334455', UserRole.User);
     if (userResultOther.success && userResultOther.user) {
         const userDoc = await userModel.findById(userResultOther.user._id);
         if (!userDoc) throw new Error('Failed to retrieve other test user');
         otherTestUser = userDoc;
     } else {
         throw new Error(`Failed to create other test user: ${userResultOther.message}`);
     }
});

// Clean up database connection
afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

// Clear relevant collections before each test
beforeEach(async () => {
    // Clear projects and segmentation masks (users are kept across tests)
    await projectModel.deleteMany({});
    await projectSegmentationMaskModel.deleteMany({});
    projects = []; // Reset projects array
});

// --- Project Model Tests ---
describe('Project Model', () => {
    // Basic connection check (relies on beforeAll)
    it('should establish a connection to the database', () => {
        expect(mongoose.connection.readyState).toBe(1); // 1 = connected
    });

    // -- Create Project Tests --
    describe('createProject', () => {
        // --- Success Cases ---
        it('should create a new project with all optional fields filled', async () => {
            const projectData: IProject = {
                userid: String(testUser._id),
                name: 'Test Project Create Full',
                originalfilename: 'turtles_full.nii.gz',
                description: 'A test project description, I love turtles',
                isSaved: false,
                filename: `${String(testUser._id)}_hash_full.nii.gz`,
                filetype: FileType.NIFTI_GZ,
                filesize: 33400000, // 33.4 MB
                filehash: 'hash_full',
                basepath: `s3://bucket/temp/${testUser._id}/hash_full`,
                originalfilepath: `s3://bucket/temp/${testUser._id}/hash_full/original.nii.gz`,
                extractedfolderpath: `s3://bucket/temp/${testUser._id}/hash_full/extracted`,
                status: { upload: true, extract: true },
                datatype: FileDataType.FLOAT32,
                dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
                voxelsize: { x: 1.1, y: 1.2, z: 5.0, t: 2.0 },
            };

            const result = await createProject(
                projectData.userid, projectData.name, projectData.originalfilename, projectData.isSaved,
                projectData.filename, projectData.filetype, projectData.filesize, projectData.filehash,
                projectData.basepath, projectData.originalfilepath, projectData.extractedfolderpath,
                projectData.status, projectData.datatype, projectData.dimensions,
                projectData.voxelsize, projectData.description
            );

            expect(result.success).toBe(true);
            expect(result.operation).toBe(CRUDOperation.CREATE);
            expect(result.project).toBeDefined();
            // Check all fields match input data
            expect(result.project?.userid).toEqual(projectData.userid);
            expect(result.project?.name).toEqual(projectData.name);
            expect(result.project?.description).toEqual(projectData.description);
            expect(result.project?.originalfilename).toEqual(projectData.originalfilename);
            expect(result.project?.isSaved).toEqual(projectData.isSaved);
            expect(result.project?.filename).toEqual(projectData.filename);
            expect(result.project?.filetype).toEqual(projectData.filetype);
            expect(result.project?.filesize).toEqual(projectData.filesize);
            expect(result.project?.filehash).toEqual(projectData.filehash);
            expect(result.project?.basepath).toEqual(projectData.basepath);
            expect(result.project?.originalfilepath).toEqual(projectData.originalfilepath);
            expect(result.project?.extractedfolderpath).toEqual(projectData.extractedfolderpath);
            expect(result.project?.status).toEqual(projectData.status);
            expect(result.project?.datatype).toEqual(projectData.datatype);
            expect(result.project?.dimensions).toEqual(projectData.dimensions);
            expect(result.project?.voxelsize).toEqual(projectData.voxelsize);
            // Check timestamps
            expect(result.project?.createdAt).toBeDefined();
            expect(result.project?.updatedAt).toBeDefined();
            expect(result.project?.createdAt).toEqual(result.project?.updatedAt);
        });

        it('should create a new project with only required fields', async () => {
             const projectData: IProject = { // Define only required fields for the type
                 userid: String(testUser._id),
                 name: 'Test Project Required',
                 originalfilename: 'turtles_required.nii',
                 isSaved: false,
                 filename: `${String(testUser._id)}_hash_required.nii`,
                 filetype: FileType.NIFTI,
                 filesize: 3340000,
                 filehash: 'hash_required',
                 basepath: `s3://bucket/temp/${testUser._id}/hash_required`,
                 originalfilepath: `s3://bucket/temp/${testUser._id}/hash_required/original.nii`,
                 extractedfolderpath: `s3://bucket/temp/${testUser._id}/hash_required/extracted`,
                 datatype: FileDataType.UINT8,
                 dimensions: { width: 128, height: 128, slices: 5 },
                 status: { upload: true, extract: false },
                 // description and voxelsize are optional
             };

             const result = await createProject(
                 projectData.userid, projectData.name, projectData.originalfilename, projectData.isSaved,
                 projectData.filename, projectData.filetype, projectData.filesize, projectData.filehash,
                 projectData.basepath, projectData.originalfilepath, projectData.extractedfolderpath,
                 projectData.status, projectData.datatype, projectData.dimensions
             );

             expect(result.success).toBe(true);
             expect(result.operation).toBe(CRUDOperation.CREATE);
             expect(result.project).toBeDefined();
             expect(result.project?.userid).toEqual(projectData.userid);
             expect(result.project?.name).toEqual(projectData.name);
             expect(result.project?.originalfilename).toEqual(projectData.originalfilename);
             expect(result.project?.isSaved).toEqual(projectData.isSaved);
             expect(result.project?.filename).toEqual(projectData.filename);
             expect(result.project?.filetype).toEqual(projectData.filetype);
             expect(result.project?.filesize).toEqual(projectData.filesize);
             expect(result.project?.filehash).toEqual(projectData.filehash);
             expect(result.project?.basepath).toEqual(projectData.basepath);
             expect(result.project?.originalfilepath).toEqual(projectData.originalfilepath);
             expect(result.project?.extractedfolderpath).toEqual(projectData.extractedfolderpath);
             expect(result.project?.status).toEqual(projectData.status);
             expect(result.project?.datatype).toEqual(projectData.datatype);
             expect(result.project?.dimensions).toEqual(projectData.dimensions);
             // Optional fields should be undefined or have defaults if specified in schema
             expect(result.project?.voxelsize).toBeUndefined();
             expect(result.project?.description).toBeUndefined();
             expect(result.project?.createdAt).toBeDefined();
             expect(result.project?.updatedAt).toBeDefined();
         });

        // --- Failure Cases: Invalid Inputs ---
        it('should fail if userid does not exist', async () => {
            const nonExistentUserId = new Types.ObjectId().toString();
            const result = await createProject(
                nonExistentUserId, 'Test Invalid User', 'invalid.nii', false,
                `${nonExistentUserId}_hash`, FileType.NIFTI, 100, 'hash', 'base', 'orig', 'extr',
                { upload: false, extract: false }, FileDataType.UINT8, { width: 10, height: 10, slices: 1 }
            );
            expect(result.success).toBe(false);
            expect(result.project).toBeUndefined();
            expect(result.message).toContain(`User ${nonExistentUserId} does not exist.`);
        });

         it.each([
             { field: 'userid', value: '' },
             { field: 'name', value: '' },
             { field: 'originalfilename', value: '' },
             { field: 'filename', value: '' },
             { field: 'filehash', value: '' },
             { field: 'basepath', value: '' },
             { field: 'originalfilepath', value: '' },
             { field: 'extractedfolderpath', value: '' },
             { field: 'datatype', value: '' },
         ])('should fail if required string field "$field" is empty', async ({ field, value }) => {
             const projectData: IProject = {
                 userid: String(testUser._id), name: 'Test Empty Str', originalfilename: 'empty.nii', isSaved: false,
                 filename: `${String(testUser._id)}_hash_empty`, filetype: FileType.NIFTI, filesize: 100, filehash: 'hash_empty',
                 basepath: `s3://bucket/empty`, originalfilepath: `s3://bucket/empty/original.nii`, extractedfolderpath: `s3://bucket/empty/extracted`,
                 datatype: FileDataType.UINT8, dimensions: { width: 10, height: 10, slices: 1 }, status: { upload: true, extract: false }
             };
             // Override the field to be tested
             (projectData as any)[field] = value;

             const result = await createProject(
                 projectData.userid, projectData.name, projectData.originalfilename, projectData.isSaved,
                 projectData.filename, projectData.filetype, projectData.filesize, projectData.filehash,
                 projectData.basepath, projectData.originalfilepath, projectData.extractedfolderpath,
                 projectData.status, projectData.datatype, projectData.dimensions
             );

             expect(result.success).toBe(false);
             expect(result.message).toContain('Invalid input parameters for project creation');
         });

         it.each([
             { field: 'filesize', value: 0 },
             { field: 'filesize', value: -100 },
             { field: 'dimensions.width', value: 0 },
             { field: 'dimensions.height', value: -10 },
             { field: 'dimensions.slices', value: 0 },
             // Add tests for voxel dimensions if provided
         ])('should fail if numeric field "$field" is not positive', async ({ field, value }) => {
              const projectData: IProject = {
                 userid: String(testUser._id), name: 'Test Neg Num', originalfilename: 'neg.nii', isSaved: false,
                 filename: `${String(testUser._id)}_hash_neg`, filetype: FileType.NIFTI, filesize: 100, filehash: 'hash_neg',
                 basepath: `s3://bucket/neg`, originalfilepath: `s3://bucket/neg/original.nii`, extractedfolderpath: `s3://bucket/neg/extracted`,
                 datatype: FileDataType.UINT8, dimensions: { width: 10, height: 10, slices: 1 }, status: { upload: true, extract: false },
                 voxelsize: { x: 1, y: 1, z: 1 } // Add optional fields if testing them
             };

              // Set the invalid value, handling nested properties
             if (field.includes('.')) {
                 const [outer, inner] = field.split('.');
                 if (outer === 'dimensions' || outer === 'voxelsize') {
                     (projectData[outer] as any)[inner] = value;
                 }
             } else {
                 (projectData as any)[field] = value;
             }

             const result = await createProject(
                 projectData.userid, projectData.name, projectData.originalfilename, projectData.isSaved,
                 projectData.filename, projectData.filetype, projectData.filesize, projectData.filehash,
                 projectData.basepath, projectData.originalfilepath, projectData.extractedfolderpath,
                 projectData.status, projectData.datatype, projectData.dimensions, projectData.voxelsize
             );

             expect(result.success).toBe(false);
             expect(result.message).toContain('Invalid numeric input parameters for project creation')
                .or.toContain('Invalid voxel size input parameters for project creation'); // Allow either message
         });


         // --- Failure Cases: Uniqueness Constraints ---
         const baseProjectData: IProject = {
             userid: String(testUser._id), name: 'Unique Base', originalfilename: 'base.nii', isSaved: false,
             filename: `${String(testUser._id)}_hash_base.nii`, filetype: FileType.NIFTI, filesize: 100, filehash: 'hash_base',
             basepath: `s3://bucket/base`, originalfilepath: `s3://bucket/base/original.nii`, extractedfolderpath: `s3://bucket/base/extracted`,
             datatype: FileDataType.UINT8, dimensions: { width: 10, height: 10, slices: 1 }, status: { upload: true, extract: false }
         };

         // Create a base project to conflict with
         beforeEach(async () => {
             // Ensure the base project exists before each uniqueness test
              await createProject(
                 baseProjectData.userid, baseProjectData.name, baseProjectData.originalfilename, baseProjectData.isSaved,
                 baseProjectData.filename, baseProjectData.filetype, baseProjectData.filesize, baseProjectData.filehash,
                 baseProjectData.basepath, baseProjectData.originalfilepath, baseProjectData.extractedfolderpath,
                 baseProjectData.status, baseProjectData.datatype, baseProjectData.dimensions
             );
         });

         it('should fail if name conflicts for the same user', async () => {
             const result = await createProject(
                 String(testUser._id), baseProjectData.name, // Same name, same user
                 'file2.nii', false, `${String(testUser._id)}_hash2.nii`, FileType.NIFTI, 101, 'hash2',
                 'base2', 'orig2', 'extr2', { upload: true, extract: false }, FileDataType.UINT8, { width: 11, height: 11, slices: 2 }
             );
             expect(result.success).toBe(false);
             expect(result.message).toContain(`Name "${baseProjectData.name}" already exists for this user.`);
         });

         it('should succeed if name conflicts but for a different user', async () => {
             const result = await createProject(
                 String(otherTestUser._id), baseProjectData.name, // Same name, DIFFERENT user
                 'file_other.nii', false, `${String(otherTestUser._id)}_hash_other.nii`, FileType.NIFTI, 102, 'hash_other',
                 'base_other', 'orig_other', 'extr_other', { upload: true, extract: false }, FileDataType.UINT8, { width: 12, height: 12, slices: 3 }
             );
             expect(result.success).toBe(true); // Should succeed for different user
             expect(result.project).toBeDefined();
             expect(result.project?.name).toBe(baseProjectData.name);
             expect(result.project?.userid).toBe(String(otherTestUser._id));
         });

         it('should fail if filehash conflicts for the same user', async () => {
            const result = await createProject(
                String(testUser._id), 'Different Name Hash', // Different name
                'file_hash_conflict.nii', false, `${String(testUser._id)}_hash_conflict.nii`, FileType.NIFTI, 103,
                baseProjectData.filehash, // Same hash, same user
                'base_hash_conflict', 'orig_hash_conflict', 'extr_hash_conflict', { upload: true, extract: false }, FileDataType.UINT8, { width: 13, height: 13, slices: 4 }
            );
            expect(result.success).toBe(false);
            expect(result.message).toContain(`File hash "${baseProjectData.filehash}" already exists for this user.`);
         });

          it('should succeed if filehash conflicts but for a different user', async () => {
             const result = await createProject(
                 String(otherTestUser._id), 'Other User Hash Conflict', // Different name
                 'file_other_hash.nii', false, `${String(otherTestUser._id)}_hash_other_conflict.nii`, FileType.NIFTI, 104,
                 baseProjectData.filehash, // Same hash, DIFFERENT user
                 'base_other_hash', 'orig_other_hash', 'extr_other_hash', { upload: true, extract: false }, FileDataType.UINT8, { width: 14, height: 14, slices: 5 }
             );
             expect(result.success).toBe(true);
             expect(result.project).toBeDefined();
             expect(result.project?.filehash).toBe(baseProjectData.filehash);
             expect(result.project?.userid).toBe(String(otherTestUser._id));
         });

          it('should fail if originalfilepath conflicts globally', async () => {
            const result = await createProject(
                String(otherTestUser._id), // Different user
                'Orig Path Conflict', 'file_op_conflict.nii', false, `${String(otherTestUser._id)}_hash_op_conflict.nii`, FileType.NIFTI, 105, 'hash_op_conflict',
                'base_op_conflict',
                baseProjectData.originalfilepath, // Same original path
                'extr_op_conflict', { upload: true, extract: false }, FileDataType.UINT8, { width: 15, height: 15, slices: 6 }
            );
            expect(result.success).toBe(false);
            expect(result.message).toContain(`Original filepath "${baseProjectData.originalfilepath}" is already in use globally.`);
        });

         it('should fail if extractedfolderpath conflicts globally', async () => {
             const result = await createProject(
                 String(otherTestUser._id), // Different user
                 'Extr Path Conflict', 'file_ep_conflict.nii', false, `${String(otherTestUser._id)}_hash_ep_conflict.nii`, FileType.NIFTI, 106, 'hash_ep_conflict',
                 'base_ep_conflict', 'orig_ep_conflict',
                 baseProjectData.extractedfolderpath, // Same extracted path
                 { upload: true, extract: false }, FileDataType.UINT8, { width: 16, height: 16, slices: 7 }
             );
             expect(result.success).toBe(false);
             expect(result.message).toContain(`Extracted folder path "${baseProjectData.extractedfolderpath}" is already in use globally.`);
         });

         it('should fail if filename conflicts globally', async () => {
             const result = await createProject(
                 String(otherTestUser._id), // Different user
                 'Filename Conflict', 'file_fn_conflict.nii', false,
                 baseProjectData.filename, // Same filename
                 FileType.NIFTI, 107, 'hash_fn_conflict',
                 'base_fn_conflict', 'orig_fn_conflict', 'extr_fn_conflict',
                 { upload: true, extract: false }, FileDataType.UINT8, { width: 17, height: 17, slices: 8 }
             );
             expect(result.success).toBe(false);
             expect(result.message).toContain(`Server filename "${baseProjectData.filename}" is already in use globally.`);
         });

         it('should fail and report multiple conflicts if they exist', async () => {
             const result = await createProject(
                 String(testUser._id), // Same user
                 baseProjectData.name, // Same name
                 'multi_conflict.nii', false,
                 baseProjectData.filename, // Same filename
                 FileType.NIFTI, 108,
                 baseProjectData.filehash, // Same filehash
                 'base_multi', 'orig_multi', 'extr_multi',
                 { upload: true, extract: false }, FileDataType.UINT8, { width: 18, height: 18, slices: 9 }
             );
             expect(result.success).toBe(false);
             expect(result.message).toContain(`Name "${baseProjectData.name}" already exists for this user.`);
             expect(result.message).toContain(`File hash "${baseProjectData.filehash}" already exists for this user.`);
             expect(result.message).toContain(`Server filename "${baseProjectData.filename}" is already in use globally.`);
         });

    }); // End describe('createProject')

    // -- Read Project Tests --
    describe('readProject', () => {
        let projectData1: IProject;
        let projectData2: IProject;
        let projectData3: IProject;
        let projectDataOtherUser: IProject;
        let createdProjects: IProjectDocument[] = []; // Store created projects with IDs

        // Use beforeAll within this describe block to define data that uses dynamic user IDs
        beforeAll(() => {
            projectData1 = {
                userid: String(testUser._id), name: 'Read Test Project 1', originalfilename: 'read_turtles1.nii.gz', isSaved: false,
                filename: `${String(testUser._id)}_readhash1.nii.gz`, filetype: FileType.NIFTI_GZ, filesize: 1000, filehash: 'readhash1',
                basepath: `s3://bucket/read/${testUser._id}/readhash1`, originalfilepath: `s3://bucket/read/${testUser._id}/readhash1/original1.nii.gz`,
                extractedfolderpath: `s3://bucket/read/${testUser._id}/readhash1/extracted`, datatype: FileDataType.FLOAT32,
                dimensions: { width: 10, height: 10, slices: 1 }, status: { upload: true, extract: true }
            };
            projectData2 = {
                userid: String(testUser._id), name: 'Read Test Project 2', originalfilename: 'read_turtles2.dcm', isSaved: true, // Saved
                filename: `${String(testUser._id)}_readhash2.dcm`, filetype: FileType.DICOM, filesize: 5000, filehash: 'readhash2', // DICOM, larger
                basepath: `s3://bucket/read/${testUser._id}/readhash2`, originalfilepath: `s3://bucket/read/${testUser._id}/readhash2/original2.dcm`,
                extractedfolderpath: `s3://bucket/read/${testUser._id}/readhash2/extracted`, datatype: FileDataType.UINT16, // Different datatype
                dimensions: { width: 20, height: 20, slices: 1 }, status: { upload: true, extract: false }, // Extract false
                description: "This is project 2 for reading" // Has description
            };
            projectData3 = {
                userid: String(testUser._id), name: 'Another Project 3', originalfilename: 'read_turtles3.nii.gz', isSaved: false, // Name variation
                filename: `${String(testUser._id)}_readhash3.nii.gz`, filetype: FileType.NIFTI_GZ, filesize: 1500, filehash: 'readhash3', // Medium size
                basepath: `s3://bucket/read/${testUser._id}/readhash3`, originalfilepath: `s3://bucket/read/${testUser._id}/readhash3/original3.nii.gz`,
                extractedfolderpath: `s3://bucket/read/${testUser._id}/readhash3/extracted`, datatype: FileDataType.FLOAT32,
                dimensions: { width: 10, height: 10, slices: 1, frames: 5 }, status: { upload: true, extract: true }, // Has frames
                voxelsize: { x: 0.5, y: 0.5, z: 1.0, t: 2.0 } // Has voxelsize
            };
            projectDataOtherUser = {
                userid: String(otherTestUser._id), name: 'Other User Project', originalfilename: 'other_file.nii', isSaved: true,
                filename: `${String(otherTestUser._id)}_otherhash.nii`, filetype: FileType.NIFTI, filesize: 2500, filehash: 'otherhash',
                basepath: `s3://bucket/read/${otherTestUser._id}/otherhash`, originalfilepath: `s3://bucket/read/${otherTestUser._id}/otherhash/original_other.nii`,
                extractedfolderpath: `s3://bucket/read/${otherTestUser._id}/otherhash/extracted`, datatype: FileDataType.UINT8,
                dimensions: { width: 15, height: 15, slices: 1 }, status: { upload: false, extract: false } // Both false
            };
        });

        // Setup: Create the projects before each test in this block
        beforeEach(async () => {
             // Use IProjectDocument[] type here as create returns full documents
             const createdDocs = await projectModel.create([projectData1, projectData2, projectData3, projectDataOtherUser]);
             // Store the documents (which include _id)
             createdProjects = createdDocs as IProjectDocument[]; // Cast might be needed depending on mongoose types
             if (createdProjects.length !== 4) {
                 throw new Error(`Failed to create the expected number of projects in beforeEach. Expected 4, got ${createdProjects.length}`);
             }
        });

        it('should read all projects when no criteria are provided', async () => {
            const result = await readProject();
            expect(result.success).toBe(true);
            expect(result.operation).toBe(CRUDOperation.READ);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(4); // All projects in the DB
        });

        it('should read projects for a specific user by userid', async () => {
            const result = await readProject(undefined, String(testUser._id));
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(3); // Only projects for testUser
            result.projects?.forEach(p => expect(p.userid).toBe(String(testUser._id)));
        });

        it('should read a specific project by projectid', async () => {
            const targetProject = createdProjects[0];
            const result = await readProject(String(targetProject._id));
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1);
            expect(result.projects?.[0]._id.toString()).toBe(targetProject._id.toString());
        });

        it('should return empty array message if projectid does not exist', async () => {
            const nonExistentId = new Types.ObjectId().toString();
            const result = await readProject(nonExistentId);
            expect(result.success).toBe(true);
            expect(result.projects).toBeUndefined(); // No projects array when none found by ID
            expect(result.message).toContain("No projects found");
        });

        it('should filter by name (case-insensitive, partial match)', async () => {
            const result = await readProject(undefined, undefined, 'Read Test Project'); // Partial name
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(2); // Project 1 and 2
            expect(result.projects?.every(p => p.name.includes('Read Test Project'))).toBe(true);
        });

         it('should return empty array message for non-matching name', async () => {
            const result = await readProject(undefined, undefined, 'NonExistentName');
            expect(result.success).toBe(true);
            expect(result.projects).toBeUndefined();
            expect(result.message).toContain("No projects found");
        });

        it('should filter by description (case-insensitive, partial match)', async () => {
            const result = await readProject(undefined, undefined, undefined, 'PROJECT 2 FOR READING'); // Partial, different case
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1);
            expect(result.projects?.[0].name).toBe(projectData2.name);
        });

        it('should filter by isSaved = true', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, true);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(2); // Project 2 and Other User's Project
            expect(result.projects?.every(p => p.isSaved === true)).toBe(true);
        });

        it('should filter by isSaved = false', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, false);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(2); // Project 1 and 3
            expect(result.projects?.every(p => p.isSaved === false)).toBe(true);
        });

         it('should filter by filename (case-insensitive, partial match)', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, 'READHASH2'); // Partial, uppercase
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(1);
             expect(result.projects?.[0].filename).toBe(projectData2.filename);
        });

        it('should filter by a single filetype', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, [FileType.DICOM]);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1);
            expect(result.projects?.[0].filetype).toBe(FileType.DICOM);
        });

        it('should filter by multiple filetypes using $in', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, [FileType.NIFTI_GZ, FileType.NIFTI]);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(3); // Proj 1, Proj 3, Other User Proj
            expect(result.projects?.every(p => [FileType.NIFTI_GZ, FileType.NIFTI].includes(p.filetype))).toBe(true);
        });

         it('should filter by filesize range (min and max)', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, { minsize: 1200, maxsize: 3000 });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(2); // Project 3 (1500), Other User (2500)
             expect(result.projects?.every(p => p.filesize >= 1200 && p.filesize <= 3000)).toBe(true);
         });

         it('should filter by filesize range (min only)', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, { minsize: 2000 });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(2); // Project 2 (5000), Other User (2500)
             expect(result.projects?.every(p => p.filesize >= 2000)).toBe(true);
         });

         it('should filter by filesize range (max only)', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, { maxsize: 1500 });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(2); // Project 1 (1000), Project 3 (1500)
             expect(result.projects?.every(p => p.filesize <= 1500)).toBe(true);
         });

        it('should filter by status (upload=true, extract=false)', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { upload: true, extract: false });
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1); // Only Project 2
            expect(result.projects?.[0].name).toBe(projectData2.name);
        });

        it('should filter by status (upload=false)', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { upload: false });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(1); // Only Other User Project
             expect(result.projects?.[0].name).toBe(projectDataOtherUser.name);
         });

        it('should filter by single datatype', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [FileDataType.UINT16]);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1);
            expect(result.projects?.[0].datatype).toBe(FileDataType.UINT16); // Project 2
        });

        it('should filter by multiple datatypes using $in', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [FileDataType.UINT8, FileDataType.UINT16]);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(2); // Project 2 and Other User
            expect(result.projects?.every(p => [FileDataType.UINT8, FileDataType.UINT16].includes(p.datatype))).toBe(true);
        });

        it('should filter by dimensions (width range)', async () => {
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { width: { minsize: 12, maxsize: 25 } });
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(2); // Project 2 (20), Other User (15)
             expect(result.projects?.every(p => p.dimensions.width >= 12 && p.dimensions.width <= 25)).toBe(true);
        });

        it('should filter by dimensions (frames min)', async () => {
             // Project 3 is the only one with frames defined (frames: 5)
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { frames: { minsize: 2 } });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(1); // Only Project 3 has frames >= 2
             expect(result.projects?.[0].name).toBe(projectData3.name);
         });

         it('should filter by voxelsize (x min)', async () => {
            // Project 3 is the only one with voxelsize defined (x: 0.5)
            const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { x: { minsize: 0.5 } });
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1); // Only Project 3
            expect(result.projects?.[0].name).toBe(projectData3.name);
        });

         it('should return empty array when filtering by voxelsize on projects without it', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { x: { minsize: 10 } }); // High min value
             expect(result.success).toBe(true);
             expect(result.projects).toBeUndefined(); // No projects match
             expect(result.message).toContain("No projects found");
         });

        it('should filter by date range (using createdAt)', async () => {
            // Find the document to update using a unique field like name
             const projDocToUpdate = await projectModel.findOne({ name: projectData2.name });
             if (!projDocToUpdate) throw new Error("Could not find project to update for date test");

             const futureDate = new Date();
             futureDate.setDate(futureDate.getDate() + 1); // Set date to tomorrow

             // Update the document directly in the DB
             await projectModel.updateOne({ _id: projDocToUpdate._id }, { $set: { createdAt: futureDate } });

             // Search for projects created before today
             const todayEnd = new Date();
             todayEnd.setHours(23, 59, 59, 999); // End of today

             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { end: todayEnd });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(3); // Should exclude the one updated to tomorrow

             // **Fix for TS18046**: Explicitly type `p`
             expect(result.projects?.find((p: IProjectDocument) => p._id.toString() === projDocToUpdate._id.toString())).toBeUndefined();
        });

        it('should combine multiple criteria (userid and isSaved=true)', async () => {
            const result = await readProject(undefined, String(testUser._id), undefined, undefined, true);
            expect(result.success).toBe(true);
            expect(result.projects).toBeDefined();
            expect(result.projects?.length).toBe(1); // Only project 2 matches both
            expect(result.projects?.[0].name).toBe(projectData2.name);
        });

         it('should combine multiple criteria (filetype=NIFTI_GZ and status.extract=true)', async () => {
             const result = await readProject(undefined, undefined, undefined, undefined, undefined, undefined, [FileType.NIFTI_GZ], undefined, { extract: true });
             expect(result.success).toBe(true);
             expect(result.projects).toBeDefined();
             expect(result.projects?.length).toBe(2); // Project 1 and 3
             expect(result.projects?.every(p => p.filetype === FileType.NIFTI_GZ && p.status.extract === true)).toBe(true);
         });

        it('should return error result on database error', async () => {
             // Arrange: Mock projectModel.find to simulate a DB error
             const findSpy = jest.spyOn(projectModel, 'find').mockImplementationOnce(() => {
                 throw new Error('Simulated DB Find Error');
             });

             // Act
             const result = await readProject(undefined, String(testUser._id)); // Provide some criteria

             // Assert
             expect(result.success).toBe(false);
             expect(result.operation).toBe(CRUDOperation.READ);
             expect(result.projects).toBeUndefined();
             expect(result.message).toBe('Error reading projects.');

             // Clean up
             findSpy.mockRestore();
         });

    }); // End describe('readProject')

    // -- Update Project Tests --
    describe('updateProject', () => {
        // Define a base project to be updated in each test
        let projectToUpdate: IProjectDocument;

        beforeEach(async () => {
            const result = await createProject(
                String(testUser._id), 'Project To Update', 'update_me.nii', false,
                `${String(testUser._id)}_hash_update`, FileType.NIFTI, 500, 'hash_update',
                'base_update', 'orig_update', 'extr_update', { upload: false, extract: false },
                FileDataType.UINT8, { width: 50, height: 50, slices: 5 }
            );
            if (!result.success || !result.project) {
                throw new Error("Failed to create project for update tests");
            }
            // Fetch the full document to ensure we have the Mongoose object
            const fetchedProject = await projectModel.findById(result.project._id);
            if (!fetchedProject) {
                throw new Error("Failed to fetch created project for update tests");
            }
            projectToUpdate = fetchedProject;
        });

         // Placeholder for actual updateProject function
        // Replace this with the actual import when available
        const updateProject = async (projectId: string, updates: Partial<IProject>): Promise<ProjectCrudResult> => {
            // Simulating the update logic - replace with actual database interaction
             try {
                const project = await projectModel.findById(projectId);
                if (!project) {
                    return { success: false, operation: CRUDOperation.UPDATE, message: `Project ${projectId} not found.` };
                }

                 // Simple check for no actual changes - real function needs more robust checks
                 let hasChanges = false;
                 for (const key in updates) {
                     if (updates.hasOwnProperty(key) && (project as any)[key] !== (updates as any)[key]) {
                         // This is a simplified check; deep equality/object comparison might be needed
                         if (key === 'status' || key === 'dimensions' || key === 'voxelsize') {
                            // Basic object comparison, needs improvement for real use
                             if (JSON.stringify((project as any)[key]) !== JSON.stringify((updates as any)[key])) {
                                 hasChanges = true;
                             }
                         } else {
                             hasChanges = true;
                         }
                     }
                 }
                 if (!hasChanges) {
                      return { success: false, operation: CRUDOperation.UPDATE, message: 'No fields to update.' };
                 }

                // Apply updates (this is simplified)
                Object.assign(project, updates);
                await project.save();

                return { success: true, operation: CRUDOperation.UPDATE, project: project };
            } catch (error) {
                return { success: false, operation: CRUDOperation.UPDATE, message: "Error updating project." };
            }
        };

        it('should update project name successfully', async () => {
            const newName = 'Updated Project Name';
            const result = await updateProject(String(projectToUpdate._id), { name: newName });

            expect(result.success).toBe(true);
            expect(result.operation).toBe(CRUDOperation.UPDATE);
            expect(result.project).toBeDefined();
            expect(result.project?.name).toBe(newName);

            const dbProject = await projectModel.findById(projectToUpdate._id);
            expect(dbProject?.name).toBe(newName);
        });

         it('should update project description successfully', async () => {
             const newDescription = 'This project has been updated.';
             const result = await updateProject(String(projectToUpdate._id), { description: newDescription });

             expect(result.success).toBe(true);
             expect(result.project?.description).toBe(newDescription);
             const dbProject = await projectModel.findById(projectToUpdate._id);
             expect(dbProject?.description).toBe(newDescription);
         });

         it('should update project isSaved status successfully', async () => {
             const result = await updateProject(String(projectToUpdate._id), { isSaved: true });
             expect(result.success).toBe(true);
             expect(result.project?.isSaved).toBe(true);
             const dbProject = await projectModel.findById(projectToUpdate._id);
             expect(dbProject?.isSaved).toBe(true);
         });

        it('should update project status successfully', async () => {
            const newStatus = { upload: true, extract: true };
            const result = await updateProject(String(projectToUpdate._id), { status: newStatus });
            expect(result.success).toBe(true);
            expect(result.project?.status).toEqual(newStatus);
            const dbProject = await projectModel.findById(projectToUpdate._id);
            expect(dbProject?.status.upload).toBe(newStatus.upload);
            expect(dbProject?.status.extract).toBe(newStatus.extract);
        });

        it('should fail to update a non-existent project', async () => {
            const nonExistentId = new Types.ObjectId().toString();
            const result = await updateProject(nonExistentId, { name: 'No Such Project' });
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

         it('should fail if trying to update with no actual changes', async () => {
             const result = await updateProject(String(projectToUpdate._id), { name: projectToUpdate.name }); // Same name
             expect(result.success).toBe(false);
             expect(result.message).toContain('No fields to update');
         });

         // TODO: Add tests for uniqueness constraint violations during update (e.g., changing name to conflict with another project of the same user)
          // TODO: Add tests for updating other fields like filename, paths, dimensions, etc.

    }); // End describe('updateProject')

    // -- Delete Project Tests --
    describe('deleteProject', () => {
         // Placeholder for actual deleteProject function
         // Replace this with the actual import when available
         const deleteProject = async (projectId: string): Promise<ProjectCrudResult> => {
            try {
                const project = await projectModel.findById(projectId);
                if (!project) {
                    return { success: false, operation: CRUDOperation.DELETE, message: `Project ${projectId} not found.` };
                }
                // Mongoose hooks should handle cascade delete if set up correctly
                await project.deleteOne();
                // Check if actually deleted
                 const deletedCheck = await projectModel.findById(projectId);
                 if (deletedCheck) {
                      return { success: false, operation: CRUDOperation.DELETE, message: `Project ${projectId} was not deleted successfully.` };
                 }

                return { success: true, operation: CRUDOperation.DELETE, message: `Project ${projectId} deleted successfully.` };
            } catch (error) {
                 // LogError(error as Error, 'Database', `Error deleting project ${projectId}.`);
                 return { success: false, operation: CRUDOperation.DELETE, message: 'Error deleting project.' };
             }
         };

        let projectToDelete: IProjectDocument;

        beforeEach(async () => {
            const result = await createProject(
                String(testUser._id), 'Project To Delete', 'delete_me.nii', false,
                `${String(testUser._id)}_hash_delete`, FileType.NIFTI, 600, 'hash_delete',
                'base_delete', 'orig_delete', 'extr_delete', { upload: false, extract: false },
                FileDataType.UINT8, { width: 60, height: 60, slices: 6 }
            );
            if (!result.success || !result.project) {
                throw new Error("Failed to create project for delete tests");
            }
             // Fetch the full document to ensure we have the Mongoose object
             const fetchedProject = await projectModel.findById(result.project._id);
             if (!fetchedProject) {
                 throw new Error("Failed to fetch created project for delete tests");
             }
            projectToDelete = fetchedProject;
        });

        it('should delete a project successfully', async () => {
            const projectId = String(projectToDelete._id);
            const result = await deleteProject(projectId);

            expect(result.success).toBe(true);
            expect(result.operation).toBe(CRUDOperation.DELETE);
            expect(result.message).toContain(`Project ${projectId} deleted successfully.`);

            // Verify it's gone from the database
            const dbCheck = await projectModel.findById(projectId);
            expect(dbCheck).toBeNull();
        });

        it('should fail to delete a non-existent project', async () => {
            const nonExistentId = new Types.ObjectId().toString();
            const result = await deleteProject(nonExistentId);

            expect(result.success).toBe(false);
            expect(result.operation).toBe(CRUDOperation.DELETE);
            expect(result.message).toContain(`Project ${nonExistentId} not found.`);
        });

        // TODO: Add test for cascade delete hook (create project, create mask, delete project, check mask is gone)

    }); // End describe('deleteProject')

}); // End describe('Project Model')


// --- Project Segmentation Mask Model Tests ---
describe('Project Segmentation Mask Model', () => {
    // TODO: Add tests for Project Segmentation Mask model and functions
     it.todo('should create a new segmentation mask entry');
     it.todo('should read segmentation masks for a given project');
     it.todo('should update segmentation mask details');
     it.todo('should delete a segmentation mask entry');
     it.todo('should cascade delete masks when project is deleted'); // Test the hook
});